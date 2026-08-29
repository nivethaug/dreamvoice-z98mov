"""Celery queue infrastructure (broker/backend = Redis via REDIS_URL).

Production flow:
    API -> PostgreSQL job record -> Celery task -> worker -> provider
        -> object storage -> job completed

Celery/Redis are imported lazily. When they are unavailable (local dev,
tests), submit_task() returns {"dispatched": False} and callers run the
work in-process instead. Production must set REDIS_URL and run workers;
the mock engine is only ever used when explicitly configured via
VOICE_CONVERSION_PROVIDER=mock.
"""
import logging
from typing import Any, Dict

from core.config import settings

logger = logging.getLogger(__name__)

_celery = None
_celery_checked = False


def celery_available() -> bool:
    """True when Celery + REDIS_URL are both configured."""
    global _celery, _celery_checked
    if _celery_checked:
        return _celery is not None
    _celery_checked = True
    if not settings.REDIS_URL:
        return False
    try:
        from celery import Celery  # noqa: F401
        _celery = Celery(
            "dreamvoice",
            broker=settings.REDIS_URL,
            backend=settings.REDIS_URL,
        )
        _celery.conf.update(
            task_track_started=True,
            task_acks_late=True,
            worker_prefetch_multiplier=1,
            broker_connection_retry_on_startup=True,
        )
    except Exception:  # pragma: no cover - celery not installed
        logger.warning("Celery not available; jobs will run in-process.")
        _celery = None
    return _celery is not None


TASK_NAMES = {
    "voice_conversion": "tasks.voice_conversion_task",
    "tts": "tasks.tts_task",
    "transcription": "tasks.transcription_task",
    "audio_processing": "tasks.audio_processing_task",
}


def submit_task(category: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Dispatch a task category to Celery.

    Returns {"dispatched": True, "task_id": ...} on success.
    Returns {"dispatched": False, "reason": ...} when Celery is not
    configured — the caller is then responsible for in-process execution.
    """
    if category not in TASK_NAMES:
        raise ValueError(f"Unknown task category '{category}'.")
    if not celery_available():
        return {"dispatched": False, "reason": "celery_not_configured"}
    try:
        result = _celery.send_task(TASK_NAMES[category], kwargs=payload)
        return {"dispatched": True, "task_id": result.id}
    except Exception as exc:  # broker down etc.
        logger.error("Celery dispatch failed: %s", type(exc).__name__)
        return {"dispatched": False, "reason": "broker_unavailable"}


def shutdown() -> None:  # pragma: no cover
    global _celery
    if _celery is not None:
        try:
            _celery.control.shutdown()
        except Exception:
            pass
    _celery = None
