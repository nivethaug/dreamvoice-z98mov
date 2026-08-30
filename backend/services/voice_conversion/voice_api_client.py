"""Server-side client for the shared Voice API (RunPod Seed-VC frontend).

Security: VOICE_API_KEY is read from the backend environment only.
It is never logged, never returned in API responses, never sent to the frontend.
"""
from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urljoin

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

# Exact user-friendly messages required by the product spec.
ERROR_MESSAGES = {
    400: "Voice conversion request was invalid.",
    401: "Voice conversion service authentication failed.",
    403: "Voice conversion service authentication failed.",
    413: "Your media file is too large.",
    422: "Your audio or voice reference is not supported.",
    429: "Voice conversion is temporarily busy. Please try again shortly.",
    502: "Voice conversion failed. Your file was not changed.",
    504: "Voice conversion is taking longer than expected. Please try again.",
}
DEFAULT_ERROR = "Voice conversion failed. Your file was not changed."

# Only these Seed-VC settings may be sent to the Voice API.
ALLOWED_SETTINGS = {
    "diffusion_steps",
    "length_adjust",
    "inference_cfg_rate",
    "f0_condition",
    "auto_f0_adjust",
    "pitch_shift",
}


class VoiceApiError(Exception):
    def __init__(self, message: str, status: Optional[int] = None,
                 retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.status = status
        self.retryable = retryable


def sanitize_settings(settings_in: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Restrict outbound settings to the legit Seed-VC parameter set."""
    if not settings_in:
        return {}
    out = {}
    for key in ALLOWED_SETTINGS:
        if key in settings_in and settings_in[key] is not None:
            out[key] = settings_in[key]
    return out


class VoiceApiClient:
    """Calls POST {base}/v1/voice/convert with Bearer auth."""

    def __init__(self, base_url: Optional[str] = None,
                 api_key: Optional[str] = None,
                 timeout: Optional[float] = None):
        self.base_url = (base_url or settings.voice_api_base_url).rstrip("/") + "/"
        self.api_key = api_key or settings.voice_api_key
        self.timeout = timeout or settings.voice_api_timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def convert(
        self,
        source_audio_url: str,
        target_voice_url: str,
        source_language: str = "ta",
        output_format: str = "wav",
        settings_map: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Perform a conversion. Returns the parsed Voice API JSON response.

        Raises VoiceApiError with the exact user-friendly message on failure.
        """
        if not self.configured:
            raise VoiceApiError(
                "Voice conversion is not configured yet.", status=503
            )

        url = urljoin(self.base_url, "v1/voice/convert")
        payload = {
            "source_audio_url": source_audio_url,
            "target_voice_url": target_voice_url,
            "source_language": source_language,
            "output_format": output_format,
            "settings": sanitize_settings(settings_map),
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        attempt = 0
        max_attempts = 3
        last_exc: Optional[VoiceApiError] = None
        while attempt < max_attempts:
            attempt += 1
            try:
                return await self._post(url, payload, headers)
            except VoiceApiError as exc:
                last_exc = exc
                if not exc.retryable or attempt >= max_attempts:
                    raise
                await asyncio.sleep(2.0 * attempt)
        raise last_exc or VoiceApiError(DEFAULT_ERROR)

    async def _post(self, url, payload, headers) -> Dict[str, Any]:
        client = getattr(self, "_http", None)  # test injection point
        try:
            if client is not None:
                resp = await client.post(url, json=payload, headers=headers)
            else:
                async with httpx.AsyncClient(timeout=self.timeout) as hc:
                    resp = await hc.post(url, json=payload, headers=headers)
        except (httpx.TimeoutException, TimeoutError, asyncio.TimeoutError):
            raise VoiceApiError(ERROR_MESSAGES[504], status=504, retryable=False)
        except httpx.HTTPError as exc:
            logger.warning("voice-api network error (no secrets logged): %s",
                           type(exc).__name__)
            raise VoiceApiError(DEFAULT_ERROR, status=502, retryable=True)

        if resp.status_code == 200:
            try:
                return resp.json()
            except ValueError:
                raise VoiceApiError(DEFAULT_ERROR, status=502, retryable=True)

        # Map provider status to user-friendly message.
        if resp.status_code in (429, 500, 502, 503, 504):
            msg = ERROR_MESSAGES.get(resp.status_code, DEFAULT_ERROR)
            raise VoiceApiError(msg, status=resp.status_code,
                                retryable=resp.status_code == 429)
        # Non-retryable client errors (400/401/403/413/422 etc.)
        msg = ERROR_MESSAGES.get(resp.status_code,
                                 f"Voice conversion failed (HTTP {resp.status_code}).")
        raise VoiceApiError(msg, status=resp.status_code, retryable=False)

    async def download_output(self, url: str,
                              dest_dir: Optional[Path] = None) -> Path:
        """Download a converted output to a local temp file."""
        dest_dir = dest_dir or Path(tempfile.gettempdir())
        suffix = ".wav"
        if ".mp3" in url.lower():
            suffix = ".mp3"
        fd, path_str = tempfile.mkstemp(prefix="dv_convert_", suffix=suffix,
                                        dir=str(dest_dir))
        import os
        os.close(fd)
        injected = getattr(self, "_http", None)  # test seam
        try:
            if injected is not None:
                resp_obj = await injected.get(url)
                content = getattr(resp_obj, "content", b"") or b""
                if getattr(resp_obj, "status_code", 200) != 200:
                    raise VoiceApiError(
                        "Converted output could not be downloaded.",
                        status=resp_obj.status_code)
                Path(path_str).write_bytes(content)
                return Path(path_str)
            async with httpx.AsyncClient(timeout=self.timeout,
                                         follow_redirects=True) as client:
                async with client.stream("GET", url) as resp:
                    if resp.status_code != 200:
                        raise VoiceApiError(
                            "Converted output could not be downloaded.",
                            status=resp.status_code)
                    with open(path_str, "wb") as fh:
                        async for chunk in resp.aiter_bytes():
                            fh.write(chunk)
        except httpx.HTTPError:
            raise VoiceApiError("Converted output could not be downloaded.",
                                status=502, retryable=True)
        return Path(path_str)


_client: Optional[VoiceApiClient] = None


def get_voice_api_client() -> VoiceApiClient:
    global _client
    if _client is None:
        _client = VoiceApiClient()
    return _client
