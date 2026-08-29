"""Celery worker runner for CPU audio processing (FFmpeg).

Handles extract / convert / resample / normalize / merge. Basic FFmpeg work
stays on CPU workers — never sent to GPU providers.
"""
import logging

from services.voice_conversion import media as media_utils
from services.voice_conversion.temp_store import register_temp_file

logger = logging.getLogger(__name__)


def run_audio_processing_job(job_id: str, payload: dict) -> dict:
    operation = payload.get("operation", "")
    source = payload.get("source_path", "")
    try:
        if operation == "extract_audio":
            out = media_utils.extract_audio(source)
            register_temp_file(out)
            return {"job_id": job_id, "status": "completed",
                    "output_path": out}
        if hasattr(media_utils, operation):
            out = getattr(media_utils, operation)(**payload.get("args", {}))
            return {"job_id": job_id, "status": "completed", "result": out}
        return {"job_id": job_id, "status": "failed",
                "error": f"Unknown audio operation '{operation}'."}
    except Exception as exc:
        logger.exception("audio job %s failed", job_id)
        return {"job_id": job_id, "status": "failed", "error": str(exc)}
