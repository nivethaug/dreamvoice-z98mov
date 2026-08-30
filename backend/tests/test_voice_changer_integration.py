"""Voice Changer integration tests (mocked shared Voice API — no RunPod calls).

Run directly (no pytest in this environment):
    python3 tests/test_voice_changer_integration.py
"""
import asyncio
import os
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import _test_bootstrap  # noqa: F401  (installs bcrypt stub if needed)

PASS = []
FAIL = []


def check(name, fn):
    try:
        if asyncio.iscoroutinefunction(fn):
            asyncio.run(fn())
        else:
            fn()
        PASS.append(name)
        print(f"PASS  {name}")
    except Exception as e:
        FAIL.append((name, e))
        print(f"FAIL  {name}: {type(e).__name__}: {e}")


FAKE_KEY = "test-key-never-printed"


class FakeResp:
    def __init__(self, status=200, json_data=None, content=b"", headers=None):
        self.status_code = status
        self._json = json_data if json_data is not None else {}
        self.content = content
        self.headers = headers or {}
        self.text = ""

    def json(self):
        return self._json

    def read(self):
        return self.content


def setup_env(with_key=True):
    os.environ["VOICE_API_KEY"] = FAKE_KEY if with_key else ""
    os.environ["VOICE_CONVERSION_PROVIDER"] = "voiceapi"
    import importlib
    import core.config as cfg
    importlib.reload(cfg)
    import services.voice_conversion.voice_api_client as vac
    importlib.reload(vac)
    import services.storage.public_media as pm
    importlib.reload(pm)
    import services.voice_conversion.provider as prov
    importlib.reload(prov)
    import services.voice_conversion as svc_vc
    importlib.reload(svc_vc)
    if hasattr(svc_vc, "provider_status"):
        svc_vc.provider_status = prov.__dict__.get("provider_status", svc_vc.provider_status)
    import services.voice_conversion.engines.voice_api_engine as eng
    importlib.reload(eng)
    return vac, pm, prov, eng


def make_client(vac, status=200, json_data=None, content=b"", exc=None):
    calls = []

    async def fake_post(self, url, **kw):
        calls.append({"url": url, "headers": kw.get("headers"), "json": kw.get("json")})
        if exc:
            raise exc
        return FakeResp(status, json_data, content)

    async def fake_get(self, url, **kw):
        return FakeResp(200, {}, content)

    c = vac.VoiceApiClient(base_url="https://voice-api.test", api_key=FAKE_KEY)
    c._http = types.SimpleNamespace(post=fake_post.__get__(c), get=fake_get.__get__(c))
    c._calls = calls
    return c


GOOD_SOURCE = {"storage_key": "media/abc/source.mp3", "duration_seconds": 30.0,
               "is_video": False}
GOOD_VOICE = {"voice_id": "v1", "authorized": True,
              "reference_sample_url": "https://voice-api.test/ref.wav", "language": "ta"}


def patch_store_pm(pm, monkey=None):
    def fake_store(path, prefix, ext):
        return {"key": f"{prefix}/uuid.{ext}",
                "public_url": f"https://pub.test/{prefix}/uuid.{ext}"}

    pm.store_media = fake_store
    pm.delete_media = lambda key: None


def patch_ffmpeg(ff):
    ff.extract_audio = lambda src, dest=None: Path(str(src))
    ff.mux_video = lambda v, a, dest: Path(dest)
    ff.validate_audio_output = lambda path, expected: {
        "duration": expected, "sample_rate": 22050}


# ------------------------------------------------------------------- tests

def test_missing_key():
    vac, pm, prov, eng = setup_env(with_key=False)
    c = vac.get_voice_api_client()
    assert c.configured is False, "client must report unconfigured without key"
    e = eng.VoiceAPIVoiceConversionEngine(client=c)
    try:
        asyncio.run(e.validate(GOOD_SOURCE, None, GOOD_VOICE, {}))
    except Exception:
        return
    raise AssertionError("validate should fail when key missing")


def test_audio_happy_path():
    vac, pm, prov, eng = setup_env()
    patch_store_pm(pm)
    import services.audio.ffmpeg as ff
    patch_ffmpeg(ff)
    eng.validate_audio_output = lambda p, e: {"duration": e, "sample_rate": 22050}
    eng.mux_video = lambda v, a, dest: (Path(dest).write_bytes(b"MP4"), Path(dest))[1]
    eng.extract_audio = lambda src, dest=None: Path(str(src))
    import services.storage.object_store as os_mod

    class FakeStore:
        def download(self, key, dest):
            Path(dest).write_bytes(b"SRC")

        def upload(self, path, key):
            return {"key": key, "size": 3}

        def delete(self, key):
            pass

    os_mod.get_object_store = lambda: FakeStore()
    client = make_client(vac, 200, {"audio_url": "https://out.test/wav"}, b"WAVDATA")
    e = eng.VoiceAPIVoiceConversionEngine(client=client)
    result = asyncio.run(e.convert(
        "job1", GOOD_SOURCE, None, GOOD_VOICE,
        {"pitch": 2, "speed": 1.2, "stability": 0.5}, "wav"))
    assert result["status"] == "completed", result
    assert result["source_type"] == "audio"
    assert result["engine"] == "voiceapi"
    call = client._calls[0]
    assert "/v1/voice/convert" in call["url"]
    body = call["json"]
    assert body["source_language"] == "ta" and body["output_format"] == "wav"
    s = body["settings"]
    assert s.get("pitch_shift") == 2, s
    assert abs(s.get("length_adjust", 1) - 1.2) < 1e-6, s
    for fake in ("stability", "similarity", "style", "speed", "pitch"):
        assert fake not in s, f"{fake} must not be sent to Voice API"


