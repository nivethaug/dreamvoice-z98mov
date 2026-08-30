"""Temporary public HTTPS media layer for the Voice API.

The shared Voice API requires public HTTPS URLs for source audio and target
voice references. This module stores uploaded media under unpredictable UUID
keys in the existing object store and returns public HTTPS URLs:

- S3-compatible storage: presigned URLs (time-limited).
- Local dev storage: an HMAC-signed expiring token route served by this
  backend on its public API domain (PUBLIC_MEDIA_BASE_URL) — no localhost,
  no private IPs, no directory listing, no path traversal.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from core.config import settings
from services.storage.object_store import (
    LocalObjectStore,
    S3ObjectStore,
    StorageError,
    get_object_store,
)

TOKEN_TTL_SECONDS = 2 * 60 * 60  # 2h: covers conversion + download window


def _sign(message: str) -> str:
    secret = settings.SECRET_KEY.encode()
    digest = hmac.new(secret, message.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def make_media_token(key: str, ttl: int = TOKEN_TTL_SECONDS) -> str:
    exp = int(time.time()) + ttl
    msg = f"{key}:{exp}"
    key_b64 = base64.urlsafe_b64encode(key.encode()).decode().rstrip("=")
    return f"{key_b64}:{exp}:{_sign(msg)}"


def verify_media_token(token: str) -> Optional[str]:
    """Validate a media token; return the storage key or None."""
    try:
        key_b64, exp_str, sig = token.split(":")
        exp = int(exp_str)
        key = base64.urlsafe_b64decode(key_b64 + "=" * (-len(key_b64) % 4)).decode()
    except (ValueError, AttributeError):
        return None
    if exp < int(time.time()):
        return None
    expected = _sign(f"{key}:{exp}")
    if not hmac.compare_digest(expected, sig):
        return None
    # Traversal safety
    if ".." in key or key.startswith("/"):
        return None
    return key


def _public_base() -> str:
    base = (settings.public_media_base_url or "").rstrip("/")
    if not base or base.startswith("http://localhost") or \
            "://127.0.0.1" in base or "://0.0.0.0" in base:
        # Never expose local/private addresses to the external Voice API.
        return ""
    return base


def random_key(prefix: str, ext: str) -> str:
    """Unpredictable storage key; extension restricted to allow-list."""
    allowed = {"mp4", "mov", "mp3", "wav", "m4a"}
    ext = ext.lower().lstrip(".")
    if ext not in allowed:
        ext = "bin"
    return f"{prefix}/{uuid.uuid4().hex}.{ext}"


def store_media(local_path: str, prefix: str, ext: str) -> Dict[str, Any]:
    """Upload to the object store and return {key, public_url, size}."""
    store = get_object_store()
    key = random_key(prefix, ext)
    meta = store.upload(local_path, key)
    url = ""
    if isinstance(store, S3ObjectStore):
        try:
            url = store.signed_url(key, expires_in=TOKEN_TTL_SECONDS)
        except Exception:
            url = ""
    else:
        base = _public_base()
        if base:
            url = f"{base}/api/media/temp/{make_media_token(key)}"
    if not url:
        # No public URL strategy available in this environment.
        store.delete(key)
        raise StorageError(
            "Public media URL is not available in this environment "
            "(configure S3 storage or PUBLIC_MEDIA_BASE_URL)."
        )
    return {"key": key, "public_url": url,
            "size": meta.get("size", os.path.getsize(local_path))}


def read_media(key: str) -> Optional[bytes]:
    """Read back a stored media object (used by the temp-serving route)."""
    store = get_object_store()
    # traversal-safe: random_key only ever produces prefix/hex.ext
    if "/" not in key or ".." in key:
        return None
    prefix, name = key.split("/", 1)
    if not name or not all(c in "0123456789abcdef." for c in name):
        return None
    try:
        import tempfile
        fd, tmp = tempfile.mkstemp()
        os.close(fd)
        store.download(key, tmp)
        with open(tmp, "rb") as fh:
            data = fh.read()
        os.remove(tmp)
        return data
    except StorageError:
        return None


def delete_media(key: str) -> None:
    try:
        get_object_store().delete(key)
    except Exception:
        pass
