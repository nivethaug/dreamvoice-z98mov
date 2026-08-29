"""Voice conversion job API routes (provider-backed)."""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from services.voice_conversion import (
    JobNotCancellableError,
    JobNotFoundError,
    job_manager,
    provider_status,
)
from services.voice_conversion.provider import (
    ProviderConfigError,
    ProviderNotConfiguredError,
)

router = APIRouter(prefix="/api/voice-conversion", tags=["voice-conversion"])


@router.get("/status")
async def get_provider_status():
    """Safe provider status - no secrets, booleans only."""
    return provider_status()


@router.post("/jobs")
async def create_job(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"detail": "Invalid JSON body."})
    if not isinstance(payload, dict):
        return JSONResponse(
            status_code=400, content={"detail": "Request body must be a JSON object."}
        )
    try:
        job = await job_manager.create_job(payload)
    except ProviderNotConfiguredError as exc:
        return JSONResponse(status_code=503, content={"detail": str(exc)})
    except ProviderConfigError as exc:
        return JSONResponse(status_code=500, content={"detail": str(exc)})
    except Exception as exc:
        return JSONResponse(status_code=422, content={"detail": str(exc)})
    return JSONResponse(status_code=201, content=job)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    try:
        job = job_manager.get_job(job_id)
    except JobNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "Job not found."})
    return job


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    try:
        return await job_manager.cancel_job(job_id)
    except JobNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "Job not found."})
    except JobNotCancellableError as exc:
        return JSONResponse(status_code=409, content={"detail": str(exc)})
