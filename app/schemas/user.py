from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models.enums import UserRole


class UserCreate(BaseModel):
    full_name: str
    username: str
    email: EmailStr
    password: str | None = None
    send_invite: bool = False
    role: UserRole
    department_id: int | None = None
    is_external: bool = False
    country_ids: list[int] = []


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    role: UserRole | None = None
    department_id: int | None = None
    is_external: bool | None = None
    is_active: bool | None = None
    country_ids: list[int] | None = None


class UserOut(BaseModel):
    id: int
    full_name: str
    username: str
    email: str
    role: UserRole
    department_id: int | None
    is_external: bool
    is_active: bool
    must_change_password: bool
    country_ids: list[int] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DeputySupervisorLinkCreate(BaseModel):
    deputy_id: int
    supervisor_id: int


class DeputySupervisorLinkOut(BaseModel):
    id: int
    deputy_id: int
    supervisor_id: int

    model_config = {"from_attributes": True}
