"""Celery worker runners for STT / TTS jobs (OpenRouter-backed)."""
import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc)


def _load_job(session, model_cls, job_id: str):
    return session.query(model_cls).filter(model_cls.job_id == job_id).first()


def _update(job, **fields):
    if job is None:
        return
    for k, v in fields.items():
        setattr(job, k, v)
    job.updated_at = _now()


def run_tts_job(job_id: str, payload: dict) -> dict:
    """Generate speech from text via the configured TTS provider."""
    from core.database import SessionLocal
    from models.job import TTSJob
    from .tts_engine import get_tts_engine
    from .openrouter_provider import OpenRouterError

    session = SessionLocal()
    try:
        job = _load_job(session, TTSJob, job_id)
        _update(job, state="processing", progress=20)
        session.commit()
        try:
            engine = get_tts_engine()
            text = payload.get("text", "")
            language = payload.get("language", "ta")
            result = asyncio.run(engine.synthesize(
                text=text,
                language=language,
                voice=payload.get("voice"),
                settings=payload.get("settings") or {},
            ))
        except (OpenRouterError, ValueError) as exc:
            _update(job, state="failed", error=str(exc))
            session.commit()
            return {"job_id": job_id, "status": "failed", "error": str(exc)}
        _update(job, state="completed", progress=100,
                storage_key=result.get("storage_key"))
        session.commit()
        logger.info("job=%s op=TTS status=completed", job_id)
        return {"job_id": job_id, "status": "completed", "result": result}
    finally:
        session.close()


def run_transcription_job(job_id: str, payload: dict) -> dict:
    """Transcribe audio via the configured STT provider."""
    from core.database import SessionLocal
    from models.job import TranscriptionJob
    from .stt_engine import get_stt_engine
    from .openrouter_provider import OpenRouterError

    session = SessionLocal()
    try:
        job = _load_job(session, TranscriptionJob, job_id)
        _update(job, state="processing", progress=20)
        session.commit()
        try:
            engine = get_stt_engine()
            result = asyncio.run(engine.transcribe(
                audio_url=payload.get("audio_url", ""),
                language=payload.get("source_language"),
                settings=payload.get("settings") or {},
            ))
        except (OpenRouterError, ValueError) as exc:
            _update(job, state="failed", error=str(exc))
            session.commit()
            return {"job_id": job_id, "status": "failed", "error": str(exc)}
        import json as _json
        _update(job, state="completed", progress=100,
                transcript=_json.dumps(result))
        session.commit()
        logger.info("job=%s op=STT status=completed", job_id)
        return {"job_id": job_id, "status": "completed", "result": result}
    finally:
        session.close()
