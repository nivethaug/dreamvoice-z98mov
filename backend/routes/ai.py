"""AI provider status routes (safe — no secrets, no private URLs)."""
from fastapi import APIRouter

from services.ai import ai_provider_status
from services.voice_conversion import provider_status as vc_status

router = APIRouter(prefix="/api/ai", tags=["ai-providers"])


@router.get("/providers/status")
async def get_ai_provider_status():
    return ai_provider_status()


@router.get("/voice-conversion/status")
async def get_voice_conversion_status():
    """Alias kept for convenience; canonical route is
    /api/voice-conversion/status."""
    return vc_status()
