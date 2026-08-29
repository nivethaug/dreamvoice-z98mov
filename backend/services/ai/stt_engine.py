"""STT engine abstraction (provider-agnostic).

Initial provider: OpenRouter (POST /api/v1/audio/transcriptions).
Later: Whisper on RunPod if cost/performance requires — implemented as
another STTProvider without changing callers.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from core.config import settings
from .openrouter_provider import OpenRouterError, OpenRouterProvider


class STTError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class STTProvider(ABC):
    name: str = "base"

    @abstractmethod
    def transcribe(
        self, audio_bytes: bytes, filename: str, language: Optional[str] = None
    ) -> Dict[str, Any]:
        """Return {"text": ..., "language": ..., "duration": ...}."""


class OpenRouterSTTProvider(STTProvider):
    name = "openrouter"

    def __init__(self, client: Optional[OpenRouterProvider] = None):
        self._client = client or OpenRouterProvider()

    def transcribe(
        self, audio_bytes: bytes, filename: str, language: Optional[str] = None
    ) -> Dict[str, Any]:
        try:
            return self._client.transcribe(audio_bytes, filename, language=language)
        except OpenRouterError as exc:
            raise STTError(str(exc), exc.status_code) from exc


class STTEngine:
    """Routes transcription to the configured provider (STT_PROVIDER)."""

    def __init__(self, provider: STTProvider):
        self._provider = provider

    @property
    def provider_name(self) -> str:
        return self._provider.name

    def transcribe(
        self, audio_bytes: bytes, filename: str = "audio.wav",
        language: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._provider.transcribe(audio_bytes, filename, language)


_engine: Optional[STTEngine] = None


def get_stt_engine() -> Optional[STTEngine]:
    """Build the STT engine from central provider routing. None if unset."""
    global _engine
    provider_name = settings.STT_PROVIDER
    if provider_name == "openrouter":
        client = OpenRouterProvider()
        if not client.configured:
            return None
        _engine = STTEngine(OpenRouterSTTProvider(client))
        return _engine
    # Future: runpod whisper provider plugs in here.
    return None
