"""Direct behavior test for the worker without pytest/pydantic_settings.

Stubs pydantic_settings (config.py only needs a BaseSettings base class —
defaults come from os.environ.get at class-definition time).
"""
import io
import os
import sys
import types
import time
import uuid
import wave
import struct
import math

os.environ["VOICE_WORKER_API_KEY"] = "test-worker-key"
os.environ["WORKER_TEMP_DIR"] = "/tmp/seedvc-worker-test"

# Stub pydantic_settings before importing app.config
ps = types.ModuleType("pydantic_settings")
class BaseSettings:  # noqa
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)
ps.BaseSettings = BaseSettings
sys.modules["pydantic_settings"] = ps

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app import main as main_mod  # noqa: E402
from app.temp_store import temp_store  # noqa: E402
from app.job_manager import job_manager  # noqa: E402
from app.config import settings  # noqa: E402
from app.audio_processing import AudioValidationError  # noqa: E402
from app.seed_vc_engine import SeedVCNotAvailable  # noqa: E402

AUTH = {"X-API-Key": "test-worker-key"}
PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def make_wav(seconds=1.0, sr=16000, freq=220):
    n = int(seconds * sr)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / sr)))
            for i in range(n)))
    return buf.getvalue()


# Fake the ffmpeg + inference seams
main_mod.validate_audio = lambda path, max_duration: {
    "duration": 1.0, "sample_rate": 44100, "channels": 1}
main_mod.normalize_to_wav = lambda path, job_dir, target_sr=44100: path
main_mod.validate_output = lambda *a, **k: None
main_mod.seed_vc_engine._loaded = True
main_mod.seed_vc_engine._load_error = None
main_mod.seed_vc_engine.gpu_available = lambda: True
main_mod.seed_vc_engine.load = lambda: None
main_mod.seed_vc_engine.convert = (
    lambda source_wav, reference_wav, job_dir, settings_dict=None, progress_cb=None:
    (_ for _ in ()).throw(AudioValidationError("conversion_failed", "stub")))

# successful convert
def ok_convert(source_wav, reference_wav, job_dir, settings_dict=None, progress_cb=None):
    out = os.path.join(job_dir, f"converted_{uuid.uuid4().hex}.wav")
    with open(out, "wb") as f:
        f.write(make_wav(1.0, 44100))
    if progress_cb:
        progress_cb("processing", 60.0)
    return out


def post_convert(client, model="seed-vc", settings_json=None, headers=AUTH):
    files = {"source": ("s.wav", io.BytesIO(b"src"), "audio/wav"),
             "reference": ("r.wav", io.BytesIO(b"ref"), "audio/wav")}
    data = {"model": model}
    if settings_json:
        data["settings_json"] = settings_json
    return client.post("/v1/voice/convert", files=files, data=data, headers=headers)


def wait_done(client, job_id, tries=200):
    job = None
    for _ in range(tries):
        job = client.get(f"/v1/voice/jobs/{job_id}", headers=AUTH).json()
        if job["status"] in ("completed", "failed", "cancelled"):
            return job
        time.sleep(0.05)
    return job


with TestClient(app) as client:
    # auth
    check("401 without key", client.get("/v1/capabilities").status_code == 401)
    check("401 wrong key", client.get("/v1/capabilities", headers={"X-API-Key": "bad"}).status_code == 401)
    h = client.get("/health").json()
    check("health no-auth", client.get("/health").status_code == 200)
    check("health shape", h.get("gpu_available") is True and "status" in h, str(h))

    caps = client.get("/v1/capabilities", headers=AUTH).json()
    check("capabilities", caps.get("voice_conversion") is True and caps.get("model") == "seed-vc"
          and caps.get("gpu_available") is True and caps.get("max_duration") > 0
          and "wav" in caps.get("output_audio_formats", []), str(caps))
    check("no paths in caps", "/models" not in str(caps) and "api_key" not in str(caps))

    # invalid requests
    r = client.post("/v1/voice/convert",
                    files={"source": ("s.wav", io.BytesIO(b"x"), "audio/wav")},
                    data={"model": "seed-vc"}, headers=AUTH)
    check("missing reference 400", r.status_code == 400 and "reference" in r.json()["detail"].lower(), r.text)
    check("bad model 400", post_convert(client, model="rvc").status_code == 400)
    check("bad settings json 400", post_convert(client, settings_json="{oops").status_code == 400)

    # engine unavailable -> 503
    orig_load = main_mod.seed_vc_engine.load
    main_mod.seed_vc_engine.load = lambda: (_ for _ in ()).throw(
        SeedVCNotAvailable("GPU inference unavailable"))
    r = post_convert(client)
    check("engine unavailable 503", r.status_code == 503 and "unavailable" in r.json()["detail"], r.text)
    main_mod.seed_vc_engine.load = orig_load

    # success lifecycle
    main_mod.seed_vc_engine.convert = ok_convert
    job = post_convert(client).json()
    check("convert accepted", "job_id" in job and job["status"] in
          ("queued", "preparing", "processing"), str(job))
    job = wait_done(client, job["job_id"])
    check("completed 100%", job["status"] == "completed" and job["progress"] == 100.0, str(job))
    res = client.get(f"/v1/voice/jobs/{job['job_id']}/result", headers=AUTH)
    check("result wav", res.status_code == 200 and res.headers["content-type"] == "audio/wav" and res.content)
    check("cancel completed 409", client.post(f"/v1/voice/jobs/{job['job_id']}/cancel", headers=AUTH).status_code == 409)

    # engine failure
    def failing(*a, **k):
        raise AudioValidationError("conversion_failed", "Seed-VC conversion failed")
    main_mod.seed_vc_engine.convert = failing
    job = wait_done(client, post_convert(client).json()["job_id"])
    check("failure state", job["status"] == "failed" and "conversion_failed" in (job["error"] or ""), str(job))
    main_mod.seed_vc_engine.convert = ok_convert

    # unknown jobs
    check("unknown job 404", client.get("/v1/voice/jobs/nope", headers=AUTH).status_code == 404)
    check("unknown cancel 404", client.post("/v1/voice/jobs/nope/cancel", headers=AUTH).status_code == 404)

    # cancellation mid-flight
    import threading
    gate = threading.Event()
    def blocking(*a, **k):
        gate.wait(timeout=15)
        return ok_convert(*a, **k)
    main_mod.seed_vc_engine.convert = blocking
    jid = post_convert(client).json()["job_id"]
    r = client.post(f"/v1/voice/jobs/{jid}/cancel", headers=AUTH)
    gate.set()
    check("cancel 200", r.status_code == 200 and r.json()["status"] == "cancelled", r.text)
    job = wait_done(client, jid)
    check("cancelled not success", job["status"] == "cancelled", str(job))
    check("no result for cancelled", client.get(f"/v1/voice/jobs/{jid}/result", headers=AUTH).status_code == 409)

    # cleanup sweep
    main_mod.seed_vc_engine.convert = ok_convert
    jid = post_convert(client).json()["job_id"]
    wait_done(client, jid)
    check("temp dir exists", temp_store.path_for(jid) is not None)
    with job_manager._lock:
        job_manager._jobs[jid]["created_at"] = time.time() - settings.keep_completed_seconds - 1
    job_manager.sweep()
    check("sweep cleans temp", temp_store.path_for(jid) is None and jid not in job_manager._jobs)

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
