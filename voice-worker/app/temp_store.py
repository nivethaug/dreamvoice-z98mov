"""Temporary per-job directory management with automatic cleanup."""
import os
import shutil
import time
import uuid
import threading
from app.config import settings


class TempStore:
    def __init__(self):
        self._dirs: dict[str, dict] = {}  # job_id -> {path, created}
        self._lock = threading.Lock()

    def create(self, job_id: str) -> str:
        path = os.path.join(settings.temp_dir_root, job_id or uuid.uuid4().hex)
        os.makedirs(path, exist_ok=True)
        with self._lock:
            self._dirs[job_id] = {"path": path, "created": time.time()}
        return path

    def path_for(self, job_id: str) -> str | None:
        with self._lock:
            entry = self._dirs.get(job_id)
            return entry["path"] if entry else None

    def remove(self, job_id: str):
        with self._lock:
            entry = self._dirs.pop(job_id, None)
        if entry and os.path.isdir(entry["path"]):
            shutil.rmtree(entry["path"], ignore_errors=True)

    def cleanup_expired(self):
        now = time.time()
        with self._lock:
            expired = [j for j, e in self._dirs.items()
                       if now - e["created"] > settings.keep_completed_seconds]
        for j in expired:
            self.remove(j)


temp_store = TempStore()
