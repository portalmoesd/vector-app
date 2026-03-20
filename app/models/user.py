from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import UserRole


class CountryAssignment(Base):
    __tablename__ = "country_assignments"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    country_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("countries.id", ondelete="CASCADE"), primary_key=True
    )

    country = relationship("Country")


class DeputySupervisorLink(Base):
    __tablename__ = "deputy_supervisor_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    deputy_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    supervisor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    deputy = relationship("User", foreign_keys=[deputy_id], back_populates="supervised_links")
    supervisor = relationship("User", foreign_keys=[supervisor_id])


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(nullable=False)
    department_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("departments.id"), nullable=True
    )
    is_external: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    department = relationship("Department", back_populates="users")
    country_assignments = relationship("CountryAssignment", cascade="all, delete-orphan")
    supervised_links = relationship(
        "DeputySupervisorLink", foreign_keys=[DeputySupervisorLink.deputy_id], back_populates="deputy"
    )
