"""Voice Changer API — real conversion through the existing job manager.

Flow: browser -> these routes -> job_manager (existing lifecycle) ->
VoiceAPIVoiceConversionEngine -> shared Voice API -> RunPod Seed-VC.

The browser never talks to voice-api directly; VOICE_API_KEY never leaves
the backend and is never logged.
"""
from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.voice import Voice
from services.auth_service import AuthService
from services.storage.object_store import StorageError, get_object_store, make_key
from services.storage.public_media import (
    delete_media,
    read_media,
    store_media,
    verify_media_token,
)
from services.voice_conversion.voice_api_media import (
    VoiceApiMediaClient,
    VoiceApiMediaError,
    get_media_client,
)
from services.voice_conversion import job_manager
from services.voice_conversion.job_manager import provider_status
from services.voice_conversion.provider import ProviderNotConfiguredError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice-changer", tags=["voice-changer"])

ALLOWED_SOURCE_EXT = {".mp4", ".mov", ".mp3", ".wav", ".m4a", ".ogg", ".oga"}
ALLOWED_REF_EXT = {".wav", ".mp3", ".m4a", ".ogg", ".oga"}
MAX_SOURCE_BYTES = 500 * 1024 * 1024   # 500MB video (matches frontend)
MAX_AUDIO_BYTES = 100 * 1024 * 1024    # 100MB audio (matches frontend)
MAX_SOURCE_DURATION = 30 * 60          # Voice API contract: 30 minutes
MAX_REFERENCE_DURATION = 10 * 60       # Voice API contract: 10 minutes
VIDEO_EXT = {".mp4", ".mov"}


def _auth(authorization: Optional[str], db: Session):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization format")
    user = AuthService.get_user_by_token(db, parts[1])
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user


# --------------------------------------------------------------- status
@router.get("/status")
async def voice_changer_status():
    """Safe provider status — no keys, no URLs, no secrets."""
    st = provider_status()
    vc = st.get("voice_conversion") or st  # support flat or nested shape
    return {
        "configured": bool(vc.get("configured")),
        "available": bool(vc.get("real_conversion_available") or vc.get("available")),
        "provider": vc.get("provider"),
    }


