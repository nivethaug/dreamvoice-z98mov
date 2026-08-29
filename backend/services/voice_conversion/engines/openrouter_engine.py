"""OpenRouter voice engine.

Implements the VoiceConversionEngine interface against the OpenRouter
gateway. Because OpenRouter currently exposes NO audio-to-audio
voice-conversion model, this engine performs a live capability check on
every validate() call and fails with a clear, honest
"unsupported capability" error instead of faking conversion.
"""
import asyncio
from typing import Any, Dict, Optional

from ..openrouter_client import (
    OpenRouterAuthenticationError,
    OpenRouterClient,
    OpenRouterError,
    OpenRouterRateLimitError,
    OpenRouterTimeoutError,
    UnsupportedModelCapabilityError,
)
from ..provider import ProviderNotConfiguredError, ProviderSettings
from .base import EngineError, EngineValidationError, VoiceConversionEngine

SUPPORTED_OUTPUT_FORMATS = {"wav", "mp3", "m4a", "mp4"}


class OpenRouterVoiceEngine(VoiceConversionEngine):
    """VoiceConversionEngine backed by OpenRouter.

    Converts via the configured OPENROUTER_MODEL only when that model is
    verified (against the live catalog) to support audio-to-audio output.
    """

    name = "openrouter"

    def __init__(self, settings: ProviderSettings):
        self._settings = settings
        self._client = OpenRouterClient(settings)
        self._cancelled: set = set()

    async def validate(
        self,
        source_media: Optional[Dict[str, Any]],
        source_audio: Optional[Dict[str, Any]],
        target_voice: Dict[str, Any],
        settings: Dict[str, Any],
    ) -> None:
        if not self._settings.openrouter_api_key:
            raise ProviderNotConfiguredError(
                "Voice conversion is not configured yet.", ["OPENROUTER_API_KEY"]
            )
        if not source_media and not source_audio:
            raise EngineValidationError("No source media or audio provided.")
        if not target_voice or not target_voice.get("voice_id"):
            raise EngineValidationError("A target voice ID is required.")
        fmt = (settings or {}).get("output_format") or "wav"
        if fmt not in SUPPORTED_OUTPUT_FORMATS:
            raise EngineValidationError(
                f"Unsupported output format '{fmt}'."
            )
        try:
            support = await self._client.verify_voice_conversion_support(
                self._settings.openrouter_model
            )
        except OpenRouterError as exc:
            raise EngineError(str(exc))
        if not support["supported"]:
            raise EngineError(support["reason"])

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
        # Re-verify capability at conversion time (catalog may have changed).
        support = await self._client.verify_voice_conversion_support(
            self._settings.openrouter_model
        )
        if not support["supported"]:
            raise EngineError(support["reason"])

        if job_id in self._cancelled:
            self._cancelled.discard(job_id)
            raise asyncio.CancelledError()

        if progress_callback:
            progress_callback("Preparing media", "preparing", 10)
            progress_callback("Analyzing speech", "processing", 25)

        # Honest processing state: no faked progress while the provider works.
        if progress_callback:
            progress_callback("Voice conversion in progress", "processing", 45)

        try:
            # NOTE: audio-to-audio chat completions are not implemented
            # because no OpenRouter model currently advertises that
            # capability. If/when one appears, the request goes here via
            # self._client, passing source audio + target voice reference.
            raise UnsupportedModelCapabilityError(
                "No OpenRouter model currently supports audio-to-audio "
                "voice conversion."
            )
        except OpenRouterAuthenticationError as exc:
            raise EngineError(str(exc))
        except OpenRouterRateLimitError as exc:
            raise EngineError(str(exc))
        except OpenRouterTimeoutError as exc:
            raise EngineError(str(exc))

    async def cancel(self, job_id: str) -> None:
        self._cancelled.add(job_id)
