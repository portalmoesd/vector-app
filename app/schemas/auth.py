from pydantic import BaseModel

from app.models.enums import UserRole


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class CurrentUser(BaseModel):
    id: int
    username: str
    full_name: str
    role: UserRole
    department_id: int | None

    model_config = {"from_attributes": True}
