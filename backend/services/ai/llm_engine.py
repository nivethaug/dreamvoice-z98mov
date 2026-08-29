"""LLM engine abstraction (translation, transcript cleanup, subtitles)."""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from core.config import settings
from .openrouter_provider import OpenRouterError, OpenRouterProvider


class LLMError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class LLMProvider(ABC):
    name: str = "base"

    @abstractmethod
    def chat(self, messages: List[Dict[str, str]], **kwargs: Any) -> Dict[str, Any]:
        ...


class OpenRouterLLMProvider(LLMProvider):
    name = "openrouter"

    def __init__(self, client: Optional[OpenRouterProvider] = None):
        self._client = client or OpenRouterProvider()

    def chat(self, messages, **kwargs):
        try:
            return self._client.chat(messages, **kwargs)
        except OpenRouterError as exc:
            raise LLMError(str(exc), exc.status_code) from exc


class LLMEngine:
    def __init__(self, provider: LLMProvider):
        self._provider = provider

    @property
    def provider_name(self) -> str:
        return self._provider.name

    def chat(self, messages, **kwargs):
        return self._provider.chat(messages, **kwargs)


_engine: Optional[LLMEngine] = None


def get_llm_engine() -> Optional[LLMEngine]:
    global _engine
    if settings.LLM_PROVIDER == "openrouter":
        client = OpenRouterProvider()
        if not client.configured or not settings.OPENROUTER_LLM_MODEL:
            return None
        _engine = LLMEngine(OpenRouterLLMProvider(client))
        return _engine
    return None
