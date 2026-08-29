"""Seed-VC GPU Worker API.

Endpoints:
  GET  /health
  GET  /v1/capabilities
  POST /v1/voice/convert              (multipart: source, reference, model, settings JSON)
  GET  /v1/voice/jobs/{job_id}
  GET  /v1/voice/jobs/{job_id}/result (download converted WAV)
  POST /v1/voice/jobs/{job_id}/cancel

Auth: X-API-Key header must match VOICE_WORKER_API_KEY.
"""
import asyncio
import json
import os
import threading

from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse

from app.config import settings
from app.audio_processing import (
    AudioValidationError, validate_audio, normalize_to_wav, validate_output)
from app.job_manager import JobManager, JobConflict, JobNotFound, job_manager, _Cancelled
from app.seed_vc_engine import seed_vc_engine, SeedVCNotAvailable
from app.temp_store import temp_store

app = FastAPI(title="Seed-VC Voice Conversion Worker", version="1.0.0")


def require_auth(x_api_key: str | None = Header(default=None)):
    if not settings.voice_worker_api_key:
        raise HTTPException(503, "Worker not configured: VOICE_WORKER_API_KEY missing")
    if x_api_key != settings.voice_worker_api_key:
        raise HTTPException(401, "Invalid or missing API key")


def require_files(source: UploadFile | None, reference: UploadFile | None):
    if not source or not source.filename:
        raise HTTPException(400, "Missing source audio file")
    if not reference or not reference.filename:
        raise HTTPException(400, "Missing target voice reference file")


async def save_upload(upload: UploadFile, job_dir: str, prefix: str) -> str:
    import re
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.basename(upload.filename))
    path = os.path.join(job_dir, f"{prefix}_{safe}")
    size = 0
    with open(path, "wb") as f:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > settings.max_upload_bytes:
                f.close()
                os.remove(path)
                raise HTTPException(413, "File exceeds size limit")
            f.write(chunk)
    return path


def _pipeline(job_id: str, job: dict, source_path: str, reference_path: str,
              settings_dict: dict | None, update):
    """Runs in worker thread: validate -> normalize -> convert -> verify."""
    if job_manager.is_cancelled(job_id):
        raise _Cancelled()

    src_info = validate_audio(source_path, settings.max_source_duration)
    ref_info = validate_audio(reference_path, settings.max_reference_duration)
    update(job_id, progress=20.0, stage="preparing")

    job_dir = temp_store.path_for(job_id)
    source_wav = normalize_to_wav(source_path, job_dir)
    reference_wav = normalize_to_wav(reference_path, job_dir)
    update(job_id, status="processing", progress=35.0, stage="processing")

    out = seed_vc_engine.convert(
        source_wav, reference_wav, job_dir, settings_dict,
        progress_cb=lambda st, p: update(job_id, stage=st, progress=p))

    if job_manager.is_cancelled(job_id):
        raise _Cancelled()
    validate_output(out, src_info["duration"])
    update(job_id, progress=90.0, stage="finalizing")
    job_manager.complete(job_id, {
        "output_format": "wav",
        "duration": src_info["duration"],
        "sample_rate": 44100,
        "download_path": f"/v1/voice/jobs/{job_id}/result",
    })


@app.get("/health")
async def health():
    avail = seed_vc_engine.availability()
    return {
        "status": "ok" if avail["ready"] else "degraded",
        "gpu_available": avail["gpu_available"],
        "engine_ready": avail["ready"],
    }


@app.get("/v1/capabilities")
async def capabilities(x_api_key: str | None = Header(default=None)):
    require_auth(x_api_key)
    avail = seed_vc_engine.availability()
    return {
        "voice_conversion": True,
        "model": "seed-vc",
        "input_audio_formats": ["wav", "mp3", "m4a", "flac", "ogg", "aac"],
        "output_audio_formats": ["wav"],
        "max_duration": int(settings.max_source_duration),
        "gpu_available": avail["gpu_available"],
        "ready": avail["ready"],
        "error": avail["error"],
    }


@app.post("/v1/voice/convert")
async def convert(
    source: UploadFile | None = File(default=None),
    reference: UploadFile | None = File(default=None),
    model: str = Form(default="seed-vc"),
    settings_json: str = Form(default=None),
    x_api_key: str | None = Header(default=None),
):
    require_auth(x_api_key)
    require_files(source, reference)
    if model and model != "seed-vc":
        raise HTTPException(400, f"Unsupported model '{model}'; only seed-vc is served")

    try:
        conv_settings = json.loads(settings_json) if settings_json else None
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid settings JSON")

    try:
        seed_vc_engine.load()
    except SeedVCNotAvailable as e:
        raise HTTPException(503, str(e))

    import uuid
    job_id = uuid.uuid4().hex
    job_dir = temp_store.create(job_id)

    src_path = await save_upload(source, job_dir, "src")
    ref_path = await save_upload(reference, job_dir, "ref")

    return job_manager.create(src_path, ref_path, model, conv_settings,
                              _pipeline, job_id=job_id)


@app.get("/v1/voice/jobs/{job_id}")
async def job_status(job_id: str, x_api_key: str | None = Header(default=None)):
    require_auth(x_api_key)
    try:
        return job_manager.public_view(job_manager.get(job_id))
    except JobNotFound:
        raise HTTPException(404, "Job not found")


@app.get("/v1/voice/jobs/{job_id}/result")
async def job_result(job_id: str, x_api_key: str | None = Header(default=None)):
    require_auth(x_api_key)
    try:
        job = job_manager.get(job_id)
    except JobNotFound:
        raise HTTPException(404, "Job not found")
    if job["status"] != "completed" or not job.get("result"):
        raise HTTPException(409, f"Job result unavailable (status: {job['status']})")
    job_dir = temp_store.path_for(job_id)
    if not job_dir:
        raise HTTPException(410, "Result expired and was cleaned up")
    import glob
    matches = sorted(glob.glob(os.path.join(job_dir, "converted_*.wav")))
    if not matches:
        raise HTTPException(410, "Result file no longer available")
    return FileResponse(matches[-1], media_type="audio/wav",
                        filename="converted_audio.wav")


@app.post("/v1/voice/jobs/{job_id}/cancel")
async def job_cancel(job_id: str, x_api_key: str | None = Header(default=None)):
    require_auth(x_api_key)
    try:
        return job_manager.cancel(job_id)
    except JobNotFound:
        raise HTTPException(404, "Job not found")
    except JobConflict as e:
        raise HTTPException(409, str(e))


@app.on_event("startup")
async def startup():
    try:
        seed_vc_engine.load()
    except SeedVCNotAvailable:
        pass  # reported via /health and /v1/capabilities
    def sweeper():
        import time as t
        while True:
            t.sleep(30)
            job_manager.sweep()
    threading.Thread(target=sweeper, daemon=True).start()


@app.on_event("shutdown")
async def shutdown():
    for job_id in list(job_manager._jobs.keys()):
        temp_store.remove(job_id)
