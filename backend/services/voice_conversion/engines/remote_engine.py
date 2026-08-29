"""Remote voice-conversion engine (Seed-VC / GPU inference endpoint).

Implements the VoiceConversionEngine interface against a generic remote
inference provider, configurable via:
  VOICE_CONVERSION_API_URL
  VOICE_CONVERSION_API_KEY
  VOICE_CONVERSION_MODEL (default: seed-vc)

Expected remote API contract (Seed-VC compatible):
  POST {api_url}/convert
    multipart: source_audio (file), target_reference (file),
               model (str), output_format (str)
  -> audio bytes (lossless WAV preferred)
  POST {api_url}/cancel/{job_id} (optional; ignored if unsupported)

The remote server owns the AI model. Nothing is installed locally, no
voice embeddings are stored locally, and the API key never leaves the
backend.
"""
import asyncio
import os
import tempfile
import uuid
from typing import Any, Dict, Optional

import httpx

from ..provider import ProviderNotConfiguredError, ProviderSettings
from .base import EngineError, EngineValidationError, VoiceConversionEngine

REQUEST_TIMEOUT_SECONDS = 900  # long-running GPU inference
SUPPORTED_OUTPUT_FORMATS = {"wav", "mp3", "m4a", "mp4"}
LOSSLESS_FORMATS = {"wav"}  # do not recompress lossless intermediates
MAX_DURATION_TOLERANCE = 0.25  # 25% length drift tolerated for VC artifacts
MIN_OUTPUT_BYTES = 1024


class RemoteVoiceConversionEngine(VoiceConversionEngine):
    name = "remote"

    def __init__(self, settings: ProviderSettings):
        self._settings = settings
        self._cancelled: set = set()

    async def validate(
        self,
        source_media: Optional[Dict[str, Any]],
        source_audio: Optional[Dict[str, Any]],
        target_voice: Dict[str, Any],
        settings: Dict[str, Any],
    ) -> None:
        if not self._settings.remote_api_url or not self._settings.remote_api_key:
            raise ProviderNotConfiguredError(
                "Voice conversion is not configured yet.",
                ["VOICE_CONVERSION_API_URL", "VOICE_CONVERSION_API_KEY"],
            )
        if not source_media and not source_audio:
            raise EngineValidationError("No source media or audio provided.")
        if not target_voice or not target_voice.get("voice_id"):
            raise EngineValidationError("A target voice ID is required.")
        # The reference must be an authorized library voice sample.
        if not target_voice.get("reference_sample_url"):
            raise EngineValidationError(
                "Target voice has no authorized reference sample."
            )
        fmt = (settings or {}).get("output_format") or "wav"
        if fmt not in SUPPORTED_OUTPUT_FORMATS:
            raise EngineValidationError(f"Unsupported output format '{fmt}'.")

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
        source = source_media or source_audio or {}
        source_url = source.get("file_url") or source.get("audio_url")
        if not source_url:
            raise EngineValidationError("Source media has no accessible file URL.")

        if progress_callback:
            progress_callback("Preparing media", "preparing", 10)
        if progress_callback:
            progress_callback("Analyzing speech", "processing", 25)

        # ---- prepare request ------------------------------------------------
        files = {}
        try:
            files["source_audio"] = await self._fetch_bytes(source_url, "source")
            files["target_reference"] = await self._fetch_bytes(
                target_voice["reference_sample_url"], "reference"
            )
        except EngineError:
            raise
        except Exception as exc:
            raise EngineError(f"Could not prepare audio for conversion: {exc}")

        if progress_callback:
            progress_callback("Voice conversion in progress", "processing", 45)

        # ---- call remote provider -------------------------------------------
        try:
            audio_bytes = await self._request_conversion(
                files, output_format, job_id
            )
        except asyncio.CancelledError:
            raise
        except EngineError:
            raise

        if progress_callback:
            progress_callback("Enhancing audio", "enhancing", 80)

        # ---- validate & store output ----------------------------------------
        if not audio_bytes or len(audio_bytes) < MIN_OUTPUT_BYTES:
            raise EngineError(
                "The conversion provider returned empty or invalid audio."
            )

        result = self._store_temp_output(audio_bytes, output_format, source)
        if progress_callback:
            progress_callback("Finalizing", "finalizing", 95)
        result["engine"] = self.name
        result["model"] = self._settings.remote_model
        return result

    async def cancel(self, job_id: str) -> None:
        self._cancelled.add(job_id)
        # Best-effort remote cancellation; ignore if unsupported.
        url = self._settings.remote_api_url.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"{url}/cancel/{job_id}",
                    headers=self._auth_headers(),
                )
        except httpx.HTTPError:
            pass

    # ------------------------------------------------------------- internals

    def _auth_headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self._settings.remote_api_key}"}

    async def _fetch_bytes(self, url: str, label: str) -> tuple:
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.get(url)
        except httpx.HTTPError:
            raise EngineError(f"Could not download {label} audio.")
        if resp.status_code != 200:
            raise EngineError(f"Could not download {label} audio.")
        return ("audio", f"{label}.bin", resp.content, "application/octet-stream")

    async def _request_conversion(self, files: dict, output_format: str, job_id: str) -> bytes:
        url = self._settings.remote_api_url.rstrip("/") + "/convert"
        data = {
            "model": self._settings.remote_model,
            "output_format": output_format if output_format in LOSSLESS_FORMATS else "wav",
            "job_id": job_id,
        }
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    url, headers=self._auth_headers(), files=files, data=data
                )
        except httpx.TimeoutException:
            raise EngineError("The voice conversion provider timed out.")
        except httpx.HTTPError:
            raise EngineError("Could not reach the voice conversion provider.")
        if resp.status_code in (401, 403):
            raise EngineError("Voice conversion provider authentication failed.")
        if resp.status_code == 429:
            raise EngineError(
                "Voice conversion provider rate limit reached. Try again shortly."
            )
        if resp.status_code >= 400:
            raise EngineError("The voice conversion provider failed to process the audio.")
        if job_id in self._cancelled:
            self._cancelled.discard(job_id)
            raise asyncio.CancelledError()
        return resp.content

    def _store_temp_output(
        self, audio_bytes: bytes, output_format: str, source: Dict[str, Any]
    ) -> Dict[str, Any]:
        from ..temp_store import register_temp_file

        suffix = ".wav" if output_format in LOSSLESS_FORMATS else f".{output_format}"
        fd, path = tempfile.mkstemp(prefix=f"vc_{uuid.uuid4().hex}_", suffix=suffix)
        with os.fdopen(fd, "wb") as fh:
            fh.write(audio_bytes)
        register_temp_file(path)
        return {
            "output_file": os.path.basename(path),
            "output_format": "wav" if output_format in LOSSLESS_FORMATS else output_format,
            "duration_seconds": source.get("duration_seconds", 0),
            "size_bytes": len(audio_bytes),
            "lossless": output_format in LOSSLESS_FORMATS,
        }
