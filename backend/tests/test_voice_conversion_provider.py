"""Voice conversion provider tests (no real AI provider required).

Run:  python3 tests/test_voice_conversion_provider.py
"""
import asyncio
import os
import sys
import tempfile
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Stub optional deps that are unrelated to voice conversion (bcrypt is only
# needed by auth_service, which we never exercise here).
if "bcrypt" not in sys.modules:
    _bcrypt = types.ModuleType("bcrypt")
    _bcrypt.checkpw = lambda a, b: True
    _bcrypt.hashpw = lambda a, b: a
    _bcrypt.gensalt = lambda: b"x"
    sys.modules["bcrypt"] = _bcrypt

PASS = 0
FAIL = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {name}")
    else:
        FAIL += 1
        print(f" FAIL {name}")


def set_env(**kv):
    for k in (
        "VOICE_CONVERSION_PROVIDER",
        "VOICE_CONVERSION_API_URL",
        "VOICE_CONVERSION_API_KEY",
        "VOICE_CONVERSION_MODEL",
        "OPENROUTER_API_KEY",
        "OPENROUTER_MODEL",
    ):
        os.environ.pop(k, None)
    for k, v in kv.items():
        os.environ[k] = v


async def main():
    # ---------------- provider configuration validation ----------------
    from services.voice_conversion.provider import (
        ProviderConfigError,
        ProviderNotConfiguredError,
        ProviderSettings,
        load_provider_settings,
    )

    set_env()
    s = load_provider_settings()
    try:
        s.validate()
        check("validate raises when unconfigured", False)
    except ProviderNotConfiguredError:
        check("validate raises when unconfigured", True)

    set_env(VOICE_CONVERSION_PROVIDER="bogus")
    try:
        load_provider_settings().validate()
        check("invalid provider rejected", False)
    except ProviderConfigError:
        check("invalid provider rejected", True)

    set_env(VOICE_CONVERSION_PROVIDER="openrouter")  # missing OPENROUTER_API_KEY
    try:
        load_provider_settings().validate()
        check("openrouter missing API key rejected", False)
    except (ProviderNotConfiguredError, ProviderConfigError):
        check("openrouter missing API key rejected", True)

    set_env(VOICE_CONVERSION_PROVIDER="openrouter", OPENROUTER_API_KEY="sk-test")
    st = load_provider_settings().validate() or load_provider_settings()
    st2 = load_provider_settings()
    check("openrouter valid config OK", st2.provider == "openrouter")
    status = st2.status()
    check("status exposes no secrets", "sk-test" not in str(status) and status.get("configured") is True)

    set_env(VOICE_CONVERSION_PROVIDER="remote", OPENROUTER_API_KEY="")
    try:
        load_provider_settings().validate()
        check("remote missing api url rejected", False)
    except (ProviderNotConfiguredError, ProviderConfigError):
        check("remote missing api url rejected", True)

    set_env(
        VOICE_CONVERSION_PROVIDER="remote",
        VOICE_CONVERSION_API_URL="https://vc.example.com",
        VOICE_CONVERSION_API_KEY="secret-key",
        VOICE_CONVERSION_MODEL="seed-vc",
    )
    st = load_provider_settings()
    check("remote valid config OK", st.provider == "remote")
    check("remote status hides key", "secret-key" not in str(st.status()))

    # ---------------- engine factory ----------------
    from services.voice_conversion.job_manager import (
        JobNotCancellableError,
        JobNotFoundError,
        VoiceConversionJobManager,
        build_engine_from_provider,
    )
    from services.voice_conversion.engines.remote_engine import RemoteVoiceConversionEngine
    from services.voice_conversion.engines.openrouter_engine import OpenRouterVoiceEngine

    eng = build_engine_from_provider()
    check("remote engine selected", isinstance(eng, RemoteVoiceConversionEngine))

    set_env(VOICE_CONVERSION_PROVIDER="openrouter", OPENROUTER_API_KEY="sk-test", OPENROUTER_MODEL="x/y")
    check("openrouter engine selected", isinstance(build_engine_from_provider(), OpenRouterVoiceEngine))

    set_env(VOICE_CONVERSION_PROVIDER="mock")
    from services.voice_conversion.engines.mock_engine import MockVoiceConversionEngine
    check("mock engine only when explicit", isinstance(build_engine_from_provider(), MockVoiceConversionEngine))

    # ---------------- job manager: not configured ----------------
    set_env()
    jm = VoiceConversionJobManager()
    payload = {
        "source_media": {"url": "http://x/v.mp4", "type": "video"},
        "target_voice": {"voice_id": "v1", "voice_name": "My Voice"},
        "settings": {},
    }
    try:
        await jm.create_job(payload)
        check("job creation fails cleanly when unconfigured", False)
    except ProviderNotConfiguredError as exc:
        check("job creation fails cleanly when unconfigured", "not configured" in str(exc).lower())

    # ---------------- openrouter engine: honest capability refusal ----------------
    set_env(VOICE_CONVERSION_PROVIDER="openrouter", OPENROUTER_API_KEY="sk-test", OPENROUTER_MODEL="openai/gpt-4o")
    from services.voice_conversion.engines.base import EngineValidationError
    ore = build_engine_from_provider()

    class FakeResp:
        def __init__(self, status, data):
            self.status = status
            self._data = data
        async def json(self):
            return self._data
        def raise_for_status(self):
            if self.status >= 400:
                import httpx
                raise httpx.HTTPStatusError("err", request=None, response=None)

    class FakeClient:
        def __init__(self, resp=None, exc=None):
            self.resp = resp
            self.exc = exc
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, *a, **k):
            if self.exc:
                raise self.exc
            return self.resp

    # stub the catalog lookup at the client seam
    from services.voice_conversion.engines.base import EngineError
    async def fake_support(model_id):
        return {
            "supported": False,
            "reason": f"Model '{model_id}' does not support audio-to-audio voice conversion (requires audio input AND audio output).",
        }
    ore._client.verify_voice_conversion_support = fake_support
    try:
        await ore.validate({"file_url": "http://x/v.mp4"}, None, {"voice_id": "v1"}, {})
        check("text model rejected as VC capable", False)
    except EngineError as e:
        check("text model rejected as VC capable", "audio-to-audio" in str(e).lower())
    except EngineValidationError:
        check("text model rejected as VC capable", True)

    # unsupported capability surfaces as clean EngineError from convert too
    async def run_convert():
        return await ore.convert(job_id="j0", source_media={"file_url": "http://x/v.mp4"},
                                 source_audio=None, target_voice={"voice_id": "v1"},
                                 settings={}, output_format="wav")
    try:
        await run_convert()
        check("convert refuses non-audio-to-audio model", False)
    except EngineError:
        check("convert refuses non-audio-to-audio model", True)

    # ---------------- remote engine: request, success, failure, output validation ----------------
    set_env(
        VOICE_CONVERSION_PROVIDER="remote",
        VOICE_CONVERSION_API_URL="https://vc.example.com",
        VOICE_CONVERSION_API_KEY="k",
        VOICE_CONVERSION_MODEL="seed-vc",
    )
    rem = build_engine_from_provider()

    # invalid target voice (no reference from user's library)
    try:
        await rem.validate(None, None, {}, {})
        check("invalid target voice rejected", False)
    except EngineValidationError:
        check("invalid target voice rejected", True)

    tmp = Path(tempfile.mkdtemp())
    src = tmp / "src.wav"; src.write_bytes(b"RIFF" + b"\x00" * 1000)
    ref = tmp / "ref.wav"; ref.write_bytes(b"RIFF" + b"\x00" * 1000)

    # missing source audio -> validation error
    try:
        await rem.validate(None, {"path": str(tmp / "nope.wav")}, {"reference_path": str(ref), "voice_id": "v1"}, {})
        check("missing source audio rejected", False)
    except EngineValidationError:
        check("missing source audio rejected", True)

    ok_source = {"file_url": "https://cdn.example.com/src.wav", "duration_seconds": 5.0}
    ok_voice = {"voice_id": "v1", "voice_name": "My Voice",
                "reference_sample_url": "https://cdn.example.com/ref.wav"}
    await rem.validate(ok_source, None, ok_voice, {})  # should pass locally
    check("valid remote request accepted", True)
    try:
        await rem.validate(ok_source, None, {"voice_id": "v1"}, {})
        check("reference must be authorized sample url", False)
    except EngineValidationError:
        check("reference must be authorized sample url", True)

    # provider failure -> EngineError, no secrets leaked
    from services.voice_conversion.engines.base import EngineError
    async def fail_fetch(self, url, label):
        raise EngineError(f"Could not download {label} audio.")
    rem._fetch_bytes = types.MethodType(fail_fetch, rem)
    try:
        await rem.convert(job_id="j1", source_media=ok_source, source_audio=None,
                          target_voice=ok_voice, settings={}, output_format="wav",
                          progress_callback=lambda *a: None)
        check("provider failure raises EngineError", False)
    except EngineError as e:
        check("provider failure raises EngineError", "secret-key" not in str(e) and "vc.example.com" not in str(e))

    # success path with mocked download + provider response + temp store
    good_bytes = b"RIFF" + b"\x00" * 5000
    rem2 = build_engine_from_provider()
    async def ok_fetch(self, url, label):
        return ("audio", f"{label}.wav", good_bytes, "audio/wav")
    rem2._fetch_bytes = types.MethodType(ok_fetch, rem2)
    async def ok_request(self, files, output_format, job_id):
        return good_bytes
    rem2._request_conversion = types.MethodType(ok_request, rem2)
    result = await rem2.convert(job_id="j2", source_media=ok_source, source_audio=None,
                                target_voice=ok_voice, settings={}, output_format="wav",
                                progress_callback=lambda *a: None)
    check("successful conversion returns metadata", result.get("output_file") and result.get("size_bytes", 0) > 0)
    check("result keeps lossless wav", str(result.get("output_file", "")).endswith(".wav"))
    # temp artifact registered for auto-cleanup
    from services.voice_conversion import temp_store
    found = [p for p in temp_store._files if p.endswith(result["output_file"])]
    check("temp output registered for cleanup", len(found) == 1)

    # empty output -> EngineError
    rem3 = build_engine_from_provider()
    rem3._fetch_bytes = types.MethodType(ok_fetch, rem3)
    async def empty_req(self, files, output_format, job_id):
        return b""
    rem3._request_conversion = types.MethodType(empty_req, rem3)
    try:
        await rem3.convert(job_id="j3", source_media=ok_source, source_audio=None,
                           target_voice=ok_voice, settings={}, output_format="wav",
                           progress_callback=lambda *a: None)
        check("empty provider output rejected", False)
    except EngineError:
        check("empty provider output rejected", True)

    # corrupted output (tiny file) -> EngineError
    rem4 = build_engine_from_provider()
    rem4._fetch_bytes = types.MethodType(ok_fetch, rem4)
    async def tiny_req(self, files, output_format, job_id):
        return b"xx"
    rem4._request_conversion = types.MethodType(tiny_req, rem4)
    try:
        await rem4.convert(job_id="j4", source_media=ok_source, source_audio=None,
                           target_voice=ok_voice, settings={}, output_format="wav",
                           progress_callback=lambda *a: None)
        check("corrupted tiny output rejected", False)
    except EngineError:
        check("corrupted tiny output rejected", True)

    # cleanup registered temp files from this test run
    removed = 0
    for p in list(temp_store._files):
        temp_store.remove_temp_file(p)
        removed += 1
    check("temp files cleaned up on demand", removed > 0 and temp_store.tracked_files() == 0)

    # ---------------- full job lifecycle with mock engine ----------------
    set_env(VOICE_CONVERSION_PROVIDER="mock")
    jm2 = VoiceConversionJobManager()
    job = await jm2.create_job(payload)
    check("job created queued/201 shape", job["state"] == "queued" and job["job_id"])
    await asyncio.sleep(0.3)
    running = jm2.get_job(job["job_id"])
    check("job progresses through stages", running["state"] in ("preparing", "processing", "enhancing", "finalizing", "completed"))
    # mock engine simulates ~6s of work; wait beyond that
    for _ in range(80):
        await asyncio.sleep(0.1)
        done = jm2.get_job(job["job_id"])
        if done["state"] in ("completed", "failed"):
            break
    check("job completes at 100%", done["state"] == "completed" and done["progress"] == 100)

    # cancellation mid-flight
    job2 = await jm2.create_job(payload)
    await asyncio.sleep(0.2)
    cancelled = await jm2.cancel_job(job2["job_id"])
    check("cancel mid-flight works", cancelled["state"] == "cancelled")
    try:
        await jm2.cancel_job(job2["job_id"])
        check("double cancel rejected", False)
    except JobNotCancellableError:
        check("double cancel rejected", True)
    try:
        jm2.get_job("does-not-exist")
        check("unknown job 404", False)
    except JobNotFoundError:
        check("unknown job 404", True)

    # ---------------- temp store cleanup ----------------
    from services.voice_conversion import temp_store
    f = tmp / "tmp_artifact.wav"; f.write_bytes(b"x" * 10)
    temp_store.register_temp_file(str(f))
    check("registered in temp store", str(f) in temp_store._files)
    temp_store.remove_temp_file(str(f))
    check("temp file removed", not f.exists() and str(f) not in temp_store._files)

    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    asyncio.run(main())
