"""
Configuration settings for DreamVoice backend (production architecture).

All provider credentials come from environment variables only.
Secrets are never exposed to the frontend or logged.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def _get(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


class Settings:
    """Application settings."""

    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/dreampilot"
    )

    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dreampilot-secret-key-change-in-production")

    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # Project
    PROJECT_NAME: str = os.getenv("PROJECT_NAME", "DreamPilot API")

    # ------------------------------------------------------------- Redis
    REDIS_URL: str = _get("REDIS_URL")  # e.g. redis://localhost:6379/0

    # ---------------------------------------------------- Object storage
    STORAGE_PROVIDER: str = _get("STORAGE_PROVIDER", "local").lower()  # s3|local
    STORAGE_ENDPOINT: str = _get("STORAGE_ENDPOINT")
    STORAGE_BUCKET: str = _get("STORAGE_BUCKET")
    STORAGE_REGION: str = _get("STORAGE_REGION")
    STORAGE_ACCESS_KEY: str = _get("STORAGE_ACCESS_KEY")
    STORAGE_SECRET_KEY: str = _get("STORAGE_SECRET_KEY")

    # ------------------------------------------------- Provider routing
    # Central routing: swap providers without frontend changes.
    VOICE_CONVERSION_PROVIDER: str = _get("VOICE_CONVERSION_PROVIDER").lower()
    STT_PROVIDER: str = _get("STT_PROVIDER", "openrouter").lower()
    TTS_PROVIDER: str = _get("TTS_PROVIDER", "openrouter").lower()
    LLM_PROVIDER: str = _get("LLM_PROVIDER", "openrouter").lower()
    AUDIO_ENHANCEMENT_PROVIDER: str = _get("AUDIO_ENHANCEMENT_PROVIDER", "none").lower()

    # ------------------------------------------------------- OpenRouter
    # NOTE: OpenRouter is used for STT / TTS / LLM ONLY.
    # It is explicitly NOT the voice-to-voice conversion engine.
    OPENROUTER_API_KEY: str = _get("OPENROUTER_API_KEY")
    OPENROUTER_STT_MODEL: str = _get("OPENROUTER_STT_MODEL")
    OPENROUTER_TTS_MODEL: str = _get("OPENROUTER_TTS_MODEL")
    OPENROUTER_LLM_MODEL: str = _get("OPENROUTER_LLM_MODEL")

    # ------------------------------------------------------------ RunPod
    # Remote GPU inference for voice conversion (Seed-VC) and future
    # GPU workloads (RVC, IndicF5, DeepFilterNet).
    RUNPOD_API_KEY: str = _get("RUNPOD_API_KEY")
    RUNPOD_VOICE_ENDPOINT_ID: str = _get("RUNPOD_VOICE_ENDPOINT_ID")
    RUNPOD_VOICE_MODEL: str = _get("RUNPOD_VOICE_MODEL", "seed-vc")

    # ---------------------------------------------------- Shared Voice API
    # Server-side only: DreamVoice backend -> shared Voice API -> RunPod
    # Seed-VC. The key NEVER reaches the frontend or logs.
    voice_api_base_url: str = _get(
        "VOICE_API_BASE_URL", "https://voice-api.dreamagent.cloud"
    )
    voice_api_key: str = _get("VOICE_API_KEY")
    voice_api_timeout: float = float(_get("VOICE_API_TIMEOUT", "600"))
    public_media_base_url: str = _get(
        "PUBLIC_MEDIA_BASE_URL", "https://dreamvoice-z98mov-api.dreamagent.cloud"
    )

    # Legacy generic remote VC endpoint (kept for compatibility).
    VOICE_CONVERSION_API_URL: str = _get("VOICE_CONVERSION_API_URL")
    VOICE_CONVERSION_API_KEY: str = _get("VOICE_CONVERSION_API_KEY")
    VOICE_CONVERSION_MODEL: str = _get("VOICE_CONVERSION_MODEL", "seed-vc")
    OPENROUTER_MODEL: str = _get("OPENROUTER_MODEL")

    # Environment: dev allows explicit mock engine; production never
    # silently falls back to mock AI.
    ENVIRONMENT: str = _get("ENVIRONMENT", "development").lower()


settings = Settings()
