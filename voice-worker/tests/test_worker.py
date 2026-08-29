"""Seed-VC GPU Worker test suite.

Runs WITHOUT a GPU, Seed-VC, or FFmpeg: the inference engine is monkeypatched
and FFmpeg-driven helpers are stubbed. The integration test that exercises the
real Seed-VC checkpoint lives in test_integration_real_seedvc.py and is skipped
unless SEED_VC_RUN_INTEGRATION=1.
"""
import io
import json
import os
import sys
import time
import wave
import struct
import shutil
import tempfile

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("VOICE_WORKER_API_KEY", "test-worker-key")

from app.main import app  # noqa: E402
from app import main as main_mod  # noqa: E402
from app.config import settings  # noqa: E402

AUTH = {"X-API-Key": "test-worker-key"}


def make_wav_bytes(seconds: float = 1.0, sr: int = 16000, freq: int = 220) -> bytes:
    n = int(seconds * sr)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"".join(
            struct.pack("<h", int(12000 * __import__("math").sin(
                2 * 3.14159 * freq * i / sr))) for i in range(n)))
    return buf.getvalue()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def fake_pipeline(monkeypatch):
    """Replace ffmpeg-dependent validation and Seed-VC inference with fakes."""
    # engine reports ready + gpu
    monkeypatch.setattr(main_mod.seed_vc_engine, "_loaded", True)
    monkeypatch.setattr(main_mod.seed_vc_engine, "_load_error", None)
    monkeypatch.setattr(main_mod.seed_vc_engine, "gpu_available", lambda: True)
    monkeypatch.setattr(main_mod.seed_vc_engine, "load", lambda: None)

    # validate_audio: pass through with fixed duration
    def fake_validate(path, max_duration):
        if getattr(fake_validate, "fail", None):
            from app.audio_processing import AudioValidationError
            raise AudioValidationError(fake_validate["fail"], "stubbed failure")
        return {"duration": 1.0, "sample_rate": 44100, "channels": 1}

    monkeypatch.setattr(main_mod, "validate_audio", fake_validate)
    fake_validate.fail = None

    def fake_normalize(path, job_dir, target_sr=44100):
        out = os.path.join(job_dir, "norm_fake.wav")
        with open(out, "wb") as f:
            f.write(make_wav_bytes())
        return out

    monkeypatch.setattr(main_mod, "normalize_to_wav", fake_normalize)
    monkeypatch.setattr(main_mod, "validate_output", lambda *a, **k: None)

    created = []
    orig_convert = main_mod.seed_vc_engine.convert

    def fast_convert(source_wav, reference_wav, job_dir, settings_dict=None,
                     progress_cb=None):
        out = os.path.join(job_dir, "converted_fake.wav")
        with open(out, "wb") as f:
            f.write(make_wav_bytes())
        created.append(out)
        if progress_cb:
            progress_cb("processing", 60.0)
        return out

    monkeypatch.setattr(main_mod.seed_vc_engine, "convert", fast_convert)
    fake_pipeline.outputs = created
    fake_pipeline.validate = fake_validate
    yield fake_pipeline
    created.clear()


def post_convert(client, source=b"src", reference=b"ref", model="seed-vc",
                 settings_json=None, headers=AUTH):
    files = {
        "source": ("source.wav", io.BytesIO(source), "audio/wav"),
        "reference": ("reference.wav", io.BytesIO(reference), "audio/wav"),
    }
    data = {"model": model}
    if settings_json:
        data["settings_json"] = settings_json
    return client.post("/v1/voice/convert", files=files, data=data, headers=headers)


# ---------------------------------------------------------------- auth
def test_rejects_missing_key(client):
    assert client.get("/v1/capabilities").status_code == 401

def test_rejects_wrong_key(client):
    assert client.get("/v1/capabilities",
                      headers={"X-API-Key": "wrong"}).status_code == 401

