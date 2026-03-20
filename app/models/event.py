from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import DocumentSubmitterRole, EventStatus, SectionStatus, WorkflowStepStatus


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    country_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("countries.id"), nullable=False
    )
    document_submitter_role: Mapped[DocumentSubmitterRole] = mapped_column(nullable=False)
    document_submitter_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    deputy_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    curator_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[EventStatus] = mapped_column(default=EventStatus.DRAFT, nullable=False)
    created_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    country = relationship("Country")
    document_submitter = relationship("User", foreign_keys=[document_submitter_id])
    deputy = relationship("User", foreign_keys=[deputy_id])
    created_by = relationship("User", foreign_keys=[created_by_id])
    sections = relationship("Section", back_populates="event", cascade="all, delete-orphan")


class SectionDepartment(Base):
    __tablename__ = "section_departments"

    section_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sections.id", ondelete="CASCADE"), primary_key=True
    )
    department_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True
    )

    department = relationship("Department")


class Section(Base):
    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[SectionStatus] = mapped_column(default=SectionStatus.PENDING, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    event = relationship("Event", back_populates="sections")
    departments = relationship("SectionDepartment", cascade="all, delete-orphan")
    workflow_steps = relationship(
        "WorkflowStep", back_populates="section", cascade="all, delete-orphan",
        order_by="WorkflowStep.step_order"
    )


class WorkflowStep(Base):
    __tablename__ = "workflow_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    section_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sections.id", ondelete="CASCADE"), nullable=False
    )
    department_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("departments.id"), nullable=True
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    role_label: Mapped[str] = mapped_column(String(50), nullable=False)
    assigned_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    status: Mapped[WorkflowStepStatus] = mapped_column(
        default=WorkflowStepStatus.PENDING, nullable=False
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)

    section = relationship("Section", back_populates="workflow_steps")
    department = relationship("Department")
    assigned_user = relationship("User")
