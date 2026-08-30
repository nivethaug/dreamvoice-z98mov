"""Voice conversion provider configuration.

All provider configuration comes from backend environment variables.
Secrets are never exposed to the frontend or logged.

Supported providers (VOICE_CONVERSION_PROVIDER):
  mock       - simulated pipeline (development/testing ONLY; must be
               explicitly configured — never a silent fallback)
  openrouter - capability-checked gateway (will refuse if no true
               audio-to-audio model is available)
  remote     - generic remote Seed-VC / GPU inference endpoint
              (VOICE_CONVERSION_API_URL, VOICE_CONVERSION_API_KEY,
               VOICE_CONVERSION_MODEL)
  runpod     - RunPod serverless GPU inference (production path)
              (RUNPOD_API_KEY, RUNPOD_VOICE_ENDPOINT_ID,
               RUNPOD_VOICE_MODEL)
"""
import os

try:
    from pathlib import Path as _P

    from dotenv import load_dotenv as _ld

    for _candidate in (
        _P(__file__).resolve().parent.parent / ".env",   # backend/.env
        _P(__file__).resolve().parent / ".env",
        _P.cwd() / ".env",
    ):
        if _candidate.is_file():
            _ld(dotenv_path=str(_candidate))
            break
except ImportError:  # dotenv optional
    pass


PROVIDER_MOCK = "mock"
PROVIDER_OPENROUTER = "openrouter"
PROVIDER_REMOTE = "remote"
PROVIDER_RUNPOD = "runpod"
PROVIDER_VOICEAPI = "voiceapi"
VALID_PROVIDERS = {
    PROVIDER_MOCK,
    PROVIDER_OPENROUTER,
    PROVIDER_REMOTE,
    PROVIDER_RUNPOD,
    PROVIDER_VOICEAPI,
}


class ProviderNotConfiguredError(Exception):
    """Raised when the selected provider lacks required configuration."""

    def __init__(self, message: str, missing: list):
        self.missing = missing
        super().__init__(message)


class ProviderConfigError(Exception):
    """Raised when the provider configuration itself is invalid."""


def _get(name: str) -> str:
    return (os.getenv(name) or "").strip()


class ProviderSettings:
    """Snapshot of provider-related environment configuration."""

    def __init__(self):
        self.provider = (_get("VOICE_CONVERSION_PROVIDER") or "").lower()
        self.openrouter_api_key = _get("OPENROUTER_API_KEY")
        self.openrouter_model = _get("OPENROUTER_MODEL")
        self.remote_api_url = _get("VOICE_CONVERSION_API_URL")
        self.remote_api_key = _get("VOICE_CONVERSION_API_KEY")
        self.remote_model = _get("VOICE_CONVERSION_MODEL") or "seed-vc"
        self.runpod_api_key = _get("RUNPOD_API_KEY")
        self.runpod_endpoint_id = _get("RUNPOD_VOICE_ENDPOINT_ID")
        self.runpod_model = _get("RUNPOD_VOICE_MODEL") or "seed-vc"
        self.voice_api_key = _get("VOICE_API_KEY")
        if not self.provider and self.voice_api_key:
            # Default to the shared Voice API (real Seed-VC) whenever its
            # key is configured — production never silently uses mock.
            self.provider = PROVIDER_VOICEAPI

    # -- capability checks --------------------------------------------------

    def missing_fields(self) -> list:
        """Required-but-missing environment variables for the provider."""
        if not self.provider:
            return ["VOICE_CONVERSION_PROVIDER"]
        if self.provider == PROVIDER_OPENROUTER:
            missing = []
            if not self.openrouter_api_key:
                missing.append("OPENROUTER_API_KEY")
            return missing  # model optional; engine verifies capability
        if self.provider == PROVIDER_REMOTE:
            missing = []
            if not self.remote_api_url:
                missing.append("VOICE_CONVERSION_API_URL")
            if not self.remote_api_key:
                missing.append("VOICE_CONVERSION_API_KEY")
            return missing
        if self.provider == PROVIDER_RUNPOD:
            missing = []
            if not self.runpod_api_key:
                missing.append("RUNPOD_API_KEY")
            return missing
        if self.provider == PROVIDER_VOICEAPI:
            missing = []
            if not self.voice_api_key:
                missing.append("VOICE_API_KEY")
            return missing
        return []

    def validate(self) -> None:
        if not self.provider:
            raise ProviderNotConfiguredError(
                "Voice conversion is not configured yet.", ["VOICE_CONVERSION_PROVIDER"]
            )
        if self.provider not in VALID_PROVIDERS:
            raise ProviderConfigError(
                f"Invalid VOICE_CONVERSION_PROVIDER '{self.provider}'. "
                f"Valid: {', '.join(sorted(VALID_PROVIDERS))}."
            )
        missing = self.missing_fields()
        if missing:
            raise ProviderNotConfiguredError(
                "Voice conversion provider is not configured yet.", missing
            )
        if self.provider == PROVIDER_MOCK:
            env = (_get("ENVIRONMENT") or "development").lower()
            if env not in ("development", "test", "testing"):
                raise ProviderConfigError(
                    "Mock voice-conversion engine is not allowed outside "
                    "development/test environments."
                )

    def status(self) -> dict:
        """Safe public status - booleans only, never secret values."""
        try:
            self.validate()
            configured = True
            error = None
        except (ProviderNotConfiguredError, ProviderConfigError) as exc:
            configured = False
            error = str(exc)
        return {
            "configured": configured,
            "provider": self.provider or None,
            "real_conversion_available": configured
            and self.provider
            in (PROVIDER_OPENROUTER, PROVIDER_REMOTE, PROVIDER_RUNPOD,
                PROVIDER_VOICEAPI),
            "error": error,
        }


def load_provider_settings() -> ProviderSettings:
    return ProviderSettings()
