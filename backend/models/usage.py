"""Usage tracking models: usage records + provider settings."""
from sqlalchemy import Column, Integer, String, Float, DateTime, func, Text

from core.database import Base

OPERATIONS = ("VOICE_CONVERSION", "TTS", "STT", "LLM")


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    job_id = Column(String(64), index=True)
    provider = Column(String(50), nullable=False)
    model = Column(String(255))
    operation = Column(String(32), index=True, nullable=False)  # VOICE_CONVERSION|TTS|STT|LLM
    input_duration = Column(Float)   # seconds
    output_duration = Column(Float)  # seconds
    compute_seconds = Column(Float)
    provider_cost = Column(Float)
    status = Column(String(32), default="completed")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ProviderSetting(Base):
    """Server-side provider configuration overrides (admin-managed).

    Credentials stay in environment variables; this table may hold
    non-secret routing preferences per user in the future.
    """
    __tablename__ = "provider_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=True)  # NULL = global
    operation = Column(String(32), nullable=False)  # VOICE_CONVERSION|TTS|STT|LLM
    provider = Column(String(50), nullable=False)
    model = Column(String(255))
    config_json = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
