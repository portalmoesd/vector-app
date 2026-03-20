from datetime import datetime

from pydantic import BaseModel

from app.models.enums import (
    DocumentSubmitterRole,
    EventStatus,
    SectionStatus,
    WorkflowStepStatus,
)


class SectionCreate(BaseModel):
    title: str
    department_ids: list[int]
    sort_order: int = 0


class EventCreate(BaseModel):
    title: str
    description: str | None = None
    country_id: int
    document_submitter_role: DocumentSubmitterRole
    document_submitter_id: int
    deputy_id: int | None = None
    curator_required: bool = False
    sections: list[SectionCreate]


class WorkflowStepOut(BaseModel):
    id: int
    step_order: int
    department_id: int | None
    role_label: str
    assigned_user_id: int | None
    status: WorkflowStepStatus
    reviewed_at: datetime | None
    comments: str | None

    model_config = {"from_attributes": True}


class SectionDepartmentOut(BaseModel):
    department_id: int

    model_config = {"from_attributes": True}


class SectionOut(BaseModel):
    id: int
    title: str
    sort_order: int
    status: SectionStatus
    departments: list[SectionDepartmentOut]
    workflow_steps: list[WorkflowStepOut]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EventOut(BaseModel):
    id: int
    title: str
    description: str | None
    country_id: int
    document_submitter_role: DocumentSubmitterRole
    document_submitter_id: int
    deputy_id: int | None
    curator_required: bool
    status: EventStatus
    created_by_id: int
    sections: list[SectionOut]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EventListOut(BaseModel):
    id: int
    title: str
    country_id: int
    status: EventStatus
    document_submitter_role: DocumentSubmitterRole
    created_at: datetime

    model_config = {"from_attributes": True}


class SectionAddRequest(BaseModel):
    title: str
    department_ids: list[int]
    sort_order: int = 0


class WorkflowActionRequest(BaseModel):
    comments: str | None = None