def test_video_mux_path():
    vac, pm, prov, eng = setup_env()
    patch_store_pm(pm)
    import services.storage.object_store as os_mod

    class FakeStore:
        def download(self, key, dest):
            Path(dest).write_bytes(b"SRC")

        def upload(self, path, key):
            return {"key": key, "size": 3}

        def delete(self, key):
            pass

    os_mod.get_object_store = lambda: FakeStore()
    import services.audio.ffmpeg as ff
    mux_calls = []
    eng.validate_audio_output = lambda p, e: {"duration": e, "sample_rate": 44100}

    def fake_mux(v, a, dest):
        mux_calls.append(dest)
        Path(dest).write_bytes(b"MP4")
        return Path(dest)

    eng.extract_audio = lambda src, dest=None: Path(str(src))
    ff.mux_video = fake_mux
    eng.mux_video = fake_mux
    ff.validate_audio_output = lambda p, e: {"duration": e, "sample_rate": 44100}

    client = make_client(vac, 200, {"audio_url": "https://out.test/wav"}, b"WAVDATA")
    e = eng.VoiceAPIVoiceConversionEngine(client=client)
    src = dict(GOOD_SOURCE, is_video=True, storage_key="media/abc/src.mp4")
    result = asyncio.run(e.convert("job2", src, None, GOOD_VOICE, {}, "wav"))
    assert result["source_type"] == "video", result
    assert "video_url" in result, result
    assert len(mux_calls) == 1


def test_error_messages():
    vac, pm, prov, eng = setup_env()
    expected = vac.ERROR_MESSAGES
    for status in (400, 401, 413, 422, 429, 502, 504):
        client = make_client(vac, status, {"detail": "x"})
        try:
            asyncio.run(client.convert("https://s.test/a.wav",
                                       "https://t.test/r.wav", "ta"))
        except Exception as ex:
            assert str(ex) == expected[status], f"{status}: {ex}"
        else:
            raise AssertionError(f"{status} should raise")


def test_timeout_message():
    vac, pm, prov, eng = setup_env()
    client = make_client(vac, exc=TimeoutError("t"))
    try:
        asyncio.run(client.convert("https://s.test/a.wav",
                                   "https://t.test/r.wav", "ta"))
    except Exception as ex:
        assert "longer than expected" in str(ex), str(ex)
    else:
        raise AssertionError("timeout should raise")


def test_unauthorized_voice():
    vac, pm, prov, eng = setup_env()
    e = eng.VoiceAPIVoiceConversionEngine(client=make_client(vac))
    bad = dict(GOOD_VOICE, authorized=False)
    try:
        asyncio.run(e.validate(GOOD_SOURCE, None, bad, {}))
    except Exception as ex:
        assert "not available for real conversion" in str(ex), str(ex)
    else:
        raise AssertionError("unauthorized voice must be rejected")
    noref = {k: v for k, v in GOOD_VOICE.items() if k != "reference_sample_url"}
    try:
        asyncio.run(e.validate(GOOD_SOURCE, None, noref, {}))
    except Exception:
        return
    raise AssertionError("voice without reference must be rejected")


def test_source_over_30min():
    vac, pm, prov, eng = setup_env()
    e = eng.VoiceAPIVoiceConversionEngine(client=make_client(vac))
    long_src = dict(GOOD_SOURCE, duration_seconds=31 * 60)
    try:
        asyncio.run(e.validate(long_src, None, GOOD_VOICE, {}))
    except Exception as ex:
        assert "30 minute" in str(ex), str(ex)
    else:
        raise AssertionError("31-minute source must be rejected")


def test_reference_over_10min():
    vac, pm, prov, eng = setup_env()
    e = eng.VoiceAPIVoiceConversionEngine(client=make_client(vac))
    ref = dict(GOOD_VOICE, reference_duration_seconds=11 * 60)
    try:
        asyncio.run(e.validate(GOOD_SOURCE, None, ref, {}))
    except Exception as ex:
        assert "10 minute" in str(ex), str(ex)
    else:
        raise AssertionError("11-minute reference must be rejected")


def test_key_never_in_status():
    import json
    import services.voice_conversion as svc_vc
    vac, pm, prov, eng = setup_env()
    payload = json.dumps(svc_vc.provider_status())
    assert FAKE_KEY not in payload
    # also check engine result paths don't leak the key
    assert FAKE_KEY not in json.dumps(vac.ERROR_MESSAGES)


def test_bearer_header_set():
    vac, pm, prov, eng = setup_env()
    client = make_client(vac, 200, {"audio_url": "https://o/x.wav"}, b"WAV")
    try:
        asyncio.run(client.convert("https://s/a.wav", "https://t/r.wav", "ta"))
    except Exception:
        pass
    hdrs = client._calls[0]["headers"]
    assert hdrs.get("Authorization") == f"Bearer {FAKE_KEY}"
    assert hdrs.get("Content-Type") == "application/json"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            check(name, fn)
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    sys.exit(1 if FAIL else 0)
