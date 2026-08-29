"""Celery worker runner for voice-conversion jobs.

Runs on a Celery worker (CPU-only; GPU inference happens at the provider,
e.g. RunPod Seed-VC). Loads the job, runs the engine pipeline, persists
state to PostgreSQL (VoiceJob), records usage, and cleans temp files.

This is the production execution path:
    API -> Celery -> run_voice_conversion_job() -> provider -> storage
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _record_usage(session, job_id: str, user_id, result: Dict[str, Any],
                  engine_name: str, model: str, status: str) -> None:
    try:
        from models.usage import UsageRecord
        session.add(UsageRecord(
            job_id=job_id,
            user_id=user_id,
            provider=engine_name,
            model=model,
            operation="VOICE_CONVERSION",
            input_duration=(result or {}).get("source_duration_seconds"),
            output_duration=(result or {}).get("duration_seconds"),
            compute_seconds=(result or {}).get("compute_seconds"),
            provider_cost=(result or {}).get("provider_cost"),
            status=status,
        ))
        session.commit()
    except Exception:
        logger.exception("usage recording failed for job %s", job_id)


def run_voice_conversion_job(job_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Execute one voice-conversion job end-to-end (worker side).

    Updates the VoiceJob row state-by-state and returns the result dict.
    Never logs secrets or voice sample contents.
    """
    from core.database import SessionLocal
    from models.job import VoiceJob
    from .job_manager import build_engine_from_provider
    from .provider import ProviderConfigError, ProviderNotConfiguredError

    started = _now()
    session = SessionLocal()
    engine_name = "unknown"
    model = "unknown"
    try:
        job = session.query(VoiceJob).filter(VoiceJob.id == job_id).first() \
            if not isinstance(job_id, str) or job_id.isdigit() else None
        # Job IDs are UUID strings by default; find by job_id column.
        if job is None:
            job = session.query(VoiceJob).filter(VoiceJob.job_id == job_id).first()

        def _update(state=None, progress=None, stage=None, error=None):
            if job is None:
                return
            if state:
                job.state = state
            if progress is not None:
                job.progress = progress
            if stage:
                job.current_stage = stage
            if error:
                job.error = error
            job.updated_at = _now()
            session.commit()

        _update(state="preparing", progress=5, stage="Preparing media")

        try:
            engine = build_engine_from_provider()
        except (ProviderConfigError, ProviderNotConfiguredError) as exc:
            _update(state="failed", error=str(exc))
            return {"job_id": job_id, "status": "failed", "error": str(exc)}
        engine_name = getattr(engine, "name", "unknown")
        model = getattr(engine, "_settings", None)
        model = getattr(model, "runpod_model", None) or \
            getattr(getattr(engine, "_settings", None), "remote_model", "unknown")

        def on_progress(stage, state, pct):
            _update(state=state, progress=int(pct), stage=stage)

        try:
            result = __import__("asyncio").run(engine.convert(
                job_id=job_id,
                source_media=payload.get("source_media"),
                source_audio=payload.get("source_audio"),
                target_voice=payload.get("target_voice") or {},
                settings=payload.get("settings") or {},
                output_format=payload.get("output_format", "wav"),
                progress_callback=on_progress,
            ))
        except Exception as exc:  # engine errors are user-safe messages
            _update(state="failed", error=str(exc))
            _record_usage(session, job_id,
                          getattr(job, "user_id", None), {}, engine_name,
                          model, "failed")
            return {"job_id": job_id, "status": "failed", "error": str(exc)}

        _update(state="completed", progress=100, stage="Completed")
        if job is not None:
            job.storage_key = result.get("storage_key")
            job.result = __import__("json").dumps(result)
            session.commit()
        _record_usage(session, job_id, getattr(job, "user_id", None),
                      result, engine_name, model, "completed")
        logger.info(
            "job=%s provider=%s model=%s status=completed duration=%.1fs",
            job_id, engine_name, model,
            (_now() - started).total_seconds(),
        )
        return {"job_id": job_id, "status": "completed", "result": result}
    finally:
        session.close()
