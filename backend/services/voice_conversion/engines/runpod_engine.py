"""RunPod serverless voice-conversion engine (Seed-VC).

Implements the VoiceConversionEngine interface against a RunPod
serverless GPU endpoint. No GPU dependencies on this server; inference
happens remotely over HTTPS. The source audio is never returned as the
result and TTS is never used as a substitute for conversion.

Pipeline:
    source media -> FFmpeg audio extraction -> authorized voice reference
    -> RunPod /run (async job) -> poll status -> fetch output WAV
    -> validate (header / size / duration) -> object storage -> completed
"""
import asyncio
import base64
import logging
from typing import Any, Dict, Optional

import httpx

from ...runpod.runpod_client import RunPodClient, RunPodError
from ..provider import ProviderSettings
from .base import EngineError, EngineValidationError, VoiceConversionEngine

logger = logging.getLogger(__name__)

MIN_OUTPUT_BYTES = 1024
MAX_DURATION_TOLERANCE = 0.5  # Seed-VC can shift length slightly


class RunPodVoiceConversionEngine(VoiceConversionEngine):
    name = "runpod"

    def __init__(self, provider_settings: Optional[ProviderSettings] = None,
                 client: Optional[RunPodClient] = None):
        cfg = provider_settings or ProviderSettings()
        self._settings = cfg
        self._client = client or RunPodClient(
            api_key=cfg.runpod_api_key,
            endpoint_id=cfg.runpod_endpoint_id,
        )
        self._cancelled: set = set()

    # ------------------------------------------------------------- validate
    async def validate(
        self,
        source_media: Optional[Dict[str, Any]],
        source_audio: Optional[Dict[str, Any]],
        target_voice: Dict[str, Any],
        settings: Dict[str, Any],
    ) -> None:
        if not self._settings.runpod_api_key or not self._settings.runpod_endpoint_id:
            raise EngineValidationError(
                "RunPod voice conversion is not configured yet "
                "(missing RUNPOD_API_KEY or RUNPOD_VOICE_ENDPOINT_ID)."
            )
        if not source_media and not source_audio:
            raise EngineValidationError("No source media or audio provided.")
        if not target_voice or not target_voice.get("voice_id"):
            raise EngineValidationError("A target voice ID is required.")
        if not target_voice.get("authorized"):
            raise EngineValidationError(
                "Target voice is not authorized for this user."
            )
        if not target_voice.get("reference_sample_url"):
            raise EngineValidationError(
                "Target voice has no authorized reference sample."
            )

    # -------------------------------------------------------------- convert
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
        await self.validate(source_media, source_audio, target_voice, settings)

        def report(stage, state, pct):
            if progress_callback:
                try:
                    progress_callback(stage, state, pct)
                except Exception:
                    pass

        loop = asyncio.get_running_loop()
        report("Preparing media", "preparing", 10)

        # ---- 1. source audio bytes (download; extraction happens on worker
        #         where FFmpeg lives; here we fetch the referenced file) ----
        source = source_media or source_audio
        source_url = source.get("file_url") or source.get("audio_url")
        if not source_url:
            raise EngineValidationError("Source media has no accessible file URL.")
        source_bytes = await self._fetch(source_url, "source")
        ref_bytes = await self._fetch(
            target_voice["reference_sample_url"], "voice reference"
        )
        report("Analyzing speech", "processing", 25)

        # ---- 2. submit async RunPod job -----------------------------------
        payload = {
            "input": {
                "source_audio_b64": base64.b64encode(source_bytes).decode("ascii"),
                "target_reference_b64": base64.b64encode(ref_bytes).decode("ascii"),
                "model": self._settings.runpod_model,
                "output_format": "wav",
                "job_id": job_id,
                "source_language": source.get("language"),
                "target_language": target_voice.get("language"),
                "settings": settings or {},
            }
        }
        try:
            submission = await loop.run_in_executor(
                None, lambda: self._client.submit(payload)
            )
        except RunPodError as exc:
            raise EngineError(str(exc)) from exc
        runpod_id = submission.get("id")
        if not runpod_id:
            raise EngineError("Voice conversion provider did not return a job ID.")
        self._cancelled.discard(runpod_id)

        report("Voice conversion in progress", "processing", 45)

        # ---- 3. poll (cancellation-aware) ---------------------------------
        def _should_cancel() -> bool:
            if job_id in self._cancelled or runpod_id in self._cancelled:
                return True
            return False

        try:
            final = await loop.run_in_executor(
                None,
                lambda: self._client.wait_for_result(
                    runpod_id, poll_interval=2.0, max_wait=1800.0,
                    should_cancel=_should_cancel,
                ),
            )
        except RunPodError as exc:
            if "cancel" in str(exc).lower():
                raise EngineError("Job cancelled.") from exc
            raise EngineError(str(exc)) from exc

        report("Enhancing audio", "enhancing", 80)

        # ---- 4. fetch + validate output -----------------------------------
        output = (final or {}).get("output") or {}
        audio_b64 = output.get("audio_b64")
        if not audio_b64:
            raise EngineError(
                "The conversion provider returned empty output."
            )
        audio_bytes = base64.b64decode(audio_b64)
        meta = self._validate_wav(audio_bytes, source)

        # ---- 5. persist to object storage (temp lifecycle) ----------------
        from services.storage import get_object_store
        import os
        import tempfile

        fd, tmp = tempfile.mkstemp(prefix="vc_runpod_", suffix=".wav")
        with os.fdopen(fd, "wb") as fh:
            fh.write(audio_bytes)
        key = f"converted/{job_id}.wav"
        store = get_object_store()
        store.upload(tmp, key)
        try:
            os.unlink(tmp)
        except OSError:
            pass

        report("Finalizing", "finalizing", 95)
        return {
            "output_file": f"{job_id}.wav",
            "output_format": "wav",
            "storage_key": key,
            "duration_seconds": meta["duration_seconds"],
            "size_bytes": len(audio_bytes),
            "lossless": True,
            "engine": self.name,
            "model": self._settings.runpod_model,
        }

    # --------------------------------------------------------------- cancel
    async def cancel(self, job_id: str) -> None:
        self._cancelled.add(job_id)
        # Best-effort remote cancel; ignored when the provider refuses.
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: self._client.cancel(job_id))
        except Exception:
            pass

    # ------------------------------------------------------------ internals
    async def _fetch(self, url: str, label: str) -> bytes:
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.get(url)
        except httpx.HTTPError:
            raise EngineError(f"Could not download {label} audio.")
        if resp.status_code != 200:
            raise EngineError(f"Could not download {label} audio.")
        if not resp.content:
            raise EngineError(f"The {label} audio file is empty.")
        return resp.content

    @staticmethod
    def _validate_wav(data: bytes, source: Dict[str, Any]) -> Dict[str, Any]:
        if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise EngineError(
                "Converted audio is corrupted or not a valid WAV file."
            )
        if len(data) < MIN_OUTPUT_BYTES:
            raise EngineError("Converted audio is suspiciously small.")
        byte_rate = int.from_bytes(data[28:32], "little") or 1
        duration = (len(data) - 44) / byte_rate
        expected = source.get("duration_seconds") or 0
        if expected and duration > 0:
            if abs(duration - expected) / max(expected, 1) > MAX_DURATION_TOLERANCE:
                raise EngineError(
                    "Converted audio duration deviates too far from the source."
                )
        return {"duration_seconds": round(duration, 2)}
