"""Voice library models (voices + voice samples).

Voices reference object-storage keys for their authorized reference samples.
No embeddings or audio blobs are stored in PostgreSQL.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, func

from core.database import Base


class Voice(Base):
    __tablename__ = "voices"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    languages = Column(String(255))  # comma-separated ISO codes: "ta,en"
    voice_type = Column(String(50))  # personal|professional|narrator|character|other|ai
    sample_storage_key = Column(String(1024))  # authorized reference sample
    authorization_status = Column(String(50), default="pending")  # pending|confirmed|revoked
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class VoiceSample(Base):
    __tablename__ = "voice_samples"

    id = Column(Integer, primary_key=True, index=True)
    voice_id = Column(Integer, index=True, nullable=False)
    user_id = Column(Integer, index=True, nullable=False)
    storage_key = Column(String(1024), nullable=False)
    original_filename = Column(String(512))
    mime_type = Column(String(255))
    size_bytes = Column(Integer, default=0)
    duration_seconds = Column(Integer)
    quality = Column(String(50))  # good|needs_improvement|poor
    created_at = Column(DateTime(timezone=True), server_default=func.now())
