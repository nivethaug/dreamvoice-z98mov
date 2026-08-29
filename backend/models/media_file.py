"""Media file model - stores object-storage keys, never blobs."""
from sqlalchemy import Column, Integer, String, BigInteger, Float, DateTime, func

from core.database import Base


class MediaFile(Base):
    __tablename__ = "media_files"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    project_id = Column(Integer, index=True)
    kind = Column(String(20), nullable=False)  # original_audio|original_video|voice_sample|converted_audio|tts_output|processed_output|temporary
    storage_provider = Column(String(50), nullable=False, default="local")
    storage_key = Column(String(1024), nullable=False)
    original_filename = Column(String(512))
    mime_type = Column(String(255))
    size_bytes = Column(BigInteger, default=0)
    duration_seconds = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
