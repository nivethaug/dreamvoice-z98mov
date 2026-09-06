"""
User model for DreamPilot backend.
"""
from sqlalchemy import Boolean, Column, Integer, String
from core.database import Base


class User(Base):
    """User model."""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False, server_default="false")
    
    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}')>"
