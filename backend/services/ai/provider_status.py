"""Safe AI provider status reporting (no secrets, no private URLs)."""
from typing import Any, Dict

from core.config import settings
from services.voice_conversion.job_manager import provider_status as vc_status


def ai_provider_status() -> Dict[str, Any]:
    """Aggregated provider status for GET /api/ai/providers/status."""
    vc = vc_status()

    openrouter_key = bool(settings.OPENROUTER_API_KEY)
    stt_configured = openrouter_key and bool(settings.OPENROUTER_STT_MODEL)
    tts_configured = openrouter_key and bool(settings.OPENROUTER_TTS_MODEL)
    llm_configured = openrouter_key and bool(settings.OPENROUTER_LLM_MODEL)

    def _entry(provider: str, configured: bool) -> Dict[str, Any]:
        return {"provider": provider, "configured": configured}

    return {
        "voice_conversion": {
            "provider": vc.get("provider"),
            "configured": vc.get("configured", False),
            "available": vc.get("real_conversion_available", False),
        },
        "stt": _entry(settings.STT_PROVIDER, stt_configured),
        "tts": _entry(settings.TTS_PROVIDER, tts_configured),
        "llm": _entry(settings.LLM_PROVIDER, llm_configured),
        "audio_enhancement": {"provider": settings.AUDIO_ENHANCEMENT_PROVIDER},
        "queue": {
            "celery": bool(settings.REDIS_URL),
        },
        "storage": {
            "provider": settings.STORAGE_PROVIDER,
            "configured": settings.STORAGE_PROVIDER == "local"
            or bool(settings.STORAGE_BUCKET and settings.STORAGE_ACCESS_KEY),
        },
    }
