"""Audio enhancement engine interface (architecture only).

DeepFilterNet or another enhancer can implement this later. For now the
pipeline uses a pass-through enhancer so the stage exists in the lifecycle
without installing anything.
"""
import abc
from typing import Any, Dict


class AudioEnhancementEngine(abc.ABC):
    """Interface for post-conversion audio enhancement."""

    name: str = "base"

    @abc.abstractmethod
    async def enhance(self, audio: Dict[str, Any], settings: Dict[str, Any]) -> Dict[str, Any]:
        """Enhance converted audio; returns updated audio metadata."""


class PassThroughEnhancementEngine(AudioEnhancementEngine):
    """No-op enhancer - returns audio unchanged (enhancement disabled)."""

    name = "disabled"

    async def enhance(self, audio: Dict[str, Any], settings: Dict[str, Any]) -> Dict[str, Any]:
        audio = dict(audio)
        audio["enhanced"] = False
        return audio
