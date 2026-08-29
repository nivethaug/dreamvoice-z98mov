"""OpenRouter client - gateway for compatible AI models.

CRITICAL MODEL RULE:
OpenRouter does NOT currently expose any audio-to-audio voice-conversion
model. Every audio-input model on OpenRouter outputs text (transcription /
understanding) or music (Lyria). This client therefore:

  * exposes general model-catalog + chat access for future compatible
    functionality (speech-to-text, text generation, TTS where appropriate)
  * refuses to be used for voice conversion unless the configured model's
    architecture explicitly supports audio input AND audio output
    (audio-to-audio), verified live against the model catalog.

The API key is read from the OPENROUTER_API_KEY environment variable and is
never logged, returned, or exposed to the frontend.
"""
import asyncio
from typing import Any, Dict, Optional

import httpx

from .provider import ProviderSettings

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
MODELS_CACHE_TTL_SECONDS = 300
REQUEST_TIMEOUT_SECONDS = 120


class OpenRouterError(Exception):
    """Base OpenRouter client error with a user-safe message."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        self.status_code = status_code
        super().__init__(message)


class OpenRouterAuthenticationError(OpenRouterError):
    pass


class OpenRouterRateLimitError(OpenRouterError):
    pass


class OpenRouterTimeoutError(OpenRouterError):
    pass


class UnsupportedModelCapabilityError(OpenRouterError):
    """The configured model cannot perform the requested audio operation."""


class OpenRouterClient:
    def __init__(self, settings: ProviderSettings):
        self._settings = settings
        self._models_cache: Optional[Dict[str, Any]] = None
        self._models_cache_at: float = 0.0

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._settings.openrouter_api_key}",
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------- catalog

    async def get_model(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Fetch model metadata from the public catalog (cached)."""
        import time

        now = time.time()
        if self._models_cache is None or now - self._models_cache_at > MODELS_CACHE_TTL_SECONDS:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(f"{OPENROUTER_BASE_URL}/models")
            if resp.status_code != 200:
                raise OpenRouterError(
                    "Could not reach the model provider catalog.", resp.status_code
                )
            data = resp.json().get("data", [])
            self._models_cache = {m.get("id"): m for m in data if m.get("id")}
            self._models_cache_at = now
        return self._models_cache.get(model_id)

    def _audio_to_audio_capable(self, model: Dict[str, Any]) -> bool:
        arch = model.get("architecture") or {}
        inputs = arch.get("input_modalities") or []
        outputs = arch.get("output_modalities") or []
        return "audio" in inputs and "audio" in outputs

    async def verify_voice_conversion_support(self, model_id: str) -> Dict[str, Any]:
        """Verify the configured model truly supports audio-to-audio conversion.

        Returns {"supported": bool, "reason": str}. Never guesses - the check
        is performed against the live model catalog.
        """
        if not model_id:
            return {
                "supported": False,
                "reason": "No OPENROUTER_MODEL configured.",
            }
        try:
            model = await self.get_model(model_id)
        except OpenRouterError as exc:
            return {
                "supported": False,
                "reason": f"Provider catalog unavailable: {exc}",
            }
        if model is None:
            return {
                "supported": False,
                "reason": f"Model '{model_id}' does not exist on the provider.",
            }
        if not self._audio_to_audio_capable(model):
            return {
                "supported": False,
                "reason": (
                    f"Model '{model_id}' does not support audio-to-audio voice "
                    "conversion (requires audio input AND audio output)."
                ),
            }
        return {"supported": True, "reason": "Model supports audio-to-audio conversion."}

    # ------------------------------------------------------------- requests

    async def _request(
        self, method: str, path: str, json_body: Optional[Dict[str, Any]] = None
    ) -> httpx.Response:
        url = f"{OPENROUTER_BASE_URL}{path}"
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                resp = await client.request(
                    method, url, headers=self._headers(), json=json_body
                )
        except httpx.TimeoutException:
            raise OpenRouterTimeoutError(
                "The model provider timed out. Please try again."
            )
        except httpx.HTTPError:
            raise OpenRouterError("Could not reach the model provider.")
        if resp.status_code in (401, 403):
            raise OpenRouterAuthenticationError(
                "Model provider authentication failed."
            )
        if resp.status_code == 429:
            raise OpenRouterRateLimitError(
                "Model provider rate limit reached. Please try again shortly."
            )
        if resp.status_code >= 400:
            raise OpenRouterError(
                "The model provider returned an error.", resp.status_code
            )
        return resp

    async def chat_completion(self, messages: list, **kwargs) -> Dict[str, Any]:
        """General-purpose chat completion access (text/audio-input models).

        Kept for future compatible functionality (transcription helpers,
        text generation). NOT used for voice conversion.
        """
        resp = await self._request(
            "POST",
            "/chat/completions",
            {"model": self._settings.openrouter_model, "messages": messages, **kwargs},
        )
        return resp.json()
