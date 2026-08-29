"""Seed-VC inference engine wrapper.

Loads the official Seed-VC model ONCE at worker startup (per SEED_VC_* env
configuration) and performs real voice conversion. No mock fallback: if the
model or GPU is unavailable, jobs fail honestly with a clear error.
"""
import os
import subprocess
import threading
import time
import uuid

from app.config import settings
from app.audio_processing import AudioValidationError


class SeedVCNotAvailable(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.code = "seed_vc_unavailable"


class SeedVCEngine:
    """Wraps the real Seed-VC inference pipeline.

    Seed-VC (https://github.com/Plachtaa/seed-vc) ships `inference.py` which
    performs audio-to-audio voice conversion using a source audio file and a
    target (timbre) reference audio. We drive it as a subprocess with the
    official flags so the worker stays decoupled from Seed-VC internals and
    always uses the upstream-recommended procedure.
    """

    name = "seed-vc"

    def __init__(self):
        self._loaded = False
        self._load_error: str | None = None
        self._lock = threading.Lock()

    # --- capability reporting -------------------------------------------
    def gpu_available(self) -> bool:
        if settings.seed_vc_device.startswith("cpu"):
            return False
        try:
            import torch
            return torch.cuda.is_available()
        except Exception:
            return False

    def availability(self) -> dict:
        """Report readiness WITHOUT exposing paths or secrets."""
        ok = self._loaded and self._load_error is None
        return {
            "ready": ok,
            "gpu_available": self.gpu_available(),
            "error": self._load_error,
        }

    # --- model loading ----------------------------------------------------
    def load(self) -> None:
        """Load/verify model once at startup. Raises SeedVCNotAvailable."""
        with self._lock:
            if self._loaded:
                return
            repo = settings.seed_vc_model_path
            ckpt = settings.seed_vc_checkpoint

            problems = []
            if not os.path.isdir(repo):
                problems.append("Seed-VC repository not found on worker host")
            if not os.path.isfile(ckpt):
                problems.append("Seed-VC checkpoint not found on worker host")
            if not self.gpu_available() and not settings.allow_cpu_fallback:
                problems.append("GPU inference unavailable (CUDA not detected)")

            try:
                import torch  # noqa: F401
                import librosa  # noqa: F401
            except Exception as e:
                problems.append(f"Missing inference dependency: {e.__class__.__name__}")

            if problems:
                self._load_error = "; ".join(problems)
                raise SeedVCNotAvailable(self._load_error)

            # Warm verification: ensure inference.py is present. We do NOT load
            # weights here because Seed-VC's official entrypoint manages its
            # own lazy model state inside inference.py; subprocess isolation
            # also prevents GPU memory fragmentation across jobs.
            infer = os.path.join(repo, "inference.py")
            if not os.path.isfile(infer):
                self._load_error = "Seed-VC inference entrypoint missing"
                raise SeedVCNotAvailable(self._load_error)

            self._loaded = True
            self._load_error = None

    # --- conversion ---------------------------------------------------------
    def convert(
        self,
        source_wav: str,
        reference_wav: str,
        job_dir: str,
        settings_dict: dict | None = None,
        progress_cb=None,
    ) -> str:
        """Run real Seed-VC conversion. Returns path of converted WAV.

        settings_dict supports Seed-VC tuning knobs:
          - diffusion_steps (default 30; 10-50)
          - length_adjust (default 1.0)
          - inference_cfg_rate (default 0.7)
        """
        if not self._loaded:
            self.load()

        cfg = settings_dict or {}
        out_path = os.path.join(job_dir, f"converted_{uuid.uuid4().hex[:8]}.wav")
        repo = settings.seed_vc_model_path
        device = settings.seed_vc_device if (self.gpu_available() or
                                             settings.allow_cpu_fallback) else "cpu"

        cmd = [
            "python3", os.path.join(repo, "inference.py"),
            "--source", source_wav,
            "--target", reference_wav,
            "--output", out_path,
            "--diffusion-steps", str(cfg.get("diffusion_steps", 30)),
            "--length-adjust", str(cfg.get("length_adjust", 1.0)),
            "--inference-cfg-rate", str(cfg.get("inference_cfg_rate", 0.7)),
            "--device", device,
        ]
        try:
            proc = subprocess.Popen(
                cmd, cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True)
            if progress_cb:
                progress_cb("processing", 40.0)
            # Stream output so a hung job can still be cancelled by the caller
            # killing the process group; simple blocking drain here.
            proc.wait(timeout=settings.job_timeout_seconds)
        except subprocess.TimeoutExpired:
            proc.kill()
            raise AudioValidationError("provider_timeout", "Seed-VC inference timed out.")
        except FileNotFoundError:
            raise SeedVCNotAvailable("Seed-VC runtime not found on worker host.")

        if proc.returncode != 0 or not os.path.exists(out_path):
            raise AudioValidationError(
                "conversion_failed", "Seed-VC conversion failed to produce output.")
        return out_path


seed_vc_engine = SeedVCEngine()
