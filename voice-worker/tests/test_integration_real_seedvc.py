"""INTEGRATION test — runs REAL Seed-VC inference.

Only runs when:
  SEED_VC_RUN_INTEGRATION=1
and a real checkpoint is configured via SEED_VC_MODEL_PATH / SEED_VC_CHECKPOINT
and a GPU is present. Skipped otherwise. Requires FFmpeg on PATH.

Usage on the GPU host:
  SEED_VC_RUN_INTEGRATION=1 \
  SEED_VC_MODEL_PATH=/models/seed-vc \
  SEED_VC_CHECKPOINT=/models/seed-vc/checkpoints/seed-vc-v2/seed-vc-v2.pt \
  VOICE_WORKER_API_KEY=test \
  python -m pytest tests/test_integration_real_seedvc.py -v
"""
import io
import os
import time
import wave
import struct
import math

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("SEED_VC_RUN_INTEGRATION") != "1",
    reason="Set SEED_VC_RUN_INTEGRATION=1 with a real checkpoint to run")

os.environ.setdefault("VOICE_WORKER_API_KEY", "test-worker-key")

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

AUTH = {"X-API-Key": "test-worker-key"}


def make_wav(seconds: float, sr: int = 44100, freq: int = 220) -> bytes:
    n = int(seconds * sr)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / sr)))
            for i in range(n)))
    return buf.getvalue()


def test_real_seed_vc_conversion():
    with TestClient(app) as client:
        health = client.get("/health").json()
        assert health["engine_ready"], f"engine not ready: {health}"

        files = {
            "source": ("source.wav", io.BytesIO(make_wav(3.0)), "audio/wav"),
            "reference": ("reference.wav", io.BytesIO(make_wav(3.0, freq=440)),
                          "audio/wav"),
        }
        r = client.post("/v1/voice/convert", files=files,
                        data={"model": "seed-vc"}, headers=AUTH)
        assert r.status_code == 200
        job = r.json()
        for _ in range(1200):  # up to 10 min
            job = client.get(f"/v1/voice/jobs/{job['job_id']}",
                             headers=AUTH).json()
            if job["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.5)
        assert job["status"] == "completed", job

        res = client.get(f"/v1/voice/jobs/{job['job_id']}/result", headers=AUTH)
        assert res.status_code == 200
        audio = res.content
        assert len(audio) > 2048
        # must NOT be the source audio echoed back
        assert audio != make_wav(3.0)
        with wave.open(io.BytesIO(audio)) as w:
            assert w.getnframes() > 0
