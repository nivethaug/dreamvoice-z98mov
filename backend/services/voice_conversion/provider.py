"""Voice conversion provider configuration.

All provider configuration comes from backend environment variables.
Secrets are never exposed to the frontend or logged.

Supported providers (VOICE_CONVERSION_PROVIDER):
  mock       - simulated pipeline (Step 4A; used ONLY when explicitly configured)
  openrouter - OpenRouter gateway (requires OPENROUTER_API_KEY)
  remote     - generic remote Seed-VC / GPU inference endpoint
              (VOICE_CONVERSION_API_URL, VOICE_CONVERSION_API_KEY,
               VOICE_CONVERSION_MODEL)
"""
import os


PROVIDER_MOCK = "mock"
PROVIDER_OPENROUTER = "openrouter"
PROVIDER_REMOTE = "remote"
VALID_PROVIDERS = {PROVIDER_MOCK, PROVIDER_OPENROUTER, PROVIDER_REMOTE}


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
            and self.provider in (PROVIDER_OPENROUTER, PROVIDER_REMOTE),
            "error": error,
        }


def load_provider_settings() -> ProviderSettings:
    return ProviderSettings()
