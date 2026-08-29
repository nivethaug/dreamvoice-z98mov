# Seed-VC GPU Worker

Isolated remote inference worker for DreamVoice voice conversion. Completely
separate from the DreamVoice application server — this service runs on a
CUDA-capable GPU host and exposes a small authenticated HTTPS API.

```
DreamVoice Backend ──HTTPS──> Seed-VC GPU Worker ──> Converted WAV ──> DreamVoice Backend
```

The application backend connects to this worker via the existing
`RemoteVoiceConversionEngine` (set `VOICE_CONVERSION_PROVIDER=remote`,
`VOICE_CONVERSION_API_URL`, `VOICE_CONVERSION_API_KEY=VOICE_WORKER_API_KEY`,
`VOICE_CONVERSION_MODEL=seed-vc`).

## 1. GPU requirements
- NVIDIA GPU with ≥ 8 GB VRAM (16 GB recommended for long clips)
- Working NVIDIA driver

## 2. CUDA requirement
- CUDA 11.8+ runtime (installed automatically by the PyTorch wheel matching
  your driver; see install step below). **Not required on the app server** —
  only on this worker host.

## 3. Python version
- Python **3.10** (Seed-VC dependency chain; 3.11 usually works too)

## 4. Packages
```bash
python3.10 -m venv venv && source venv/bin/activate
# PyTorch with CUDA — pick the wheel for your CUDA version, e.g. cu121:
pip install torch==2.3.1 torchaudio==2.3.1 --index-url https://download.pytorch.org/whl/cu121
# Seed-VC dependencies (install from the cloned repo, step 5)
pip install -r requirements.txt
```
FFmpeg must be on PATH (`apt install ffmpeg`).

## 5. Model / checkpoint download
```bash
git clone https://github.com/Plachtaa/seed-vc /models/seed-vc
cd /models/seed-vc && pip install -r requirements.txt
# Checkpoints are downloaded automatically by seed-vc on first inference into
# its checkpoints/ directory; you may also pre-download seed-vc-v2 manually.
```

## 6. Environment variables
| Variable | Purpose | Default |
|---|---|---|
| `VOICE_WORKER_API_KEY` | **Required.** Shared secret between backend and worker | (none → auth disabled with 503) |
| `SEED_VC_MODEL_PATH` | Path to cloned seed-vc repo | `/models/seed-vc` |
| `SEED_VC_CHECKPOINT` | Checkpoint file | `/models/seed-vc/checkpoints/seed-vc-v2/seed-vc-v2.pt` |
| `SEED_VC_DEVICE` | `cuda` or `cpu` | `cuda` |
| `WORKER_TEMP_DIR` | Temp root for per-job dirs | `/tmp/seedvc-worker` |
| `MAX_DURATION_SECONDS` | Max source audio length | `1800` |
| `MAX_UPLOAD_MB` | Upload size cap | `500` |
| `JOB_TIMEOUT_SECONDS` | Per-job inference timeout | `900` |
| `KEEP_COMPLETED_SECONDS` | Result retention before cleanup | `900` |
| `ALLOW_CPU_FALLBACK` | Allow CPU inference (slow; off by default) | `false` |

## 7. Startup command
```bash
source venv/bin/activate
VOICE_WORKER_API_KEY=<secret> \
SEED_VC_MODEL_PATH=/models/seed-vc \
SEED_VC_CHECKPOINT=/models/seed-vc/checkpoints/seed-vc-v2/seed-vc-v2.pt \
uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Put it behind an HTTPS reverse proxy (nginx/Caddy) before use in production.

## 8. API endpoints
- `GET /health` — no auth; `status`, `gpu_available`, `engine_ready`
- `GET /v1/capabilities` — voice_conversion=true, model=seed-vc, formats, max_duration, gpu_available
- `POST /v1/voice/convert` — multipart: `source` (audio file), `reference`
  (target voice sample), `model=seed-vc`, optional `settings_json`
  (`{"diffusion_steps":30,"length_adjust":1.0,"inference_cfg_rate":0.7}`).
  Returns `{job_id, status, ...}` immediately (async design).
- `GET /v1/voice/jobs/{job_id}` — status: queued/preparing/processing/completed/failed/cancelled + progress
- `GET /v1/voice/jobs/{job_id}/result` — downloads `converted_audio.wav`
- `POST /v1/voice/jobs/{job_id}/cancel` — cancels; 409 if already finished

## 9. Authentication
`X-API-Key` header must equal `VOICE_WORKER_API_KEY` (401 otherwise). The key
lives only in backend/worker env — never in browser code. Without the env var
the worker returns 503 "not configured". Uploaded filenames are sanitized;
every job gets its own temp dir, deleted after completion/failure/cancel/sweep.

## 10. Health check
```bash
curl http://<worker-host>:8000/health
# {"status":"ok","gpu_available":true,"engine_ready":true}
```

## Tests
```bash
pip install -r requirements.txt && pip install pytest httpx
python -m pytest tests/test_worker.py -v      # no GPU needed, mocked engine
# Real-model integration test (GPU host, checkpoint present):
SEED_VC_RUN_INTEGRATION=1 python -m pytest tests/test_integration_real_seedvc.py -v
```

## Status — honest report
- Seed-VC is **not installed** in this workspace and **no GPU is present here**
- The worker code, API, auth, validation, temp cleanup, and mocked tests are complete
- **Real conversion has NOT been executed** — deploy to a GPU host, download the
  checkpoint, then run the integration test before enabling production traffic
