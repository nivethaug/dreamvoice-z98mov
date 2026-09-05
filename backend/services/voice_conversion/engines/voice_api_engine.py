"""Shared Voice API conversion engine (real Seed-VC via voice-api).

ALL media processing happens inside the shared Voice API
(https://voice-api.dreamagent.cloud): upload + ffprobe inspection, audio
extraction/normalization, video audio replacement (mux with
-c:v copy -shortest). DreamVoice never runs ffmpeg/ffprobe locally — it only
moves bytes between its object store, the Voice API media store, and public
HTTPS storage.

Pipeline (every processing step is a Voice API media endpoint):
    DreamVoice store -> VA /v1/media/upload (validation + metadata)
    -> VA /v1/media/{id}/extract-audio (44.1kHz mono WAV)
    -> download -> public HTTPS publish -> VA /v1/voice/convert (Seed-VC)
    -> download converted WAV -> publish (audio_url)
    -> [video] VA /v1/media/upload(converted) + /replace-audio(video)
    -> download final MP4 -> publish (video_url)
    -> VA /v1/media/{id} DELETE for every temp media id

Honest progress: ticks only at known boundaries; while awaiting the Voice
API the job sits in a genuine indeterminate "Converting voice" state —
no fabricated 0-100 percentage.
"""
import asyncio
import logging
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional

from ...storage.public_media import delete_media, store_media
from ..provider import ProviderSettings
from ..voice_api_client import (
    VoiceApiClient,
    VoiceApiError,
    get_voice_api_client,
)
from ..voice_api_media import (
    VoiceApiMediaClient,
    VoiceApiMediaError,
    claim_source,
    get_media_client,
)
from .base import EngineError, EngineValidationError, VoiceConversionEngine

logger = logging.getLogger(__name__)

MAX_SOURCE_DURATION = 30 * 60       # Voice API contract: 30 minutes
MAX_REFERENCE_DURATION = 10 * 60    # Voice API contract: 10 minutes


