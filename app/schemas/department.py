from datetime import datetime

from pydantic import BaseModel


class DepartmentCreate(BaseModel):
    name: str
    is_external: bool = False


class DepartmentUpdate(BaseModel):
    name: str | None = None
    is_external: bool | None = None


class DepartmentOut(BaseModel):
    id: int
    name: str
    is_external: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
