"""S3-compatible object storage abstraction.

Configuration (backend env only — credentials never reach the frontend):
  STORAGE_PROVIDER   s3 | local (default local = on-disk fallback for dev)
  STORAGE_ENDPOINT   custom S3 endpoint (MinIO, R2, etc.)
  STORAGE_BUCKET
  STORAGE_REGION
  STORAGE_ACCESS_KEY
  STORAGE_SECRET_KEY

Capabilities: upload / download / delete / signed URL / metadata / exists.
boto3 is imported lazily so the app server runs without it when the local
dev provider is used.
"""
import os
import uuid
from datetime import timedelta
from typing import Any, Dict, Optional

from core.config import settings


class StorageError(Exception):
    """User-safe storage failure."""


class LocalObjectStore:
    """Filesystem-backed store for local development (no S3 configured)."""

    name = "local"

    def __init__(self, root: str):
        self._root = root
        os.makedirs(root, exist_ok=True)

    def _path(self, key: str) -> str:
        # prevent path traversal
        safe = os.path.normpath(key).lstrip("/.")
        if ".." in safe.split(os.sep):
            raise StorageError("Invalid storage key.")
        p = os.path.join(self._root, safe)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return p

    def upload(self, local_path: str, key: str) -> Dict[str, Any]:
        import shutil
        p = self._path(key)
        shutil.copyfile(local_path, p)
        return {"key": key, "size": os.path.getsize(p)}

    def download(self, key: str, local_path: str) -> str:
        import shutil
        p = self._path(key)
        if not os.path.exists(p):
            raise StorageError("Object not found.")
        shutil.copyfile(p, local_path)
        return local_path

    def delete(self, key: str) -> None:
        try:
            os.remove(self._path(key))
        except FileNotFoundError:
            pass

    def exists(self, key: str) -> bool:
        return os.path.exists(self._path(key))

    def metadata(self, key: str) -> Optional[Dict[str, Any]]:
        p = self._path(key)
        if not os.path.exists(p):
            return None
        return {"key": key, "size": os.path.getsize(p)}

    def signed_url(self, key: str, expires_in: int = 3600) -> str:
        # Local dev has no signed URLs; caller must serve via API route.
        return f"/api/storage/local/{key}"


class S3ObjectStore:
    """S3-compatible store (AWS S3, MinIO, Cloudflare R2, ...)."""

    name = "s3"

    def __init__(self):
        try:
            import boto3  # noqa: F401
        except ImportError as exc:  # pragma: no cover
            raise StorageError("S3 storage selected but boto3 is not installed.")
        self._bucket = settings.STORAGE_BUCKET
        if not self._bucket:
            raise StorageError("STORAGE_BUCKET is not configured.")
        kwargs: Dict[str, Any] = {}
        if settings.STORAGE_ENDPOINT:
            kwargs["endpoint_url"] = settings.STORAGE_ENDPOINT
        if settings.STORAGE_REGION:
            kwargs["region_name"] = settings.STORAGE_REGION
        if settings.STORAGE_ACCESS_KEY:
            kwargs["aws_access_key_id"] = settings.STORAGE_ACCESS_KEY
        if settings.STORAGE_SECRET_KEY:
            kwargs["aws_secret_access_key"] = settings.STORAGE_SECRET_KEY
        self._client = boto3.client("s3", **kwargs)

    def upload(self, local_path: str, key: str) -> Dict[str, Any]:
        try:
            self._client.upload_file(local_path, self._bucket, key)
        except Exception:
            raise StorageError("Failed to upload file to object storage.")
        return {"key": key, "size": os.path.getsize(local_path)}

    def download(self, key: str, local_path: str) -> str:
        try:
            self._client.download_file(self._bucket, key, local_path)
        except Exception:
            raise StorageError("Failed to download file from object storage.")
        return local_path

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except Exception:
            raise StorageError("Failed to delete object.")

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except Exception:
            return False

    def metadata(self, key: str) -> Optional[Dict[str, Any]]:
        try:
            head = self._client.head_object(Bucket=self._bucket, Key=key)
        except Exception:
            return None
        return {"key": key, "size": head.get("ContentLength")}

    def signed_url(self, key: str, expires_in: int = 3600) -> str:
        try:
            return self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=expires_in,
            )
        except Exception:
            raise StorageError("Failed to create signed URL.")


# ObjectStore protocol alias for type hints
ObjectStore = Any

_store: Optional[Any] = None


def get_object_store():
    """Singleton store chosen by STORAGE_PROVIDER."""
    global _store
    if _store is None:
        if settings.STORAGE_PROVIDER == "s3":
            _store = S3ObjectStore()
        else:
            _store = LocalObjectStore(
                os.path.join(os.getcwd(), "storage", "objects")
            )
    return _store


def make_key(prefix: str, filename: str = "") -> str:
    """Build a collision-safe storage key: {prefix}/{uuid}/{filename}."""
    safe = os.path.basename(filename or "file")
    return f"{prefix.strip('/')}/{uuid.uuid4().hex}/{safe}"