# ---------------------------------------------------------- media upload
@router.post("/media")
async def upload_source_media(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Upload source media (audio or video) to the object store."""
    _auth(authorization, db)
    name = file.filename or "upload"
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_SOURCE_EXT:
        raise HTTPException(status_code=422, detail="Unsupported media format.")

    cap = MAX_SOURCE_BYTES if ext in VIDEO_EXT else MAX_AUDIO_BYTES
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        size = 0
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > cap:
                tmp.close()
                os.remove(tmp.name)
                raise HTTPException(status_code=413, detail="Your media file is too large.")
            tmp.write(chunk)
        tmp_path = tmp.name

    try:
        # ALL media inspection happens in the shared Voice API (server-side
        # ffprobe). DreamVoice uploads the bytes there and reads metadata.
        media_client = get_media_client()
        try:
            info = await asyncio.to_thread(
                media_client.upload, tmp_path, name
            )
        except VoiceApiMediaError as exc:
            raise HTTPException(
                status_code=(exc.status if exc.status in (400, 413, 415, 422) else 422),
                detail=str(exc),
            )
        va_file_id = str(info.get("file_id") or "")
        duration = float(info.get("duration") or 0)
        audio_meta = info.get("audio") or {}
        has_audio = bool(
            info.get("has_audio")
            or audio_meta.get("present")
            or info.get("media_type") == "audio"
        )
        if not has_audio:
            await asyncio.to_thread(media_client.delete, va_file_id)
            raise HTTPException(status_code=422, detail="Media file has no audio track.")
        if duration <= 0:
            await asyncio.to_thread(media_client.delete, va_file_id)
            raise HTTPException(status_code=422, detail="Media duration could not be determined.")
        if duration > MAX_SOURCE_DURATION:
            await asyncio.to_thread(media_client.delete, va_file_id)
            raise HTTPException(status_code=422, detail="Source media exceeds the 30 minute limit.")

        key = make_key("voice-changer-src", name)
        get_object_store().upload(tmp_path, key)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    # Keep the validated VA copy alive so the engine can reuse it instead
    # of uploading the same (potentially large) file a second time.
    remember_source(key, va_file_id, duration)

    return {
        "media_id": key,
        "storage_key": key,
        "kind": "video" if ext in VIDEO_EXT else "audio",
        "is_video": ext in VIDEO_EXT,
        "filename": name,
        "duration": round(duration, 2),
        "duration_seconds": round(duration, 2),
        "size_bytes": size,
    }


# ---------------------------------------------------------------- voices
class VoiceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    languages: list = ["ta"]
    voice_type: str = "custom"
    rights_confirmed: bool = False


@router.post("/voices")
async def create_voice(
    req: VoiceCreateRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Create a server-side voice record. Authorization requires a reference
    sample + stored rights confirmation."""
    user = _auth(authorization, db)
    if not req.rights_confirmed:
        raise HTTPException(
            status_code=400,
            detail="Voice Rights & Responsibility confirmation is required.",
        )
    voice = Voice(
        user_id=user.id,
        name=req.name,
        description=req.description,
        languages=",".join(req.languages or ["ta"]),
        voice_type=req.voice_type,
        authorization_status="pending",  # becomes authorized once a sample exists
        rights_confirmed_at=datetime.now(timezone.utc),
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)
    return {
        "voice_id": voice.id,
        "name": voice.name,
        "authorized": False,
        "available_for_conversion": False,
        "message": "Voice created. Upload a reference sample to authorize it.",
    }


@router.post("/voices/{voice_id}/reference")
async def upload_voice_reference(
    voice_id: int,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Upload the authorized reference sample for a voice (5-60s recommended,
    10 minutes hard max). Stored server-side; used by Seed-VC as the target."""
    user = _auth(authorization, db)
    voice = db.query(Voice).filter(Voice.id == voice_id).first()
    if not voice or voice.user_id != user.id:
        raise HTTPException(status_code=404, detail="Voice not found.")
    if not voice.rights_confirmed_at:
        raise HTTPException(
            status_code=400,
            detail="Voice Rights & Responsibility confirmation is required first.",
        )

    name = file.filename or "reference"
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_REF_EXT:
        raise HTTPException(status_code=422, detail="Unsupported reference audio format.")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        size = 0
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_AUDIO_BYTES:
                tmp.close()
                os.remove(tmp.name)
                raise HTTPException(status_code=413, detail="Your media file is too large.")
            tmp.write(chunk)
        tmp_path = tmp.name

    norm_path = None
    try:
        # ALL inspection + normalization happens in the shared Voice API.
        media_client = get_media_client()
        try:
            info = await asyncio.to_thread(media_client.upload, tmp_path, name)
        except VoiceApiMediaError as exc:
            raise HTTPException(
                status_code=(exc.status if exc.status in (400, 413, 415, 422) else 422),
                detail=str(exc),
            )
        va_file_id = str(info.get("file_id") or "")
        duration = float(info.get("duration") or 0)
        audio_meta = info.get("audio") or {}
        has_audio = bool(
            info.get("has_audio")
            or audio_meta.get("present")
            or info.get("media_type") == "audio"
        )
        if not has_audio:
            await asyncio.to_thread(media_client.delete, va_file_id)
            raise HTTPException(status_code=422, detail="Reference file has no audio.")
        if duration <= 0:
            await asyncio.to_thread(media_client.delete, va_file_id)
            raise HTTPException(status_code=422, detail="Reference audio duration could not be determined.")
        if duration > MAX_REFERENCE_DURATION:
            await asyncio.to_thread(media_client.delete, va_file_id)
            raise HTTPException(status_code=422, detail="Reference audio exceeds the 10 minute limit.")

        # Normalize to clean 44.1kHz mono WAV via the Voice API — Seed-VC
        # rejects some container/codec combinations (e.g. OGG) with
        # INVALID_INPUT.
        try:
            norm = await asyncio.to_thread(
                media_client.extract_audio, va_file_id, 44100, 1, "wav"
            )
            norm_id = str(norm.get("file_id") or "")
            norm_path = tmp_path + ".norm.wav"
            await asyncio.to_thread(media_client.download, norm_id, norm_path)
            await asyncio.to_thread(media_client.delete, norm_id)
            store_path = norm_path
        except VoiceApiMediaError:
            store_path = tmp_path  # keep original bytes if normalization fails
        finally:
            await asyncio.to_thread(media_client.delete, va_file_id)

        key = make_key(f"voice-ref/{voice.id}", "reference.wav")
        get_object_store().upload(store_path, key)
    finally:
        for p in (tmp_path, norm_path):
            if p:
                try:
                    os.remove(p)
                except OSError:
                    pass

    voice.sample_storage_key = key
    voice.reference_duration_seconds = round(duration, 2)
    voice.authorization_status = "confirmed"
    db.commit()
    return {
        "voice_id": voice.id,
        "authorized": True,
        "reference_duration": round(duration, 2),
        "available_for_conversion": True,
    }


@router.get("/voices")
async def list_voices(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Server-authoritative voice list for the authenticated user."""
    user = _auth(authorization, db)
    voices = (
        db.query(Voice)
        .filter(Voice.user_id == user.id)
        .order_by(Voice.created_at.desc())
        .all()
    )
    return {
        "voices": [
            {
                "voice_id": v.id,
                "name": v.name,
                "description": v.description or "",
                "languages": (v.languages or "ta").split(","),
                "voice_type": v.voice_type or "custom",
                "authorized": (
                    v.authorization_status == "confirmed"
                    and bool(v.rights_confirmed_at)
                    and bool(v.sample_storage_key)
                ),
                "reference_duration": v.reference_duration_seconds,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in voices
        ]
    }


def _get_usable_voice(user, voice_id: int, db: Session) -> Voice:
    """Cost protection: ownership + authorization + reference, all server-side."""
    voice = db.query(Voice).filter(Voice.id == voice_id).first()
    if not voice or voice.user_id != user.id:
        raise HTTPException(status_code=404, detail="Voice not found.")
    if voice.authorization_status != "confirmed" or not voice.rights_confirmed_at:
        raise HTTPException(
            status_code=403,
            detail="This voice is not available for real conversion yet. "
                   "Add an authorized voice sample first.",
        )
    if not voice.sample_storage_key:
        raise HTTPException(
            status_code=403,
            detail="This voice is not available for real conversion yet. "
                   "Add an authorized voice sample first.",
        )
    return voice


# --------------------------------------------------------------- convert
class ConvertRequest(BaseModel):
    media_id: str
    voice_id: int
    source_language: str = "ta"
    settings: Dict[str, Any] = {}


@router.post("/convert")
async def start_conversion(
    req: ConvertRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Create a conversion job in the EXISTING job manager and return job_id.
    The frontend polls GET /api/voice-changer/jobs/{job_id}."""
    user = _auth(authorization, db)

    st = provider_status()
    vc = st.get("voice_conversion") or st  # support flat or nested shape
    if not vc.get("configured"):
        raise HTTPException(status_code=503, detail="Voice conversion is not configured yet.")

    # ---- duplicate submission protection (per user) ----
    for job in job_manager.list_jobs():
        r = job.get("request", {})
        tv = r.get("target_voice", {})
        if (
            job.get("user_id") == user.id
            and job.get("state") in ("queued", "preparing", "processing", "enhancing", "finalizing")
            and tv.get("voice_id") == req.voice_id
            and r.get("source_media", {}).get("storage_key") == req.media_id
        ):
            raise HTTPException(status_code=409, detail="A conversion for this media and voice is already running.")

    # ---- validate source media exists ----
    store = get_object_store()
    try:
        store.metadata(req.media_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Source media not found. Please upload it again.")

    # ---- validate target voice (server-side authorization) ----
    voice = _get_usable_voice(user, req.voice_id, db)

    # ---- publish a fresh, time-limited public URL for the reference ----
    ref_url = ""
    tmpdir = tempfile.mkdtemp(prefix="dvref_")
    try:
        ref_local = os.path.join(tmpdir, "ref_sample")
        store.download(voice.sample_storage_key, ref_local)
        ext = os.path.splitext(voice.sample_storage_key)[1].lstrip(".") or "wav"
        pub = store_media(ref_local, "voiceapi-ref", ext)
        ref_url = pub["public_url"]
    except (StorageError, Exception) as exc:
        logger.warning("reference publish failed: %s", type(exc).__name__)
        raise HTTPException(status_code=422, detail="Voice reference audio is not available.")
    finally:
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)

    # ---- source metadata for the engine ----
    # Durations were measured by the Voice API at upload time (server-side
    # ffprobe). If metadata is missing, ask the Voice API — never probe locally.
    src_meta = store.metadata(req.media_id) or {}
    src_duration = float(src_meta.get("duration_seconds") or src_meta.get("duration") or 0)
    if src_duration <= 0:
        pending = peek_source(req.media_id)
        if pending:
            src_duration = float(pending.get("duration") or 0)
        else:
            try:
                info = await asyncio.to_thread(
                    get_media_client().get, req.media_id.split("/")[-1]
                )
                src_duration = float(info.get("duration") or 0)
            except (VoiceApiMediaError, Exception):
                src_duration = 0.0
    media = {
        "storage_key": req.media_id,
        "is_video": os.path.splitext(req.media_id)[1].lower() in VIDEO_EXT,
        "user_id": user.id,
        "duration_seconds": src_duration,
    }
    target_voice = {
        "voice_id": voice.id,
        "voice_name": voice.name,
        "language": req.source_language,
        "authorized": True,
        "reference_sample_url": ref_url,
        "reference_duration_seconds": float(voice.reference_duration_seconds or 0),
        "sample_storage_key": voice.sample_storage_key,
    }
    settings_map = req.settings or {}

    try:
        job = await job_manager.create_job({
            "user_id": user.id,
            "source_media": media,
            "source_audio": None,
            "target_voice": target_voice,
            "settings": settings_map,
            "output_format": "wav",
        })
    except ProviderNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # EngineValidationError and friends
        msg = str(exc)
        if "not configured" in msg:
            raise HTTPException(status_code=503, detail=msg)
        raise HTTPException(status_code=422, detail=msg)

    out = dict(job)
    out["user_id"] = user.id
    # Stash user id on the manager record too (for duplicate guard / ownership)
    job_manager.get_job(job["job_id"])["user_id"] = user.id
    return {"job_id": job["job_id"], "status": job.get("state", "queued")}


# ------------------------------------------------------------------ jobs
@router.get("/jobs")
async def list_jobs(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """List the authenticated user's conversion jobs.

    Live in-memory records are authoritative; persisted VoiceJob rows fill in
    history that survived restarts (and anything already terminal).
    """
    import json as _json

    from models.job import VoiceJob as VoiceJobModel

    user = _auth(authorization, db)
    jobs = [
        j for j in job_manager.list_jobs()
        if (j.get("user_id") or j.get("request", {}).get("user_id")) == user.id
    ]
    jobs.sort(key=lambda j: j.get("created_at") or "", reverse=True)

    def _shape(j):
        req = j.get("request", {}) or {}
        tv = req.get("target_voice", {}) or {}
        sm = req.get("source_media", {}) or {}
        res = j.get("result") or {}
        return {
            "job_id": j["job_id"],
            "status": j.get("state"),
            "state": j.get("state"),
            "stage": j.get("stage"),
            "progress": j.get("progress"),
            "error": j.get("error"),
            "voice_name": tv.get("voice_name"),
            "voice_id": tv.get("voice_id"),
            "language": tv.get("language") or req.get("source_language"),
            "is_video": bool(sm.get("is_video")),
            "duration_seconds": sm.get("duration_seconds"),
            "output_format": req.get("output_format"),
            "result": {
                "audio_url": res.get("audio_url"),
                "video_url": res.get("video_url"),
                "is_video": res.get("is_video"),
                "output_format": res.get("output_format"),
            } if res else None,
            "created_at": j.get("created_at"),
            "updated_at": j.get("updated_at"),
        }

    out = [_shape(j) for j in jobs]

    # ---- merge persisted history (survives restarts / old jobs) ----
    seen = {o["job_id"] for o in out}
    try:
        rows = (
            db.query(VoiceJobModel)
            .filter(VoiceJobModel.user_id == user.id)
            .order_by(VoiceJobModel.created_at.desc())
            .limit(100)
            .all()
        )
    except Exception:
        rows = []
    for row in rows:
        if row.id in seen:
            continue
        try:
            meta = _json.loads(row.result_metadata or "{}")
        except Exception:
            meta = {}
        res = meta.get("result") or {}
        out.append({
            "job_id": row.id,
            "status": row.status,
            "state": row.status,
            "stage": row.stage,
            "progress": row.progress,
            "error": row.error,
            "voice_name": meta.get("voice_name"),
            "voice_id": row.target_voice_id,
            "language": row.source_language,
            "is_video": bool(meta.get("is_video")),
            "duration_seconds": meta.get("duration_seconds"),
            "output_format": meta.get("output_format"),
            "result": {
                "audio_url": res.get("audio_url"),
                "video_url": res.get("video_url"),
                "is_video": res.get("is_video"),
                "output_format": res.get("output_format"),
            } if res else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        })
    out.sort(key=lambda j: j.get("created_at") or "", reverse=True)
    return {"jobs": out}


@router.get("/jobs/{job_id}")
async def get_job_status(
    job_id: str,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Real job status from the existing job manager. No fabricated progress:
    progress only advances at known pipeline boundaries."""
    user = _auth(authorization, db)
    try:
        job = job_manager.get_job(job_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found.")
    owner = job.get("user_id") or job.get("request", {}).get("user_id")
    if owner and owner != user.id:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {
        "job_id": job["job_id"],
        "status": job.get("state"),
        "state": job.get("state"),
        "stage": job.get("stage"),
        "progress": job.get("progress"),
        "error": job.get("error"),
        "result": job.get("result"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = _auth(authorization, db)
    try:
        job = job_manager.get_job(job_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found.")
    owner = job.get("user_id") or job.get("request", {}).get("user_id")
    if owner and owner != user.id:
        raise HTTPException(status_code=404, detail="Job not found.")
    try:
        result = await job_manager.cancel_job(job_id)
    except Exception:
        raise HTTPException(status_code=409, detail="Job can no longer be cancelled.")
    return result


# ---------------------------------------------- temp public media serving
temp_media_router = APIRouter(prefix="/api/media", tags=["media"])


@temp_media_router.api_route("/temp/{token}/{filename}", methods=["GET", "HEAD"])
@temp_media_router.api_route("/temp/{token}", methods=["GET", "HEAD"])
async def serve_temp_media(token: str, filename: str = ""):
    """HMAC-signed, expiring object serving for the local storage provider.

    Token format: {key_b64}:{exp}:{hmac(key:exp)} — no directory listing,
    no path traversal, no auth bypass (objects are unguessable UUID keys
    and tokens expire).
    """
    key = verify_media_token(token)
    if not key:
        raise HTTPException(status_code=404, detail="Not found")
    data = read_media(key)
    if data is None:
        raise HTTPException(status_code=404, detail="Not found")
    ext = os.path.splitext(key)[1].lower().lstrip(".")
    media_types = {
        "mp4": "video/mp4", "mov": "video/quicktime",
        "mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4",
    }
    return Response(
        content=data,
        media_type=media_types.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "private, max-age=600"},
    )


@router.delete("/jobs/{job_id}")
async def delete_job(
    job_id: str,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Delete a job completely: record, DB row and all stored files."""
    user = _auth(authorization, db)

    # --- collect storage keys from the live record and/or DB row ---
    import json as _json
    from models.job import VoiceJob as VoiceJobModel
    from services.voice_conversion.job_manager import (
        JobNotFoundError as JNFE,
        delete_job as remove_job,
    )

    keys = []
    rec = job_manager._jobs.get(job_id)
    if rec is not None:
        owner = rec.get("user_id") or (rec.get("request", {}) or {}).get("user_id")
        if owner and owner != user.id:
            raise HTTPException(status_code=404, detail="Job not found.")
        req = rec.get("request", {}) or {}
        sm = req.get("source_media", {}) or {}
        res = rec.get("result") or {}
        keys += [sm.get("storage_key"), res.get("storage_key")]

    row = db.query(VoiceJobModel).filter(VoiceJobModel.id == job_id).first()
    if row is not None:
        if row.user_id and row.user_id != user.id:
            raise HTTPException(status_code=404, detail="Job not found.")
        keys.append(row.source_media_key)
        keys.append(row.result_storage_key)
        try:
            meta = _json.loads(row.result_metadata or "{}")
            res = meta.get("result") or {}
            keys += [res.get("storage_key"), res.get("audio_url")]
        except Exception:
            pass

    if rec is None and row is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    # --- delete stored files (best-effort) ---
    deleted_files = 0
    for k in {k for k in keys if k}:
        key = k
        # result_storage_key may hold a full URL instead of a key
        if "://" in key:
            from urllib.parse import urlparse
            p = urlparse(key)
            key = p.path.lstrip("/")
            # strip known media prefix if present
            for prefix in ("media/",):
                if key.startswith(prefix):
                    key = key[len(prefix):]
                    break
        try:
            from services.storage.object_store import get_object_store
            get_object_store().delete(key)
            deleted_files += 1
        except Exception:
            pass

    # --- remove memory record, background task and DB row ---
    remove_job(job_id)

    return {"deleted": True, "job_id": job_id, "files_removed": deleted_files}
