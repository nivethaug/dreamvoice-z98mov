"""In-memory voice conversion job manager.

Tracks job state, runs the mock worker as asyncio background tasks,
and handles cleanup of old terminal-state jobs.
"""
import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from .engines.base import (
    EngineError,
    EngineValidationError,
    VoiceConversionEngine,
)
from .engines.mock_engine import MockVoiceConversionEngine

# Valid job states, in lifecycle order
JOB_STATES = (
    "queued",
    "preparing",
    "processing",
    "enhancing",
    "finalizing",
    "completed",
    "failed",
    "cancelled",
)

TERMINAL_STATES = {"completed", "failed", "cancelled"}
# Cleanup terminal jobs older than this
JOB_TTL_SECONDS = 3600
MAX_TRACKED_JOBS = 200


class JobNotFoundError(Exception):
    pass


class JobNotCancellableError(Exception):
    pass


class VoiceConversionJobManager:
    """Model-agnostic job manager: owns jobs, delegates work to an engine."""

    def __init__(self, engine: Optional[VoiceConversionEngine] = None):
        # Swap engine later: SeedVCVoiceConversionEngine, RVCVoiceConversionEngine...
        self.engine: VoiceConversionEngine = engine or MockVoiceConversionEngine()
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._tasks: Dict[str, asyncio.Task] = {}

    # ------------------------------------------------------------------ API

    async def create_job(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        source_media = payload.get("source_media")
        source_audio = payload.get("source_audio")
        target_voice = payload.get("target_voice") or {}
        settings = payload.get("settings") or {}
        output_format = payload.get("output_format", "mp3")

        # Engine-side validation BEFORE accepting the job
        await self.engine.validate(source_media, source_audio, target_voice, settings)

        job_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc)
        job = {
            "job_id": job_id,
            "state": "queued",
            "progress": 0,
            "stage": None,
            "error": None,
            "engine": self.engine.name,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "request": {
                "source_media": source_media,
                "source_audio": source_audio,
                "target_voice": {
                    "voice_id": target_voice.get("voice_id"),
                    "voice_name": target_voice.get("voice_name"),
                },
                "settings": settings,
                "output_format": output_format,
            },
            "result": None,
        }
        self._cleanup()
        self._jobs[job_id] = job
        self._tasks[job_id] = asyncio.create_task(self._run_job(job_id))
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> Dict[str, Any]:
        job = self._jobs.get(job_id)
        if not job:
            raise JobNotFoundError(f"Job '{job_id}' not found.")
        return job

    async def cancel_job(self, job_id: str) -> Dict[str, Any]:
        job = self.get_job(job_id)
        if job["state"] in TERMINAL_STATES:
            raise JobNotCancellableError(
                f"Job is already {job['state']} and cannot be cancelled."
            )
        await self.engine.cancel(job_id)
        task = self._tasks.get(job_id)
        if task:
            task.cancel()
        self._set(job, state="cancelled", stage=None)
        return self.get_job(job_id)

    async def shutdown(self) -> None:
        """Cancel all running tasks on app shutdown."""
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()

    # ------------------------------------------------------------- internals

    def _set(self, job: Dict[str, Any], **fields) -> None:
        job.update(fields)
        job["updated_at"] = datetime.now(timezone.utc).isoformat()

    async def _run_job(self, job_id: str) -> None:
        job = self._jobs.get(job_id)
        if job is None:
            return
        req = job["request"]

        def on_progress(stage: str, state: str, pct: int) -> None:
            current = self._jobs.get(job_id)
            if current and current["state"] not in TERMINAL_STATES:
                self._set(current, stage=stage, state=state, progress=int(pct))

        try:
            result = await self.engine.convert(
                job_id=job_id,
                source_media=req["source_media"],
                source_audio=req["source_audio"],
                target_voice=req["target_voice"],
                settings=req["settings"],
                output_format=req["output_format"],
                progress_callback=on_progress,
            )
            self._set(job, state="completed", progress=100, result=result)
        except asyncio.CancelledError:
            if job["state"] not in TERMINAL_STATES:
                self._set(job, state="cancelled")
        except EngineValidationError as exc:
            self._set(job, state="failed", error=str(exc))
        except EngineError as exc:
            self._set(job, state="failed", error=str(exc))
        except Exception as exc:  # noqa: BLE001 - defensive
            self._set(job, state="failed", error=f"Unexpected error: {exc}")
        finally:
            self._tasks.pop(job_id, None)

    def _cleanup(self) -> None:
        """Drop terminal jobs older than TTL; cap tracked jobs."""
        now = time.time()
        stale = [
            jid
            for jid, j in self._jobs.items()
            if j["state"] in TERMINAL_STATES
            and now - datetime.fromisoformat(j["updated_at"]).timestamp()
            > JOB_TTL_SECONDS
        ]
        for jid in stale:
            self._jobs.pop(jid, None)
        # Cap: drop oldest terminal jobs if over limit
        terminal = [
            (j["updated_at"], jid)
            for jid, j in self._jobs.items()
            if j["state"] in TERMINAL_STATES
        ]
        overflow = len(self._jobs) - MAX_TRACKED_JOBS
        for _, jid in sorted(terminal)[: max(overflow, 0)]:
            self._jobs.pop(jid, None)


# Module-level singleton used by the routes
job_manager = VoiceConversionJobManager()
