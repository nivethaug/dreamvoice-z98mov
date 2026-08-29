"""Async job manager for the Seed-VC worker.

Lifecycle: queued -> preparing -> processing -> completed | failed | cancelled
Jobs run in background threads; results are kept briefly for pickup then
temp dirs are cleaned automatically.
"""
import threading
import time
import uuid

from app.config import settings
from app.temp_store import temp_store


class JobNotFound(Exception):
    pass


class JobConflict(Exception):
    pass


class JobManager:
    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._lock = threading.Lock()

    def create(self, source_path: str, reference_path: str, model: str,
               settings_dict: dict | None, run_fn, job_id: str | None = None) -> dict:
        job_id = job_id or uuid.uuid4().hex
        job = {
            "job_id": job_id,
            "status": "queued",
            "progress": 0.0,
            "stage": "queued",
            "model": model or "seed-vc",
            "created_at": time.time(),
            "error": None,
            "result": None,
        }
        with self._lock:
            self._jobs[job_id] = job
        t = threading.Thread(
            target=self._run, daemon=True,
            args=(job_id, source_path, reference_path, settings_dict, run_fn))
        t.start()
        return self.public_view(job)

    def _run(self, job_id, source_path, reference_path, settings_dict, run_fn):
        job = self._jobs[job_id]
        try:
            self._update(job_id, status="preparing", stage="preparing", progress=10.0)
            run_fn(job_id, job, source_path, reference_path, settings_dict,
                   self._update)
        except _Cancelled:
            self._update(job_id, status="cancelled", stage="cancelled", error=None)
        except Exception as e:  # never leak stack traces
            # If the job was cancelled (e.g. temp dir removed mid-run causing an
            # OSError), keep the cancelled status instead of marking it failed.
            with self._lock:
                current = self._jobs.get(job_id, {}).get("status")
            if current == "cancelled":
                return
            self._update(job_id, status="failed", stage="failed",
                         error=_safe_message(e))
        finally:
            # delayed cleanup handled by sweep; immediate dir cleanup for
            # failed/cancelled jobs, keep completed briefly for result pickup
            pass

    def _update(self, job_id: str, **fields):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.update(fields)

    def get(self, job_id: str) -> dict:
        with self._lock:
            job = self._jobs.get(job_id)
        if not job:
            raise JobNotFound(job_id)
        return job

    def public_view(self, job: dict) -> dict:
        return {k: job.get(k) for k in (
            "job_id", "status", "progress", "stage", "model",
            "created_at", "error", "result")}

    def is_cancelled(self, job_id: str) -> bool:
        return self.get(job_id).get("status") == "cancelled"

    def cancel(self, job_id: str) -> dict:
        job = self.get(job_id)
        if job["status"] in ("completed", "failed", "cancelled"):
            raise JobConflict(f"Job already {job['status']}")
        self._update(job_id, status="cancelled", stage="cancelled")
        temp_store.remove(job_id)
        return self.public_view(self.get(job_id))

    def complete(self, job_id: str, result: dict):
        self._update(job_id, status="completed", stage="completed",
                     progress=100.0, result=result)

    def sweep(self):
        """Remove old finished jobs and their temp dirs."""
        now = time.time()
        with self._lock:
            stale = [j for j, job in self._jobs.items()
                     if job["status"] in ("completed", "failed", "cancelled")
                     and now - job["created_at"] > settings.keep_completed_seconds]
        for j in stale:
            temp_store.remove(j)
            with self._lock:
                self._jobs.pop(j, None)


class _Cancelled(Exception):
    pass


def safe_error(exc: Exception) -> str:
    return _safe_message(exc)


def _safe_message(e: Exception) -> str:
    code = getattr(e, "code", None)
    msg = str(e) or e.__class__.__name__
    # strip any path-like fragments
    import re
    msg = re.sub(r"/[^\s'\"]+", "[path]", msg)
    return msg if not code else f"{code}: {msg}"


job_manager = JobManager()
