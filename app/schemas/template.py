from datetime import datetime

from pydantic import BaseModel

from app.models.enums import DocumentSubmitterRole


class TemplateSectionCreate(BaseModel):
    title: str
    department_ids: list[int]
    sort_order: int = 0


class EventTemplateCreate(BaseModel):
    name: str
    document_submitter_role: DocumentSubmitterRole
    curator_required: bool = False
    sections: list[TemplateSectionCreate]


class TemplateSectionDepartmentOut(BaseModel):
    department_id: int

    model_config = {"from_attributes": True}


class TemplateSectionOut(BaseModel):
    id: int
    title: str
    sort_order: int
    departments: list[TemplateSectionDepartmentOut]

    model_config = {"from_attributes": True}


class EventTemplateOut(BaseModel):
    id: int
    name: str
    document_submitter_role: DocumentSubmitterRole
    curator_required: bool
    created_by_id: int
    sections: list[TemplateSectionOut]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
