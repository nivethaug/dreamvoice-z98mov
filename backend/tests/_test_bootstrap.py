"""Test bootstrap: stub bcrypt (native lib unavailable in sandbox).

The deployment server has real bcrypt; tests substitute a deterministic
pure-python implementation so the auth service imports cleanly.
"""
import hashlib
import sys
import types


def _install_bcrypt_stub() -> None:
    try:
        import bcrypt  # noqa: F401
        return
    except Exception:
        pass

    mod = types.ModuleType("bcrypt")

    def hashpw(password: bytes, salt: bytes) -> bytes:
        return b"$stub$" + hashlib.sha256(salt + password).digest()

    def checkpw(password: bytes, hashed: bytes) -> bool:
        if hashed.startswith(b"$stub$"):
            return hashlib.sha256(hashed[6:] + password).digest() == hashed[6:]
        return False

    def gensalt(rounds: int = 12) -> bytes:
        return b"salt"

    mod.hashpw = hashpw
    mod.checkpw = checkpw
    mod.gensalt = gensalt
    sys.modules["bcrypt"] = mod


_install_bcrypt_stub()
