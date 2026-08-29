"""Media pipeline utilities: validation, audio extraction, reassembly prep.

FFmpeg is used for audio extraction (video -> WAV). The original uploaded
file is never modified; extraction output goes to the temp store. Video
reassembly (original video + converted audio -> final MP4) is prepared but
not executed yet.
"""
import asyncio
import os
import tempfile
from typing import Any, Dict, Optional

SUPPORTED_INPUT_MIME_PREFIXES = ("audio/", "video/")
MAX_VIDEO_BYTES = 500 * 1024 * 1024
MAX_AUDIO_BYTES = 100 * 1024 * 1024
MAX_DURATION_SECONDS = 30 * 60
REASSEMBLY_ARGS = [
    # Preserve original video stream, resolution, and frame rate; replace audio.
    "-c:v", "copy",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-shortest",
]


class MediaValidationError(Exception):
    pass


def validate_media(meta: Dict[str, Any]) -> None:
    mime = (meta.get("mime_type") or "").lower()
    if not mime.startswith(SUPPORTED_INPUT_MIME_PREFIXES):
        raise MediaValidationError("Unsupported media type.")
    is_video = mime.startswith("video/")
    size = meta.get("size_bytes") or 0
    limit = MAX_VIDEO_BYTES if is_video else MAX_AUDIO_BYTES
    if size > limit:
        raise MediaValidationError(
            f"File is too large. Maximum {'video' if is_video else 'audio'} "
            f"size is {limit // (1024 * 1024)} MB."
        )
    duration = meta.get("duration_seconds") or 0
    if duration > MAX_DURATION_SECONDS:
        raise MediaValidationError(
            "This media is too long. Maximum duration is 30 minutes."
        )


async def extract_audio(source_path: str) -> str:
    """Extract mono/stereo WAV audio from a media file using FFmpeg.

    Returns the temp WAV path (registered for auto-cleanup). The source
    file is left untouched.
    """
    if not os.path.exists(source_path):
        raise MediaValidationError("Source media file not found.")
    fd, out_path = tempfile.mkstemp(prefix="vc_extract_", suffix=".wav")
    os.close(fd)
    from .temp_store import register_temp_file

    register_temp_file(out_path)
    cmd = [
        "ffmpeg", "-y", "-i", source_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1",
        out_path,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
    except FileNotFoundError:
        from .temp_store import remove_temp_file

        remove_temp_file(out_path)
        raise MediaValidationError("FFmpeg is not available on the server.")
    except asyncio.TimeoutError:
        proc.kill()
        from .temp_store import remove_temp_file

        remove_temp_file(out_path)
        raise MediaValidationError("Audio extraction timed out.")
    if proc.returncode != 0 or not os.path.getsize(out_path):
        from .temp_store import remove_temp_file

        remove_temp_file(out_path)
        raise MediaValidationError("Could not extract audio from this media file.")
    return out_path


def reassembly_command(video_path: str, audio_path: str, out_path: str) -> list:
    """Build the FFmpeg command that combines original video with converted
    audio, preserving original resolution and frame rate (next step)."""
    return ["ffmpeg", "-y", "-i", video_path, "-i", audio_path, *REASSEMBLY_ARGS, out_path]
