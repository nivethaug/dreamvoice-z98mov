"""AI job models: voice jobs, TTS jobs, transcription jobs.

Jobs store status/progress/metadata in PostgreSQL; media artifacts live in
object storage (referenced by storage keys).
"""
from sqlalchemy import Column, Integer, String, Text, Float, DateTime, func, Index

from core.database import Base

JOB_STATES = ("queued", "preparing", "processing", "enhancing", "finalizing",
              "completed", "failed", "cancelled")


class VoiceJob(Base):
    __tablename__ = "voice_jobs"
    __table_args__ = (Index("ix_voice_jobs_user_status", "user_id", "status"),)

    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, index=True, nullable=False)
    project_id = Column(Integer, index=True)
    source_media_key = Column(String(1024))
    target_voice_id = Column(Integer, index=True)
    source_language = Column(String(8))   # ISO: ta, en, hi, te, ml, kn
    target_language = Column(String(8))
    provider = Column(String(50))
    model = Column(String(255))
    status = Column(String(32), default="queued", index=True)
    progress = Column(Float, default=0.0)
    stage = Column(String(64))
    error = Column(Text)
    result_storage_key = Column(String(1024))
    result_metadata = Column(Text)  # JSON blob
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TTSJob(Base):
    __tablename__ = "tts_jobs"

    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, index=True, nullable=False)
    voice_id = Column(Integer, index=True)
    text = Column(Text)
    language = Column(String(8))
    provider = Column(String(50))
    model = Column(String(255))
    status = Column(String(32), default="queued", index=True)
    progress = Column(Float, default=0.0)
    error = Column(Text)
    result_storage_key = Column(String(1024))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TranscriptionJob(Base):
    __tablename__ = "transcription_jobs"

    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, index=True, nullable=False)
    media_key = Column(String(1024))
    language = Column(String(8))
    provider = Column(String(50))
    model = Column(String(255))
    status = Column(String(32), default="queued", index=True)
    progress = Column(Float, default=0.0)
    error = Column(Text)
    transcript = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
