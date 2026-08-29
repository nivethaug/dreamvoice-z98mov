"""OpenRouter provider client (STT / TTS / LLM only — NOT voice conversion).

Documented endpoints used:
  STT: POST https://openrouter.ai/api/v1/audio/transcriptions
  TTS: POST https://openrouter.ai/api/v1/audio/speech
  LLM: POST https://openrouter.ai/api/v1/chat/completions
  Catalog: GET https://openrouter.ai/api/v1/models

Model IDs are configurable via OPENROUTER_STT_MODEL / _TTS_MODEL / _LLM_MODEL.
The API key (OPENROUTER_API_KEY) stays backend-only and is never logged.

Voice conversion is explicitly NOT routed here — OpenRouter has no
audio-to-audio voice-conversion model. See services/voice_conversion.
"""
import base64
import logging
from typing import Any, Dict, List, Optional

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Transient HTTP statuses eligible for retry. Permanent errors (4xx auth /
# validation) are never retried.
RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class OpenRouterError(Exception):
    """Safe, user-facing OpenRouter failure."""

    def __init__(self, message: str, status_code: int = 502, retryable: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


class OpenRouterProvider:
    """HTTP client for OpenRouter STT / TTS / LLM operations."""

    name = "openrouter"

    def __init__(self, api_key: Optional[str] = None, timeout: float = 120.0):
        self._api_key = api_key or settings.OPENROUTER_API_KEY
        self._timeout = timeout

    # ---------------------------------------------------------- helpers
    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    def _headers(self) -> Dict[str, str]:
        if not self._api_key:
            raise OpenRouterError(
                "OpenRouter is not configured (missing API key).", status_code=503
            )
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        max_attempts: int = 3,
    ) -> httpx.Response:
        """Perform a request with controlled retries on transient errors."""
        url = f"{OPENROUTER_BASE_URL}{path}"
        last_exc: Optional[OpenRouterError] = None
        for attempt in range(1, max_attempts + 1):
            try:
                resp = httpx.request(
                    method,
                    url,
                    json=json_body,
                    data=data,
                    files=files,
                    headers=self._headers() if not files else {
                        "Authorization": f"Bearer {self._api_key}"
                    },
                    timeout=self._timeout,
                )
            except httpx.TimeoutException:
                last_exc = OpenRouterError(
                    "OpenRouter request timed out.", status_code=504, retryable=True
                )
                continue
            except httpx.HTTPError:
                last_exc = OpenRouterError(
                    "Could not reach OpenRouter.", status_code=502, retryable=True
                )
                continue

            if resp.status_code < 400:
                return resp

            retryable = resp.status_code in RETRYABLE_STATUS
            # Never log response bodies — may echo request content.
            last_exc = OpenRouterError(
                f"OpenRouter error (HTTP {resp.status_code}).",
                status_code=resp.status_code if resp.status_code < 500 else 502,
                retryable=retryable,
            )
            if not retryable:
                raise last_exc
        raise last_exc or OpenRouterError("OpenRouter request failed.")

    # -------------------------------------------------------------- STT
    def transcribe(
        self,
        audio_bytes: bytes,
        filename: str = "audio.wav",
        model: Optional[str] = None,
        language: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Speech-to-text via POST /audio/transcriptions.

        `language` uses ISO codes (ta, en, hi, ...) — Tamil-first support.
        """
        model = model or settings.OPENROUTER_STT_MODEL
        if not model:
            raise OpenRouterError(
                "No STT model configured (OPENROUTER_STT_MODEL).", status_code=503
            )
        data: Dict[str, str] = {"model": model}
        if language:
            data["language"] = language
        resp = self._request(
            "POST",
            "/audio/transcriptions",
            data=data,
            files={"file": (filename, audio_bytes)},
        )
        return resp.json()

    # -------------------------------------------------------------- TTS
    def speech(
        self,
        text: str,
        model: Optional[str] = None,
        voice: Optional[str] = None,
        response_format: str = "wav",
    ) -> bytes:
        """Text-to-speech via POST /audio/speech. Returns raw audio bytes."""
        model = model or settings.OPENROUTER_TTS_MODEL
        if not model:
            raise OpenRouterError(
                "No TTS model configured (OPENROUTER_TTS_MODEL).", status_code=503
            )
        body: Dict[str, Any] = {
            "model": model,
            "input": text,
            "response_format": response_format,
        }
        if voice:
            body["voice"] = voice
        resp = self._request("/audio/speech" and "POST", "/audio/speech", json_body=body)
        if resp.headers.get("content-type", "").startswith("audio/"):
            return resp.content
        # Some models return JSON with base64 audio.
        try:
            payload = resp.json()
            b64 = payload.get("audio") or payload.get("data") or ""
            if b64:
                return base64.b64decode(b64)
        except Exception:
            pass
        raise OpenRouterError("OpenRouter TTS returned no audio.", status_code=502)

    # -------------------------------------------------------------- LLM
    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """LLM chat completion (translation, cleanup, subtitle generation)."""
        model = model or settings.OPENROUTER_LLM_MODEL
        if not model:
            raise OpenRouterError(
                "No LLM model configured (OPENROUTER_LLM_MODEL).", status_code=503
            )
        body: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens:
            body["max_tokens"] = max_tokens
        resp = self._request("POST", "/chat/completions", json_body=body)
        return resp.json()

    # --------------------------------------------------------- catalog
    def list_models(self) -> List[Dict[str, Any]]:
        """Model catalog for capability discovery (no auth strictly needed)."""
        resp = httpx.get(
            f"{OPENROUTER_BASE_URL}/models", timeout=30
        )
        resp.raise_for_status()
        return resp.json().get("data", [])

    def model_supports_capability(
        self, model_id: str, input_type: str, output_type: str
    ) -> bool:
        """Best-effort capability check from the model catalog architecture."""
        try:
            for m in self.list_models():
                if m.get("id") == model_id:
                    arch = (m.get("architecture") or {})
                    inp = (arch.get("input_modalities") or arch.get("input_modalities") or [])
                    out = (arch.get("output_modalities") or [])
                    return input_type in inp and output_type in out
        except Exception:
            return False
        return False
