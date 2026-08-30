"""
Database configuration for DreamPilot backend.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import settings

# Create engine
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()


def get_db():
    """Get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database tables (create_all + idempotent column additions)."""
    Base.metadata.create_all(bind=engine)
    # Idempotent migrations for columns added after initial deployment.
    from sqlalchemy import text
    migrations = (
        "ALTER TABLE voices ADD COLUMN IF NOT EXISTS rights_confirmed_at TIMESTAMPTZ",
        "ALTER TABLE voices ADD COLUMN IF NOT EXISTS reference_duration_seconds INTEGER",
    )
    try:
        with engine.begin() as conn:
            for stmt in migrations:
                conn.execute(text(stmt))
    except Exception as exc:  # noqa: BLE001 - startup migration is best-effort
        print(f"⚠️ startup migration skipped: {exc}")
