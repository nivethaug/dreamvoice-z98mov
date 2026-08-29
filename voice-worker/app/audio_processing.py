"""Audio validation and normalization via FFmpeg for Seed-VC input."""
import os
import subprocess
import uuid

ALLOWED_INPUT_EXT = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus", ".webm"}
MIN_SAMPLE_RATE = 8000


class AudioValidationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _probe(path: str) -> dict:
    """ffprobe metadata; raises AudioValidationError on failure."""
    cmd = [
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=sample_rate,channels,codec_type",
        "-of", "json", path,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        raise AudioValidationError("ffprobe_failed", f"Audio probing unavailable: {e}")
    import json
    try:
        data = json.loads(out.stdout or "{}")
    except json.JSONDecodeError:
        raise AudioValidationError("invalid_audio", "Could not read audio metadata.")
    if out.returncode != 0 or not data.get("format"):
        raise AudioValidationError("invalid_audio", "File is not a valid audio/media file.")
    return data


def validate_audio(path: str, max_duration: float) -> dict:
    """Validate format, size, duration, sample rate, non-empty audio."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in ALLOWED_INPUT_EXT:
        raise AudioValidationError(
            "unsupported_format",
            f"Unsupported audio format '{ext}'. Allowed: {sorted(ALLOWED_INPUT_EXT)}")

    info = _probe(path)
    fmt = info["format"]
    streams = info.get("streams") or []
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    if not audio_streams:
        raise AudioValidationError("invalid_audio", "File contains no audio stream.")

    duration = float(fmt.get("duration") or 0)
    if duration <= 0.05:
        raise AudioValidationError("empty_audio", "Audio is empty or too short to process.")
    if duration > max_duration:
        raise AudioValidationError(
            "too_long",
            f"Audio duration {duration:.0f}s exceeds the {max_duration:.0f}s limit.")

    sr = int(audio_streams[0].get("sample_rate") or 0)
    if sr and sr < MIN_SAMPLE_RATE:
        raise AudioValidationError(
            "invalid_sample_rate",
            f"Sample rate {sr} Hz is below the {MIN_SAMPLE_RATE} Hz minimum.")

    return {"duration": duration, "sample_rate": sr or None,
            "channels": int(audio_streams[0].get("channels") or 0)}


def normalize_to_wav(path: str, job_dir: str, target_sr: int = 44100) -> str:
    """Normalize any input to a 44.1kHz mono/stereo WAV as required by Seed-VC."""
    out = os.path.join(job_dir, f"norm_{uuid.uuid4().hex[:8]}.wav")
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-i", path,
        "-vn", "-ar", str(target_sr), "-ac", "1", "-sample_fmt", "s16", out,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if res.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) < 1024:
        raise AudioValidationError(
            "normalization_failed", "Failed to normalize audio for conversion.")
    return out


def validate_output(path: str, expected_duration: float, tolerance: float = 0.35) -> None:
    """Verify output exists, is playable, non-zero, and duration matches."""
    if not os.path.exists(path) or os.path.getsize(path) < 2048:
        raise AudioValidationError("invalid_output", "Conversion produced no usable audio.")
    info = _probe(path)
    out_dur = float(info["format"].get("duration") or 0)
    if out_dur <= 0.05:
        raise AudioValidationError("invalid_output", "Converted audio is empty.")
    if expected_duration > 0 and abs(out_dur - expected_duration) / expected_duration > tolerance:
        raise AudioValidationError(
            "duration_mismatch",
            f"Output duration {out_dur:.1f}s deviates from source {expected_duration:.1f}s.")
