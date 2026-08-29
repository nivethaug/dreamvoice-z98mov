"""TTS engine abstraction (provider-agnostic).

Initial provider: OpenRouter (POST /api/v1/audio/speech).
Open architecture for later: IndicF5 on RunPod (Tamil-first), or another
hosted provider — implemented as another TTSProvider.
"""
from abc import ABC, abstractmethod
from typing import Optional

from core.config import settings
from .openrouter_provider import OpenRouterError, OpenRouterProvider


class TTSError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class TTSProvider(ABC):
    name: str = "base"

    @abstractmethod
    def synthesize(
        self, text: str, language: Optional[str] = None, voice: Optional[str] = None
    ) -> bytes:
        """Return synthesized audio bytes (WAV preferred)."""


class OpenRouterTTSProvider(TTSProvider):
    name = "openrouter"

    def __init__(self, client: Optional[OpenRouterProvider] = None):
        self._client = client or OpenRouterProvider()

    def synthesize(
        self, text: str, language: Optional[str] = None, voice: Optional[str] = None
    ) -> bytes:
        try:
            return self._client.speech(text, voice=voice)
        except OpenRouterError as exc:
            raise TTSError(str(exc), exc.status_code) from exc


class TTSEngine:
    """Routes TTS to the configured provider (TTS_PROVIDER)."""

    def __init__(self, provider: TTSProvider):
        self._provider = provider

    @property
    def provider_name(self) -> str:
        return self._provider.name

    def synthesize(
        self, text: str, language: Optional[str] = None, voice: Optional[str] = None
    ) -> bytes:
        return self._provider.synthesize(text, language, voice)


_engine: Optional[TTSEngine] = None


def get_tts_engine() -> Optional[TTSEngine]:
    global _engine
    provider_name = settings.TTS_PROVIDER
    if provider_name == "openrouter":
        client = OpenRouterProvider()
        if not client.configured or not settings.OPENROUTER_TTS_MODEL:
            return None
        _engine = TTSEngine(OpenRouterTTSProvider(client))
        return _engine
    # Future: runpod IndicF5 Tamil TTS plugs in here.
    return None
