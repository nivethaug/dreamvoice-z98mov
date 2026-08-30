"""Server-side client for the shared Voice API Media API.

ALL media processing (ffprobe inspection, audio extraction/normalization,
video muxing) happens inside the shared Voice API. DreamVoice only moves
bytes and reads metadata — it never runs ffmpeg/ffprobe locally.

Security: VOICE_API_KEY is read from the backend environment only.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

# Media the upload route already pushed to the Voice API (validated there
# with server-side ffprobe). The conversion engine claims the VA file_id so
# a source is never uploaded twice. Values: {"va_file_id", "duration"}.
PENDING_SOURCE_META: dict = {}


def remember_source(key: str, va_file_id: str, duration: float) -> None:
    if key and va_file_id:
        PENDING_SOURCE_META[key] = {
            "va_file_id": va_file_id,
            "duration": float(duration or 0),
        }


def peek_source(key: str) -> Optional[dict]:
    return PENDING_SOURCE_META.get(key)


def claim_source(key: str) -> Optional[str]:
    meta = PENDING_SOURCE_META.pop(key, None)
    return meta.get("va_file_id") if meta else None


UPLOAD_TIMEOUT = 300.0
OPERATION_TIMEOUT = 600.0  # mux/extract can take a while on long videos
DOWNLOAD_TIMEOUT = 300.0


class VoiceApiMediaError(Exception):
    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.status = status


def get_media_client() -> "VoiceApiMediaClient":
    return VoiceApiMediaClient()


class VoiceApiMediaClient:
    """Thin wrapper over /v1/media/* on the shared Voice API."""

    def __init__(self, base_url: Optional[str] = None,
                 api_key: Optional[str] = None):
        self.base_url = (base_url or settings.voice_api_base_url).rstrip("/")
        self.api_key = api_key or settings.voice_api_key

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _raise(self, exc: httpx.HTTPError, action: str) -> None:
        raise VoiceApiMediaError(
            f"Voice media service error during {action}: {type(exc).__name__}"
        ) from exc

    # ------------------------------------------------------------- upload
    def upload(self, file_path: Path | str, filename: Optional[str] = None
               ) -> Dict[str, Any]:
        """Upload media. The Voice API runs ffprobe server-side and returns
        duration + audio/video stream metadata (source validation)."""
        path = Path(file_path)
        headers = self._headers()
        try:
            with path.open("rb") as fh:
                resp = httpx.post(
                    self._url("/v1/media/upload"),
                    headers=headers,
                    files={"file": (filename or path.name, fh)},
                    timeout=UPLOAD_TIMEOUT,
                )
        except httpx.HTTPError as exc:
            self._raise(exc, "upload")
        self._check(resp, "upload")
        return resp.json()

    # --------------------------------------------------------- get / delete
    def get(self, file_id: str) -> Dict[str, Any]:
        try:
            resp = httpx.get(self._url(f"/v1/media/{file_id}"),
                             headers=self._headers(), timeout=60.0)
        except httpx.HTTPError as exc:
            self._raise(exc, "get")
        self._check(resp, "get")
        return resp.json()

    def delete(self, file_id: str) -> None:
        try:
            resp = httpx.delete(self._url(f"/v1/media/{file_id}"),
                                headers=self._headers(), timeout=60.0)
        except httpx.HTTPError as exc:
            self._raise(exc, "delete")
        # 404 on delete is fine (already gone / expired)
        if resp.status_code not in (200, 202, 204, 404):
            self._error(resp, "delete")

    # -------------------------------------------------------- extract audio
    def extract_audio(self, file_id: str, sample_rate: int = 44100,
                      channels: int = 1, fmt: str = "wav") -> Dict[str, Any]:
        """Extract + normalize audio inside the Voice API (WAV PCM)."""
        try:
            resp = httpx.post(
                self._url(f"/v1/media/{file_id}/extract-audio"),
                headers=self._headers(),
                json={"format": fmt, "sample_rate": sample_rate,
                      "channels": channels},
                timeout=OPERATION_TIMEOUT,
            )
        except httpx.HTTPError as exc:
            self._raise(exc, "extract-audio")
        self._check(resp, "extract-audio")
        return resp.json()

    # -------------------------------------------------------- replace audio
    def replace_audio(self, video_file_id: str, audio_file_id: str
                      ) -> Dict[str, Any]:
        """Replace the video's audio track (stream copy, -c:v copy, -shortest)
        inside the Voice API. Returns final MP4 media metadata."""
        try:
            resp = httpx.post(
                self._url(f"/v1/media/{video_file_id}/replace-audio"),
                headers=self._headers(),
                json={"audio_file_id": audio_file_id},
                timeout=OPERATION_TIMEOUT,
            )
        except httpx.HTTPError as exc:
            self._raise(exc, "replace-audio")
        self._check(resp, "replace-audio")
        return resp.json()

    # ------------------------------------------------------------ download
    def download(self, file_id: str, dest: Path | str) -> Path:
        dest_path = Path(dest)
        try:
            with httpx.stream("GET",
                              self._url(f"/v1/media/{file_id}/download"),
                              headers=self._headers(),
                              timeout=DOWNLOAD_TIMEOUT) as resp:
                self._check(resp, "download")
                with dest_path.open("wb") as fh:
                    for chunk in resp.iter_bytes(1024 * 1024):
                        fh.write(chunk)
        except httpx.HTTPError as exc:
            self._raise(exc, "download")
        return dest_path

    # ------------------------------------------------------------ internals
    def _check(self, resp: httpx.Response, action: str) -> None:
        if resp.status_code >= 400:
            self._error(resp, action)

    def _error(self, resp: httpx.Response, action: str) -> None:
        detail = ""
        try:
            body = resp.json()
            detail = str(body.get("detail", body))[:300]
        except Exception:
            detail = resp.text[:300]
        raise VoiceApiMediaError(
            f"Voice media service rejected {action} "
            f"(HTTP {resp.status_code}): {detail}",
            status=resp.status_code,
        )
