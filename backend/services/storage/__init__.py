"""Object storage package."""
from .object_store import ObjectStore, StorageError, get_object_store

__all__ = ["ObjectStore", "StorageError", "get_object_store"]
