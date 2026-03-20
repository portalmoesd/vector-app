from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (KeyError, ValueError, Exception):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_ds_eligible(current_user: User = Depends(get_current_user)) -> User:
    """Require a role eligible to be Document Submitter (Deputy, Supervisor, Super-Collaborator)."""
    if current_user.role not in (UserRole.DEPUTY, UserRole.SUPERVISOR, UserRole.SUPER_COLLABORATOR):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Deputy, Supervisor, or Super-Collaborator can perform this action",
        )
    return current_user
