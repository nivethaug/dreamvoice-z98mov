"""CPU media processing utilities (FFmpeg/ffprobe via subprocess).

Runs where FFmpeg exists (the deployment/worker environment). Audio-only
processing stays on CPU — GPU inference remains on RunPod via the Voice API.
"""
from __future__ import annotations

import json
import subprocess  # noqa: S404 - controlled ffmpeg/ffprobe invocations
from pathlib import Path
from typing import Any, Dict, Optional


class MediaProcessingError(Exception):
    pass


def _run(cmd: list, timeout: int = 900) -> subprocess.CompletedProcess:
    try:
        proc = subprocess.run(  # noqa: S603
            cmd, capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError as exc:
        raise MediaProcessingError(
            "Media processing tools are not available in this environment."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaProcessingError("Media processing timed out.") from exc
    return proc


def ffprobe(path: str) -> Dict[str, Any]:
    """Probe a media file: returns {duration, format, has_audio, has_video,
    size_bytes, sample_rate}."""
    proc = _run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ])
    if proc.returncode != 0:
        raise MediaProcessingError("Media file could not be analyzed.")
    try:
        data = json.loads(proc.stdout)
    except ValueError as exc:
        raise MediaProcessingError("Media file could not be analyzed.") from exc

    streams = data.get("streams", [])
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    fmt = data.get("format", {})
    duration = float(fmt.get("duration") or (audio or {}).get("duration") or 0)
    return {
        "duration": duration,
        "format_name": fmt.get("format_name", ""),
        "has_audio": audio is not None,
        "has_video": video is not None,
        "size_bytes": int(fmt.get("size") or 0),
        "sample_rate": int(audio["sample_rate"]) if audio and audio.get("sample_rate") else None,
    }


def extract_audio(source_path: str, dest_wav: Optional[str] = None) -> Path:
    """Extract audio from any media file to 44.1kHz mono WAV (Seed-VC input)."""
    src = Path(source_path)
    out = Path(dest_wav) if dest_wav else src.with_suffix(".extracted.wav")
    proc = _run([
        "ffmpeg", "-y", "-i", str(src),
        "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1",
        str(out),
    ])
    if proc.returncode != 0 or not out.exists() or out.stat().st_size < 1024:
        raise MediaProcessingError("Audio could not be extracted from this media file.")
    return out


def mux_video(video_path: str, audio_path: str,
              dest_mp4: Optional[str] = None) -> Path:
    """Replace ONLY the audio track; video stream is copied (no re-encode).

    Preserves resolution, frame rate, and video quality.
    """
    src = Path(video_path)
    out = Path(dest_mp4) if dest_mp4 else src.with_suffix(".converted.mp4")
    proc = _run([
        "ffmpeg", "-y", "-i", str(src), "-i", str(audio_path),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(out),
    ])
    if proc.returncode != 0:
        raise MediaProcessingError("Final video could not be produced.")
    _validate_muxed(str(out), reference=str(video_path))
    return out


def _validate_muxed(path: str, reference: str) -> None:
    """Final MP4 sanity: exists, non-trivial size, video+audio streams,
    duration close to the original."""
    p = Path(path)
    if not p.exists() or p.stat().st_size < 10240:
        raise MediaProcessingError("Final video is invalid.")
    info = ffprobe(path)
    if not info["has_video"] or not info["has_audio"]:
        raise MediaProcessingError("Final video is missing a required stream.")
    ref_dur = ffprobe(reference)["duration"]
    if info["duration"] <= 0 or abs(info["duration"] - ref_dur) > max(5, ref_dur * 0.1):
        raise MediaProcessingError("Final video duration is unexpected.")


def validate_audio_output(path: str, expected_duration: float) -> Dict[str, Any]:
    """Validate converted audio: WAV header (RIFF), size, duration tolerance."""
    p = Path(path)
    if not p.exists() or p.stat().st_size < 1024:
        raise MediaProcessingError("Converted audio is invalid.")
    with open(p, "rb") as fh:
        header = fh.read(12)
    if not header.startswith(b"RIFF") or b"WAVE" not in header:
        raise MediaProcessingError("Converted audio is invalid.")
    info = ffprobe(path)
    if info["duration"] <= 0:
        raise MediaProcessingError("Converted audio is invalid.")
    if expected_duration > 0:
        tolerance = max(10.0, expected_duration * (1 + MAX_LEN_TOLERANCE))
        if info["duration"] > tolerance:
            raise MediaProcessingError("Converted audio is invalid.")
    return info


MAX_LEN_TOLERANCE = 0.5  # Seed-VC can slightly shift length
