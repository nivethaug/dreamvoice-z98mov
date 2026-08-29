"""RunPod serverless client for voice conversion (Seed-VC).

Flow (serverless, scale-to-zero friendly):
    DreamVoice -> POST /{endpoint_id}/run         -> RunPod job ID
    poll       -> GET  /{endpoint_id}/status/{id}
    fetch      -> GET  /{endpoint_id}/outputs/{id}
    cancel     -> POST /{endpoint_id}/cancel/{id}

API key (RUNPOD_API_KEY) stays backend-only. No GPU dependencies are
installed on the DreamVoice server — inference happens remotely.

Endpoints use the documented RunPod API:
    https://api.runpod.ai/v2/{endpoint_id}/run
"""
import logging
import time
from typing import Any, Dict, Optional

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

RUNPOD_BASE_URL = "https://api.runpod.ai/v2"
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class RunPodError(Exception):
    def __init__(self, message: str, status_code: int = 502, retryable: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


class RunPodClient:
    """Authenticated client for a RunPod serverless endpoint."""

    name = "runpod"

    def __init__(
        self,
        api_key: Optional[str] = None,
        endpoint_id: Optional[str] = None,
        timeout: float = 60.0,
    ):
        self._api_key = api_key or settings.RUNPOD_API_KEY
        self._endpoint_id = endpoint_id or settings.RUNPOD_VOICE_ENDPOINT_ID
        self._timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self._api_key and self._endpoint_id)

    def _url(self, suffix: str) -> str:
        if not self._api_key:
            raise RunPodError("RunPod is not configured (missing API key).", 503)
        if not self._endpoint_id:
            raise RunPodError("RunPod is not configured (missing endpoint ID).", 503)
        return f"{RUNPOD_BASE_URL}/{self._endpoint_id}{suffix}"

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        last: Optional[RunPodError] = None
        for _ in range(3):
            try:
                resp = httpx.request(
                    method, url, headers=self._headers(),
                    timeout=self._timeout, **kwargs
                )
            except httpx.TimeoutException:
                last = RunPodError("RunPod request timed out.", 504, retryable=True)
                continue
            except httpx.HTTPError:
                last = RunPodError("Could not reach RunPod.", 502, retryable=True)
                continue
            if resp.status_code < 400:
                return resp
            retryable = resp.status_code in RETRYABLE_STATUS
            last = RunPodError(
                f"RunPod error (HTTP {resp.status_code}).",
                resp.status_code if resp.status_code < 500 else 502,
                retryable,
            )
            if not retryable:
                raise last
        raise last or RunPodError("RunPod request failed.")

    # ---------------------------------------------------------- jobs
    def submit(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """POST /run — returns {"id": ..., "status": "IN_QUEUE"}."""
        resp = self._request("POST", self._url("/run"), json=payload)
        return resp.json()

    def status(self, job_id: str) -> Dict[str, Any]:
        resp = self._request("GET", self._url(f"/status/{job_id}"))
        return resp.json()

    def output(self, job_id: str) -> httpx.Response:
        return self._request("GET", self._url(f"/outputs/{job_id}"))

    def cancel(self, job_id: str) -> Dict[str, Any]:
        resp = self._request("POST", self._url(f"/cancel/{job_id}"))
        return resp.json()

    def health(self) -> Dict[str, Any]:
        resp = self._request("GET", self._url("/health"))
        return resp.json()

    # ---------------------------------------------------- convenience
    def wait_for_result(
        self,
        job_id: str,
        poll_interval: float = 2.0,
        max_wait: float = 600.0,
        should_cancel=None,
    ) -> Dict[str, Any]:
        """Poll until COMPLETED / FAILED / CANCELLED.

        `should_cancel` is an optional callable — when it returns True the
        worker stops waiting, cancels remotely, and raises a cancellation
        error so cancelled results are never treated as successful.
        """
        deadline = time.monotonic() + max_wait
        while time.monotonic() < deadline:
            if should_cancel is not None and should_cancel():
                try:
                    self.cancel(job_id)
                except Exception:
                    pass
                raise RunPodError("Job cancelled.", 499)
            snap = self.status(job_id)
            state = (snap.get("status") or "").upper()
            if state == "COMPLETED":
                return snap
            if state == "FAILED":
                raise RunPodError(
                    "Voice conversion provider failed.", 502, retryable=True
                )
            if state == "CANCELLED":
                raise RunPodError("Job cancelled.", 499)
            time.sleep(poll_interval)
        try:
            self.cancel(job_id)
        except Exception:
            pass
        raise RunPodError("Voice conversion timed out.", 504, retryable=True)
