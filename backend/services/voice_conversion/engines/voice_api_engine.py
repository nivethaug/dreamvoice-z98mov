"""Shared Voice API conversion engine (real Seed-VC via voice-api).

Implements the VoiceConversionEngine interface against the shared Voice API
(https://voice-api.dreamagent.cloud) which fronts the RunPod serverless
Seed-VC endpoint. DreamVoice never talks to RunPod directly and never uses
OpenRouter for voice conversion.

Pipeline:
    source media -> (video: FFmpeg extract audio) -> upload source to public
    HTTPS storage -> authorized target voice reference URL -> Voice API
    /v1/voice/convert -> download converted WAV -> validate -> (video:
    FFmpeg mux with video stream copy) -> store result -> completed

Honest progress: ticks only at known boundaries; while awaiting the Voice
API the job sits in a genuine indeterminate "Converting voice" state —
no fabricated 0-100 percentage.
"""
import asyncio
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional

from ...audio.ffmpeg import (
    MediaProcessingError,
    extract_audio,
    ffprobe,
    mux_video,
    validate_audio_output,
)
from ...storage.public_media import delete_media, store_media
from ..provider import ProviderSettings
from ..voice_api_client import (
    VoiceApiClient,
    VoiceApiError,
    get_voice_api_client,
    sanitize_settings,
)
from .base import EngineError, EngineValidationError, VoiceConversionEngine

logger = logging.getLogger(__name__)

MAX_SOURCE_DURATION = 30 * 60       # Voice API contract: 30 minutes
MAX_REFERENCE_DURATION = 10 * 60    # Voice API contract: 10 minutes


class VoiceAPIVoiceConversionEngine(VoiceConversionEngine):
    name = "voiceapi"

    def __init__(self, provider_settings: Optional[ProviderSettings] = None,
                 client: Optional[VoiceApiClient] = None):
        self._settings = provider_settings or ProviderSettings()
        self._client = client or get_voice_api_client()
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

        cancel_event = asyncio.Event()
        self._pending[job_id] = cancel_event

        try:
            # ---- preparing: download source from object store to tmp ----
            report("Preparing media", "preparing", 10)
            store = _get_store()
            src_local = tmpdir / f"source_{src_key.rsplit('/', 1)[-1]}"
            await asyncio.to_thread(store.download, src_key, str(src_local))

            # ---- normalize to clean WAV (Seed-VC rejects OGG/some MP3s);
            #      for video this also extracts the audio track ----
            report("Analyzing speech", "processing", 20)
            src_local = await asyncio.to_thread(
                extract_audio, str(src_local), str(tmpdir / "source_audio.wav")
            )

            # ---- publish source audio via public HTTPS ----
            report("Preparing media", "preparing", 30)
            pub = await asyncio.to_thread(
                store_media, str(src_local), "voiceapi-src",
                src_local.suffix.lstrip(".") or "wav"
            )
            created_keys.append(pub["key"])

            # ---- call the shared Voice API (long, indeterminate) ----
            report("Converting voice", "processing", 45)
            lang = target_voice.get("language") or "ta"
            settings_out = self._map_ui_settings(settings)
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

            # ---- download + validate converted WAV ----
            report("Enhancing audio", "enhancing", 70)
            out_url = self._extract_output_url(api_result)
            converted = await self._client.download_output(out_url, tmpdir)
            info = await asyncio.to_thread(
                validate_audio_output, str(converted), src_duration
            )

            # ---- final output: mux video if source was video ----
            report("Finalizing", "finalizing", 90)
            result: Dict[str, Any] = {
                "source_type": source_type,
                "engine": self.name,
                "duration_seconds": round(info["duration"], 2),
                "sample_rate": info.get("sample_rate") or 22050,
            }

            if is_video:
                orig_local = tmpdir / "original_video"
                await asyncio.to_thread(
                    store.download, src_key, str(orig_local)
                )
                final_mp4 = await asyncio.to_thread(
                    mux_video, str(orig_local), str(converted),
                    str(tmpdir / "final.mp4")
                )
                out = await asyncio.to_thread(
                    store_media, str(final_mp4), "voiceapi-out", "mp4"
                )
                created_keys.append(out["key"])
                result["video_url"] = out["public_url"]
                result["audio_url"] = out["public_url"]
                result["output_format"] = "mp4"
            else:
                ext = converted.suffix.lstrip(".").lower() or "wav"
                out = await asyncio.to_thread(
                    store_media, str(converted), "voiceapi-out", ext
                )
                created_keys.append(out["key"])
                result["audio_url"] = out["public_url"]
                result["output_format"] = ext

            result["conversion_seconds"] = round(
                time.monotonic() - started, 2
            )
            result["job_id"] = job_id
            result["status"] = "completed"
            # Keep the public result URLs alive for the TTL window; drop the
            # intermediate source copy immediately.
            for k in created_keys:
                if "voiceapi-src" in k:
                    await asyncio.to_thread(delete_media, k)
            return result

        except MediaProcessingError as exc:
            raise EngineError(str(exc)) from exc
        except asyncio.CancelledError:
            raise
        finally:
            self._pending.pop(job_id, None)
            _safe_rmtree(tmpdir)

    @staticmethod
    def _map_ui_settings(ui: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Map legitimate UI controls to Seed-VC params.

        pitch  -> pitch_shift (semitones, -12..12)
        speed  -> length_adjust (0.5..2.0)
        stability/similarity/style have NO Seed-VC equivalent -> never sent.
        """
        if not ui:
            return {}
        out = dict(ui)
        if ui.get("pitch") is not None:
            try:
                out["pitch_shift"] = max(-12.0, min(12.0, float(ui["pitch"])))
            except (TypeError, ValueError):
                pass
        if ui.get("speed") is not None:
            try:
                out["length_adjust"] = max(0.5, min(2.0, float(ui["speed"])))
            except (TypeError, ValueError):
                pass
        return sanitize_settings(out)

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
