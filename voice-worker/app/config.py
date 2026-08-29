"""Configuration for the Seed-VC GPU worker. All values from environment."""
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Auth between DreamVoice backend and this worker. Never exposed to browsers.
    voice_worker_api_key: str = os.environ.get("VOICE_WORKER_API_KEY", "")

    # Model configuration (never hard-coded paths)
    seed_vc_model_path: str = os.environ.get("SEED_VC_MODEL_PATH", "/models/seed-vc")
    seed_vc_checkpoint: str = os.environ.get(
        "SEED_VC_CHECKPOINT", "/models/seed-vc/checkpoints/seed-vc-v2/seed-vc-v2.pt"
    )
    seed_vc_device: str = os.environ.get("SEED_VC_DEVICE", "cuda")

    # Resource limits
    max_duration_seconds: float = float(os.environ.get("MAX_DURATION_SECONDS", "1800"))
    max_upload_mb: float = float(os.environ.get("MAX_UPLOAD_MB", "500"))
    job_timeout_seconds: float = float(os.environ.get("JOB_TIMEOUT_SECONDS", "900"))
    keep_completed_seconds: float = float(os.environ.get("KEEP_COMPLETED_SECONDS", "900"))
    temp_dir_root: str = os.environ.get("WORKER_TEMP_DIR", "/tmp/seedvc-worker")

    @property
    def max_source_duration(self) -> float:
        return self.max_duration_seconds

    @property
    def max_reference_duration(self) -> float:
        return min(self.max_duration_seconds, 600.0)

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)

    # Behaviour
    # When False (default) and no GPU/checkpoint exists, jobs fail honestly.
    allow_cpu_fallback: bool = os.environ.get("ALLOW_CPU_FALLBACK", "false").lower() == "true"


settings = Settings()
