"""Queue package: Celery app + task dispatch with graceful degradation."""
from .celery_app import celery_available, submit_task, shutdown as queue_shutdown

__all__ = ["celery_available", "submit_task", "queue_shutdown"]
