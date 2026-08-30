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
from .provider import (
    PROVIDER_MOCK,
    PROVIDER_OPENROUTER,
    PROVIDER_REMOTE,
    PROVIDER_RUNPOD,
    PROVIDER_VOICEAPI,
    ProviderConfigError,
    ProviderNotConfiguredError,
    ProviderSettings,
    load_provider_settings,
)

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
        # Engine is chosen from VOICE_CONVERSION_PROVIDER env config; swap
        # later without changing the public API. Built lazily so a missing
        # provider config never crashes app startup - jobs fail cleanly
        # with "not configured yet" instead.
        self.engine: Optional[VoiceConversionEngine] = engine
        self._engine_error: Optional[str] = None
        if engine is None:
            try:
                self.engine = build_engine_from_provider()
            except (ProviderNotConfiguredError, ProviderConfigError) as exc:
                self._engine_error = str(exc)
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._tasks: Dict[str, asyncio.Task] = {}

    def _require_engine(self) -> VoiceConversionEngine:
        if self.engine is None:
            raise ProviderNotConfiguredError(
                self._engine_error or "Voice conversion is not configured yet.",
                ["VOICE_CONVERSION_PROVIDER"],
            )
        return self.engine

    # ------------------------------------------------------------------ API

    async def create_job(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        source_media = payload.get("source_media")
        source_audio = payload.get("source_audio")
        target_voice = payload.get("target_voice") or {}
        settings = payload.get("settings") or {}
        output_format = payload.get("output_format", "mp3")

        # Engine-side validation BEFORE accepting the job
        engine = self._require_engine()
        await engine.validate(source_media, source_audio, target_voice, settings)

        job_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc)
        job = {
            "job_id": job_id,
            "state": "queued",
            "progress": 0,
            "stage": None,
            "error": None,
            "engine": engine.name,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "request": {
                "source_media": source_media,
                "source_audio": source_audio,
                "target_voice": {
                    "voice_id": target_voice.get("voice_id"),
                    "voice_name": target_voice.get("voice_name"),
                    "language": target_voice.get("language"),
                    # Authorization metadata required by provider engines.
                    # Never contains secrets or internal provider IDs.
                    "authorized": bool(target_voice.get("authorized")),
                    "reference_sample_url": target_voice.get(
                        "reference_sample_url"
                    ),
                    "sample_storage_key": target_voice.get("sample_storage_key"),
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

    def list_jobs(self) -> list:
        """All tracked job records (for duplicate-in-flight checks etc.)."""
        return list(self._jobs.values())

    async def cancel_job(self, job_id: str) -> Dict[str, Any]:
        job = self.get_job(job_id)
        if job["state"] in TERMINAL_STATES:
            raise JobNotCancellableError(
                f"Job is already {job['state']} and cannot be cancelled."
            )
        await self._require_engine().cancel(job_id)
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
            engine = self._require_engine()
            result = await engine.convert(
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
            logger.error("job %s failed (validation): %s", job_id, exc, exc_info=True)
            self._set(job, state="failed", error=str(exc))
        except EngineError as exc:
            logger.error("job %s failed (engine): %s", job_id, exc, exc_info=True)
            self._set(job, state="failed", error=str(exc))
        except Exception as exc:  # noqa: BLE001 - defensive
            logger.error("job %s failed (unexpected): %s", job_id, exc, exc_info=True)
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


def build_engine_from_provider(
    provider_settings: Optional[ProviderSettings] = None,
) -> VoiceConversionEngine:
    """Select the conversion engine from environment configuration.

    The mock engine is used ONLY when explicitly configured via
    VOICE_CONVERSION_PROVIDER=mock - we never silently fall back to it.
    """
    cfg = provider_settings or load_provider_settings()
    cfg.validate()  # raises ProviderNotConfiguredError / ProviderConfigError
    if cfg.provider == PROVIDER_MOCK:
        return MockVoiceConversionEngine()
    if cfg.provider == PROVIDER_OPENROUTER:
        from .engines.openrouter_engine import OpenRouterVoiceEngine

        return OpenRouterVoiceEngine(cfg)
    if cfg.provider == PROVIDER_REMOTE:
        from .engines.remote_engine import RemoteVoiceConversionEngine

        return RemoteVoiceConversionEngine(cfg)
    if cfg.provider == PROVIDER_RUNPOD:
        from .engines.runpod_engine import RunPodVoiceConversionEngine

        return RunPodVoiceConversionEngine(cfg)
    if cfg.provider == PROVIDER_VOICEAPI:
        from .engines.voice_api_engine import VoiceAPIVoiceConversionEngine

        return VoiceAPIVoiceConversionEngine(cfg)
    raise ProviderConfigError(
        f"Invalid VOICE_CONVERSION_PROVIDER '{cfg.provider}'."
    )


# Module-level singleton used by the routes
job_manager = VoiceConversionJobManager()


def provider_status() -> dict:
    """Safe public provider status (no secrets)."""
    return load_provider_settings().status()


# Re-exported for routes/tests
__all__ = [
    "JOB_STATES",
    "JobNotCancellableError",
    "JobNotFoundError",
    "VoiceConversionJobManager",
    "build_engine_from_provider",
    "job_manager",
    "provider_status",
    "ProviderConfigError",
    "ProviderNotConfiguredError",
]
