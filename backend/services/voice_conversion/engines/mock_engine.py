"""Mock engine - simulates the conversion pipeline without any AI model."""
import asyncio
from typing import Any, Dict, Optional

from .base import EngineValidationError, VoiceConversionEngine

# Pipeline stage -> (state, base progress %)
STAGES = [
    ("Preparing media", "preparing", 20),
    ("Analyzing speech", "processing", 40),
    ("Converting voice", "processing", 65),
    ("Enhancing audio", "enhancing", 85),
    ("Finalizing", "finalizing", 100),
]

SUPPORTED_OUTPUT_FORMATS = {"mp3", "wav", "m4a", "mp4"}


class MockVoiceConversionEngine(VoiceConversionEngine):
    """Simulates a voice conversion pipeline. No real processing."""

    name = "mock"

    def __init__(self, total_duration_s: float = 6.0):
        self._cancelled: set = set()
        self._total = total_duration_s

    async def validate(
        self,
        source_media: Optional[Dict[str, Any]],
        source_audio: Optional[Dict[str, Any]],
        target_voice: Dict[str, Any],
        settings: Dict[str, Any],
    ) -> None:
        if not source_media and not source_audio:
            raise EngineValidationError("No source media or audio provided.")
        if not target_voice or not target_voice.get("voice_id"):
            raise EngineValidationError("A target voice ID is required.")

    async def convert(
        self,
        job_id: str,
        source_media: Optional[Dict[str, Any]],
        source_audio: Optional[Dict[str, Any]],
        target_voice: Dict[str, Any],
        settings: Dict[str, Any],
        output_format: str,
        progress_callback=None,
    ) -> Dict[str, Any]:
        if output_format not in SUPPORTED_OUTPUT_FORMATS:
            raise EngineValidationError(
                f"Unsupported output format '{output_format}'."
            )

        step_delay = self._total / len(STAGES)
        for stage, state, pct in STAGES:
            if job_id in self._cancelled:
                self._cancelled.discard(job_id)
                raise asyncio.CancelledError()
            if progress_callback:
                progress_callback(stage, state, pct)
            # simulate work with granular sub-progress
            for sub in range(1, 6):
                if job_id in self._cancelled:
                    self._cancelled.discard(job_id)
                    raise asyncio.CancelledError()
                await asyncio.sleep(step_delay / 5)
                if progress_callback:
                    progress_callback(stage, state, pct)

        media = source_media or source_audio or {}
        return {
            "output_format": output_format,
            "duration_seconds": media.get("duration_seconds", 0),
            "sample_rate": 44100,
            "engine": self.name,
        }

    async def cancel(self, job_id: str) -> None:
        self._cancelled.add(job_id)
