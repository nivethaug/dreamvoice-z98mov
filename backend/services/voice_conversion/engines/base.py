"""Model-agnostic voice conversion engine interface.

Every engine (Seed-VC, RVC, ...) must implement this ABC. The job manager
only talks to this interface, so engines can be swapped without touching
routes or job logic.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class VoiceConversionEngine(ABC):
    """Abstract interface for a voice-conversion engine."""

    name: str = "base"

    @abstractmethod
    async def validate(
        self,
        source_media: Optional[Dict[str, Any]],
        source_audio: Optional[Dict[str, Any]],
        target_voice: Dict[str, Any],
        settings: Dict[str, Any],
    ) -> None:
        """Validate inputs before conversion.

        Raises:
            EngineValidationError: if inputs cannot be processed.
        """

    @abstractmethod
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
        """Run conversion, reporting progress via progress_callback(stage, pct).

        Returns a result dict (e.g. output artifacts metadata).
        Raises EngineError on failure.
        """

    @abstractmethod
    async def cancel(self, job_id: str) -> None:
        """Request cancellation of a running conversion."""


class EngineError(Exception):
    """Raised when an engine fails during conversion."""


class EngineValidationError(Exception):
    """Raised when engine-side input validation fails."""