class VoiceAPIVoiceConversionEngine(VoiceConversionEngine):
    name = "voiceapi"

    def __init__(self, provider_settings: Optional[ProviderSettings] = None,
                 client: Optional[VoiceApiClient] = None,
                 media_client: Optional[VoiceApiMediaClient] = None):
        self._settings = provider_settings or ProviderSettings()
        self._client = client or get_voice_api_client()
        self._media = media_client or get_media_client()
        self._cancelled: set = set()
        self._pending: Dict[str, asyncio.Event] = {}

    # ------------------------------------------------------------ validate
    async def validate(
        self,
        source_media: Optional[Dict[str, Any]],
        source_audio: Optional[Dict[str, Any]],
        target_voice: Dict[str, Any],
        settings: Dict[str, Any],
    ) -> None:
        if not self._client.configured:
            raise EngineValidationError(
                "Voice conversion is not configured yet."
            )
        source = source_media or source_audio
        if not source:
            raise EngineValidationError("No source media or audio provided.")
        if not source.get("storage_key"):
            raise EngineValidationError(
                "Source media has not been uploaded yet."
            )
        duration = float(source.get("duration_seconds") or 0)
        if duration <= 0:
            raise EngineValidationError(
                "Source media duration could not be determined."
            )
        if duration > MAX_SOURCE_DURATION:
            raise EngineValidationError(
                "Source media exceeds the 30 minute limit."
            )
        if not target_voice or not target_voice.get("voice_id"):
            raise EngineValidationError("A target voice ID is required.")
        if not target_voice.get("authorized"):
            raise EngineValidationError(
                "This voice is not available for real conversion yet. "
                "Add an authorized voice sample first."
            )
        ref_url = target_voice.get("reference_sample_url")
        if not ref_url:
            raise EngineValidationError(
                "This voice is not available for real conversion yet. "
                "Add an authorized voice sample first."
            )
        ref_duration = float(target_voice.get("reference_duration_seconds") or 0)
        if ref_duration > MAX_REFERENCE_DURATION:
            raise EngineValidationError(
                "Voice reference exceeds the 10 minute limit."
            )

    # ------------------------------------------------------------- convert
    async def convert(
        self,
        job_id: str,
        source_media: Optional[Dict[str, Any]],
        source_audio: Optional[Dict[str, Any]],
        target_voice: Dict[str, Any],
        settings: Dict[str, Any],
        output_format: str,
        progress_callback=None,
    ) -> Dict[str, Any]:
        started = time.monotonic()
        await self.validate(source_media, source_audio, target_voice, settings)

        def report(stage, state, pct):
            if progress_callback:
                try:
                    progress_callback(stage, state, pct)
                except Exception:
                    pass

        source = source_media or source_audio
        is_video = bool(source.get("is_video"))
        source_type = "video" if is_video else "audio"
        src_key = source["storage_key"]
        src_duration = float(source.get("duration_seconds") or 0)
        tmpdir = Path(tempfile.mkdtemp(prefix=f"dvjob_{job_id[:8]}_"))
        created_keys = []
        va_media_ids = []  # Voice API media ids to delete at the end

        def va_delete(fid: str) -> None:
            if not fid:
                return
            try:
                self._media.delete(fid)
            except Exception as exc:
                logger.warning("job %s VA media delete %s failed: %s",
                               job_id, fid, exc)

        cancel_event = asyncio.Event()
        self._pending[job_id] = cancel_event

        try:
            # ---- preparing: download source from object store to tmp ----
            report("Preparing media", "preparing", 10)
            store = _get_store()
            src_local = tmpdir / f"source_{src_key.rsplit('/', 1)[-1]}"
            await asyncio.to_thread(store.download, src_key, str(src_local))

            # ---- ensure source is in the Voice API (server-side ffprobe) ----
            report("Analyzing speech", "processing", 20)
            src_va_id = await asyncio.to_thread(claim_source, src_key) or ""
            if src_va_id:
                # Reuse the copy the upload route already validated.
                try:
                    up = await asyncio.to_thread(self._media.get, src_va_id)
                    up = {**up, "file_id": src_va_id}
                except VoiceApiMediaError:
                    va_delete(src_va_id)
                    src_va_id = ""
                    up = None
            if not src_va_id:
                # VA upload requires a filename with a real extension;
                # storage keys use bare trailing extensions (".../uuid/mp4"),
                # so derive the name from the source content type.
                ext = (src_key.rsplit("/", 1)[-1] if "/" in src_key else "")
                ext = ext if "." in ext else f".{ext or 'bin'}"
                up = await asyncio.to_thread(
                    self._media.upload, str(src_local), f"source{ext}"
                )
                src_va_id = up.get("file_id") or ""
                # The upload response omits stream metadata; fetch full
                # server-side ffprobe info via get().
                try:
                    up = await asyncio.to_thread(self._media.get, src_va_id)
                    up = {**up, "file_id": src_va_id}
                except VoiceApiMediaError:
                    pass
            va_media_ids.append(src_va_id)
            va_duration = float(up.get("duration") or 0)
            if va_duration > 0:
                src_duration = va_duration
            if not (up.get("has_audio")
                    or (up.get("audio") or {}).get("present")
                    or (up.get("media_type") == "audio")):
                raise EngineError("Media file has no audio track.")

            # ---- extract + normalize 44.1kHz mono WAV inside the VA ----
            ext_meta = await asyncio.to_thread(
                self._media.extract_audio, src_va_id, 44100, 1, "wav"
            )
            extracted_id = ext_meta.get("file_id") or ""
            va_media_ids.append(extracted_id)
            wav_local = tmpdir / "source_audio.wav"
            await asyncio.to_thread(
                self._media.download, extracted_id, str(wav_local)
            )
            if not wav_local.exists() or wav_local.stat().st_size < 100:
                raise EngineError(
                    "Voice conversion failed. Your file was not changed."
                )

            # ---- publish source audio via public HTTPS ----
            report("Preparing media", "preparing", 30)
            pub = await asyncio.to_thread(
                store_media, str(wav_local), "voiceapi-src", "wav"
            )
            created_keys.append(pub["key"])

            # ---- call the shared Voice API (long, indeterminate) ----
            report("Converting voice", "processing", 45)
            lang = target_voice.get("language") or "ta"
            # The Voice API applies its own optimal defaults for pitch,
            # speed and voice similarity — we send NO overrides so the
            # target voice conversion is handled entirely by the API.
            settings_out: Dict[str, Any] = {}
            convert_task = asyncio.create_task(self._client.convert(
                source_audio_url=pub["public_url"],
                target_voice_url=target_voice["reference_sample_url"],
                source_language=lang,
                output_format="wav",
                settings_map=settings_out,
            ))
            done, _ = await asyncio.wait(
                [convert_task, asyncio.create_task(cancel_event.wait())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            if job_id in self._cancelled:
                convert_task.cancel()
                raise asyncio.CancelledError()
            try:
                api_result = convert_task.result()
            except VoiceApiError as exc:
                raise EngineError(exc.message) from exc

            # ---- download converted WAV ----
            report("Enhancing audio", "enhancing", 70)
            out_url = self._extract_output_url(api_result)
            logger.info("job %s voice-api result: %s", job_id, api_result)
            converted = await self._client.download_output(out_url, tmpdir)
            if not converted.exists() or converted.stat().st_size < 100:
                raise EngineError(
                    "Voice conversion failed. Your file was not changed."
                )
            out_duration = float(api_result.get("duration") or 0) or src_duration

            # ---- final output: VA replace-audio for video sources ----
            report("Finalizing", "finalizing", 90)
            result: Dict[str, Any] = {
                "source_type": source_type,
                "engine": self.name,
                "duration_seconds": round(out_duration, 2),
                "sample_rate": api_result.get("sample_rate") or 22050,
            }

            if is_video:
                # upload converted WAV into the VA media store, then let the
                # VA mux it into the original video (stream copy, -shortest)
                conv_up = await asyncio.to_thread(
                    self._media.upload, str(converted), "converted.wav"
                )
                conv_va_id = conv_up.get("file_id") or ""
                va_media_ids.append(conv_va_id)
                try:
                    final_meta = await asyncio.to_thread(
                        self._media.replace_audio, src_va_id, conv_va_id
                    )
                    final_id = final_meta.get("file_id") or ""
                    va_media_ids.append(final_id)
                    final_local = tmpdir / "final.mp4"
                    await asyncio.to_thread(
                        self._media.download, final_id, str(final_local)
                    )
                    if not final_local.exists() or final_local.stat().st_size < 1000:
                        raise EngineError(
                            "Voice conversion failed. Your file was not changed."
                        )
                    out = await asyncio.to_thread(
                        store_media, str(final_local), "voiceapi-out", "mp4"
                    )
                    created_keys.append(out["key"])
                    result["video_url"] = out["public_url"]
                    result["video_key"] = out["key"]
                finally:
                    va_delete(conv_va_id)

                wav_out = await asyncio.to_thread(
                    store_media, str(converted), "voiceapi-out", "wav"
                )
                created_keys.append(wav_out["key"])
                result["audio_url"] = wav_out["public_url"]
                result["audio_key"] = wav_out["key"]
                result["output_format"] = "mp4"
            else:
                ext = converted.suffix.lstrip(".").lower() or "wav"
                out = await asyncio.to_thread(
                    store_media, str(converted), "voiceapi-out", ext
                )
                created_keys.append(out["key"])
                result["audio_url"] = out["public_url"]
                result["audio_key"] = out["key"]
                result["output_format"] = ext

            result["conversion_seconds"] = round(
                time.monotonic() - started, 2
            )
            result["job_id"] = job_id
            result["status"] = "completed"
            # Drop the intermediate source copy immediately; keep result
            # URLs alive for the TTL window.
            for k in created_keys:
                if "voiceapi-src" in k:
                    await asyncio.to_thread(delete_media, k)
            return result

        except VoiceApiMediaError as exc:
            raise EngineError(exc.message) from exc
        except asyncio.CancelledError:
            raise
        finally:
            self._pending.pop(job_id, None)
            for fid in va_media_ids:
                va_delete(fid)
            _safe_rmtree(tmpdir)

    # --------------------------------------------------------------- cancel
    async def cancel(self, job_id: str) -> None:
        self._cancelled.add(job_id)
        event = self._pending.get(job_id)
        if event:
            event.set()

    # ------------------------------------------------------------ internals
    @staticmethod
    def _extract_output_url(api_result: Dict[str, Any]) -> str:
        for key in ("audio_url", "output_url", "url", "download_url"):
            val = api_result.get(key)
            if isinstance(val, str) and val.startswith("http"):
                return val
        nested = api_result.get("result") or api_result.get("data") or {}
        if isinstance(nested, dict):
            for key in ("audio_url", "output_url", "url", "download_url"):
                val = nested.get(key)
                if isinstance(val, str) and val.startswith("http"):
                    return val
        raise EngineError(
            "Voice conversion failed. Your file was not changed."
        )


def _get_store():
    from services.storage.object_store import get_object_store
    return get_object_store()


def _safe_rmtree(path: Path) -> None:
    import shutil
    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception:
        pass