def test_health_requires_no_auth(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["gpu_available"] is True


# ---------------------------------------------------------------- caps
def test_capabilities_shape(client):
    r = client.get("/v1/capabilities", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["voice_conversion"] is True
    assert body["model"] == "seed-vc"
    assert "wav" in body["output_audio_formats"]
    assert isinstance(body["gpu_available"], bool)
    assert body["max_duration"] > 0
    # no secrets or paths leaked
    assert "/models" not in r.text and "api_key" not in body


# ---------------------------------------------------------------- convert
def test_missing_reference_rejected(client):
    r = client.post("/v1/voice/convert",
                    files={"source": ("s.wav", io.BytesIO(b"x"), "audio/wav")},
                    data={"model": "seed-vc"}, headers=AUTH)
    assert r.status_code == 400
    assert "reference" in r.json()["detail"].lower()

def test_unsupported_model_rejected(client):
    r = post_convert(client, model="rvc")
    assert r.status_code == 400

def test_invalid_settings_json(client):
    r = post_convert(client, settings_json="{not json")
    assert r.status_code == 400

def test_successful_conversion_lifecycle(client):
    r = post_convert(client)
    assert r.status_code == 200
    job = r.json()
    assert job["status"] in ("queued", "preparing", "processing")
    # poll to completion
    for _ in range(100):
        job = client.get(f"/v1/voice/jobs/{job['job_id']}",
                         headers=AUTH).json()
        if job["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.05)
    assert job["status"] == "completed", job
    assert job["progress"] == 100.0
    assert job["result"]["output_format"] == "wav"

    res = client.get(f"/v1/voice/jobs/{job['job_id']}/result", headers=AUTH)
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert res.content  # real bytes

def test_engine_failure_fails_job(client, fake_pipeline):
    from app.audio_processing import AudioValidationError
    def failing_convert(*a, **k):
        raise AudioValidationError("conversion_failed", "Seed-VC conversion failed")
    orig = main_mod.seed_vc_engine.convert
    main_mod.seed_vc_engine.convert = failing_convert
    try:
        job = post_convert(client).json()
        for _ in range(100):
            job = client.get(f"/v1/voice/jobs/{job['job_id']}", headers=AUTH).json()
            if job["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)
        assert job["status"] == "failed"
        assert "failed" in (job["error"] or "")
    finally:
        main_mod.seed_vc_engine.convert = orig

def test_invalid_audio_fails_job(client, fake_pipeline):
    fake_pipeline.validate.fail = "invalid_audio"
    job = post_convert(client).json()
    for _ in range(100):
        job = client.get(f"/v1/voice/jobs/{job['job_id']}", headers=AUTH).json()
        if job["status"] in ("completed", "failed"):
            break
        time.sleep(0.05)
    assert job["status"] == "failed"
    assert "invalid_audio" in (job["error"] or "")

def test_engine_not_configured_returns_503(client, monkeypatch):
    def unavailable():
        from app.seed_vc_engine import SeedVCNotAvailable
        raise SeedVCNotAvailable("GPU inference unavailable")
    monkeypatch.setattr(main_mod.seed_vc_engine, "load", unavailable)
    r = post_convert(client)
    assert r.status_code == 503
    assert "unavailable" in r.json()["detail"]


# ---------------------------------------------------------------- jobs
def test_unknown_job_404(client):
    assert client.get("/v1/voice/jobs/nope", headers=AUTH).status_code == 404

def test_cancel_unknown_job_404(client):
    assert client.post("/v1/voice/jobs/nope/cancel", headers=AUTH).status_code == 404

def test_result_before_completion_409(client):
    job = post_convert(client).json()
    # job may already be done; if not yet, expect 409
    r = client.get(f"/v1/voice/jobs/{job['job_id']}/result", headers=AUTH)
    assert r.status_code in (200, 409)

def test_cancel_completed_job_409(client):
    job = post_convert(client).json()
    for _ in range(100):
        job = client.get(f"/v1/voice/jobs/{job['job_id']}", headers=AUTH).json()
        if job["status"] == "completed":
            break
        time.sleep(0.05)
    assert client.post(f"/v1/voice/jobs/{job['job_id']}/cancel",
                       headers=AUTH).status_code == 409

def test_cancel_queued_job(client, monkeypatch):
    # block the pipeline so we can cancel mid-flight
    import threading
    gate = threading.Event()
    def blocking_convert(*a, **k):
        gate.wait(timeout=10)
        return main_mod.seed_vc_engine.__class__.convert  # never reached
    monkeypatch.setattr(main_mod.seed_vc_engine, "convert", blocking_convert)
    job = post_convert(client).json()
    r = client.post(f"/v1/voice/jobs/{job['job_id']}/cancel", headers=AUTH)
    gate.set()
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


# ---------------------------------------------------------------- cleanup
def test_temp_cleanup_on_sweep(client, monkeypatch):
    job = post_convert(client).json()
    from app.temp_store import temp_store
    for _ in range(100):
        job = client.get(f"/v1/voice/jobs/{job['job_id']}", headers=AUTH).json()
        if job["status"] == "completed":
            break
        time.sleep(0.05)
    job_id = job["job_id"]
    assert temp_store.path_for(job_id) is not None
    # age the job then sweep
    with job_mod_lock():
        pass
    from app.job_manager import job_manager
    with job_manager._lock:
        job_manager._jobs[job_id]["created_at"] = (
            time.time() - settings.keep_completed_seconds - 1)
    job_manager.sweep()
    assert temp_store.path_for(job_id) is None
    assert job_id not in job_manager._jobs

def job_mod_lock():
    from app.job_manager import job_manager
    return job_manager._lock


def test_error_messages_strip_paths(client, fake_pipeline):
    from app.job_manager import _safe_message
    from app.audio_processing import AudioValidationError
    msg = _safe_message(AudioValidationError(
        "x", "failed reading /models/secret/checkpoint.pt"))
    assert "/models" not in msg
