"""Admin routes: platform-wide user usage statistics + project lists."""
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from models.job import VoiceJob
from models.media_file import MediaFile
from models.project import Project
from models.usage import UsageRecord
from models.user import User
from models.voice import Voice
from services.auth_service import AuthService

router = APIRouter(prefix="/api/admin", tags=["Admin"])

PROCESSING_STATES = ("queued", "preparing", "processing", "enhancing", "finalizing")


def _require_admin(authorization: Optional[str], db: Session) -> User:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization format")
    user = AuthService.get_user_by_token(db, parts[1])
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/overview")
async def admin_overview(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """All users with usage stats + their project lists. Admin only."""
    _require_admin(authorization, db)

    users = db.query(User).order_by(User.id).all()

    job_counts: dict[int, dict] = defaultdict(
        lambda: {"total": 0, "completed": 0, "failed": 0, "processing": 0}
    )
    for uid, status, cnt in (
        db.query(VoiceJob.user_id, VoiceJob.status, func.count(VoiceJob.id))
        .group_by(VoiceJob.user_id, VoiceJob.status)
        .all()
    ):
        job_counts[uid]["total"] += cnt
        if status == "completed":
            job_counts[uid]["completed"] += cnt
        elif status == "failed":
            job_counts[uid]["failed"] += cnt
        elif status in PROCESSING_STATES:
            job_counts[uid]["processing"] += cnt

    voice_counts = dict(db.query(Voice.user_id, func.count(Voice.id)).group_by(Voice.user_id).all())
    project_counts = dict(
        db.query(Project.user_id, func.count(Project.id)).group_by(Project.user_id).all()
    )
    media_counts = dict(
        db.query(MediaFile.user_id, func.count(MediaFile.id)).group_by(MediaFile.user_id).all()
    )
    storage_sums = dict(
        db.query(MediaFile.user_id, func.coalesce(func.sum(MediaFile.size_bytes), 0))
        .group_by(MediaFile.user_id)
        .all()
    )
    conv_counts = dict(
        db.query(UsageRecord.user_id, func.count(UsageRecord.id))
        .filter(UsageRecord.operation == "VOICE_CONVERSION")
        .group_by(UsageRecord.user_id)
        .all()
    )
    audio_seconds = dict(
        db.query(UsageRecord.user_id, func.coalesce(func.sum(UsageRecord.output_duration), 0))
        .group_by(UsageRecord.user_id)
        .all()
    )
    cost_sums = dict(
        db.query(UsageRecord.user_id, func.coalesce(func.sum(UsageRecord.provider_cost), 0))
        .group_by(UsageRecord.user_id)
        .all()
    )

    projects_by_user: dict[int, list] = defaultdict(list)
    for p in db.query(Project).order_by(Project.updated_at.desc()).all():
        projects_by_user[p.user_id].append(
            {
                "id": p.id,
                "name": p.name,
                "status": p.status,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
        )

    users_out = []
    for u in users:
        jc = job_counts[u.id]
        users_out.append(
            {
                "id": u.id,
                "email": u.email,
                "is_admin": bool(u.is_admin),
                "jobs_total": jc["total"],
                "jobs_completed": jc["completed"],
                "jobs_failed": jc["failed"],
                "jobs_processing": jc["processing"],
                "conversions": int(conv_counts.get(u.id, 0) or 0),
                "output_audio_seconds": round(float(audio_seconds.get(u.id, 0) or 0), 1),
                "provider_cost": round(float(cost_sums.get(u.id, 0) or 0), 4),
                "voices": int(voice_counts.get(u.id, 0) or 0),
                "projects": int(project_counts.get(u.id, 0) or 0),
                "media_files": int(media_counts.get(u.id, 0) or 0),
                "storage_bytes": int(storage_sums.get(u.id, 0) or 0),
                "project_list": projects_by_user.get(u.id, []),
            }
        )

    totals = {
        "users": len(users_out),
        "jobs_total": sum(u["jobs_total"] for u in users_out),
        "jobs_completed": sum(u["jobs_completed"] for u in users_out),
        "jobs_failed": sum(u["jobs_failed"] for u in users_out),
        "conversions": sum(u["conversions"] for u in users_out),
        "voices": sum(u["voices"] for u in users_out),
        "projects": sum(u["projects"] for u in users_out),
        "storage_bytes": sum(u["storage_bytes"] for u in users_out),
        "output_audio_seconds": round(sum(u["output_audio_seconds"] for u in users_out), 1),
    }
    return {"totals": totals, "users": users_out}
