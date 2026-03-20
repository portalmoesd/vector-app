from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import DocumentSubmitterRole


class EventTemplate(Base):
    __tablename__ = "event_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    created_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    document_submitter_role: Mapped[DocumentSubmitterRole] = mapped_column(nullable=False)
    curator_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    created_by = relationship("User")
    sections = relationship(
        "EventTemplateSection", back_populates="template", cascade="all, delete-orphan",
        order_by="EventTemplateSection.sort_order"
    )


class EventTemplateSectionDepartment(Base):
    __tablename__ = "event_template_section_departments"

    template_section_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("event_template_sections.id", ondelete="CASCADE"),
        primary_key=True,
    )
    department_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True
    )

    department = relationship("Department")


class EventTemplateSection(Base):
    __tablename__ = "event_template_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("event_templates.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    template = relationship("EventTemplate", back_populates="sections")
    departments = relationship(
        "EventTemplateSectionDepartment", cascade="all, delete-orphan"
    )
