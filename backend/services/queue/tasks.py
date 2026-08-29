"""Celery worker task definitions.

These tasks run on Celery workers (not the API server). Each task:
  1. loads the job record from PostgreSQL
  2. runs the provider through the engine/provider interfaces
  3. uploads artifacts to object storage
  4. records usage and completes the job

The worker process must import this module. Kept import-safe when Celery
is absent so the API server can still boot.
"""
import logging

logger = logging.getLogger(__name__)

try:
    from services.queue.celery_app import celery_available

    if celery_available():
        from services.queue.celery_app import _celery

        @_celery.task(name="tasks.voice_conversion_task", bind=True, max_retries=0)
        def voice_conversion_task(self, job_id: str, payload: dict):
            """Run a voice-conversion job (Seed-VC via RunPod)."""
            from services.voice_conversion.worker_runner import run_voice_conversion_job
            return run_voice_conversion_job(job_id, payload)

        @_celery.task(name="tasks.tts_task", bind=True, max_retries=0)
        def tts_task(self, job_id: str, payload: dict):
            from services.ai.worker_runner import run_tts_job
            return run_tts_job(job_id, payload)

        @_celery.task(name="tasks.transcription_task", bind=True, max_retries=0)
        def transcription_task(self, job_id: str, payload: dict):
            from services.ai.worker_runner import run_transcription_job
            return run_transcription_job(job_id, payload)

        @_celery.task(name="tasks.audio_processing_task", bind=True, max_retries=0)
        def audio_processing_task(self, job_id: str, payload: dict):
            """CPU FFmpeg work (extract/resample/merge)."""
            from services.audio.worker_runner import run_audio_processing_job
            return run_audio_processing_job(job_id, payload)

except Exception:  # pragma: no cover - no celery on API server
    logger.info("Celery tasks not registered (workers run separately).")
