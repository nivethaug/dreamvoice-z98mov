"""Temporary file store with automatic cleanup for conversion artifacts.

Files registered here are deleted after TEMP_FILE_TTL_SECONDS (or on
shutdown), so no media is permanently stored.
"""
import asyncio
import os
import time
from typing import Set

TEMP_FILE_TTL_SECONDS = 3600
CLEANUP_INTERVAL_SECONDS = 600

_files: Set[str] = set()
_added_at: dict = {}
_task: "asyncio.Task | None" = None


def register_temp_file(path: str) -> None:
    _files.add(path)
    _added_at[path] = time.time()


def remove_temp_file(path: str) -> None:
    _files.discard(path)
    _added_at.pop(path, None)
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def tracked_files() -> int:
    return len(_files)


def cleanup_expired() -> int:
    """Delete tracked files older than TTL. Returns number removed."""
    now = time.time()
    expired = [p for p, t in _added_at.items() if now - t > TEMP_FILE_TTL_SECONDS]
    for p in expired:
        remove_temp_file(p)
    return len(expired)


async def _periodic_cleanup() -> None:
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        cleanup_expired()


def start_cleanup_task() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_periodic_cleanup())


async def shutdown_cleanup() -> None:
    """Remove ALL tracked temp files on shutdown."""
    global _task
    if _task:
        _task.cancel()
        _task = None
    for path in list(_files):
        remove_temp_file(path)
