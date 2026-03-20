from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin
from app.core.security import hash_password
from app.models import CountryAssignment, DeputySupervisorLink, User, UserRole
from app.schemas.user import (
    DeputySupervisorLinkCreate,
    DeputySupervisorLinkOut,
    UserCreate,
    UserOut,
    UserUpdate,
)

router = APIRouter(prefix="/users", tags=["users"])


def _validate_user_data(body, db: Session, exclude_id: int | None = None):
    """Common validation for user create/update."""
    q = db.query(User).filter(User.username == body.username if hasattr(body, "username") else False)
    if exclude_id:
        q = q.filter(User.id != exclude_id)
    if hasattr(body, "username") and q.first():
        raise HTTPException(status_code=409, detail="Username already taken")


@router.get("/", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    users = db.query(User).order_by(User.full_name).all()
    result = []
    for u in users:
        out = UserOut.model_validate(u)
        out.country_ids = [ca.country_id for ca in u.country_assignments]
        result.append(out)
    return result


@router.post("/", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already taken")

    # Admin users don't need a department
    if body.role != UserRole.ADMIN and not body.department_id:
        raise HTTPException(status_code=422, detail="Non-admin users require a department")

    # Country assignments only for Collaborator/SC
    if body.country_ids and body.role not in (UserRole.COLLABORATOR, UserRole.SUPER_COLLABORATOR):
        raise HTTPException(status_code=422, detail="Country assignments only for Collaborator/SC roles")

    password = body.password or "temp-password-change-me"
    user = User(
        full_name=body.full_name,
        username=body.username,
        email=body.email,
        password_hash=hash_password(password),
        role=body.role,
        department_id=body.department_id,
        is_external=body.is_external,
        must_change_password=True,
    )
    db.add(user)
    db.flush()

    for cid in body.country_ids:
        db.add(CountryAssignment(user_id=user.id, country_id=cid))

    db.commit()
    db.refresh(user)
    out = UserOut.model_validate(user)
    out.country_ids = body.country_ids
    return out


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    out = UserOut.model_validate(user)
    out.country_ids = [ca.country_id for ca in user.country_assignments]
    return out


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int, body: UserUpdate, db: Session = Depends(get_db), _admin=Depends(require_admin)
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = body.model_dump(exclude_unset=True)
    country_ids = update_data.pop("country_ids", None)

    for field, value in update_data.items():
        setattr(user, field, value)

    if country_ids is not None:
        # Replace country assignments
        db.query(CountryAssignment).filter(CountryAssignment.user_id == user_id).delete()
        for cid in country_ids:
            db.add(CountryAssignment(user_id=user_id, country_id=cid))

    db.commit()
    db.refresh(user)
    out = UserOut.model_validate(user)
    out.country_ids = [ca.country_id for ca in user.country_assignments]
    return out


# --- Deputy-Supervisor Links ---

@router.get("/deputy-supervisor-links/", response_model=list[DeputySupervisorLinkOut])
def list_links(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    return db.query(DeputySupervisorLink).all()


@router.post(
    "/deputy-supervisor-links/",
    response_model=DeputySupervisorLinkOut,
    status_code=status.HTTP_201_CREATED,
)
def create_link(
    body: DeputySupervisorLinkCreate, db: Session = Depends(get_db), _admin=Depends(require_admin)
):
    deputy = db.get(User, body.deputy_id)
    if not deputy or deputy.role != UserRole.DEPUTY:
        raise HTTPException(status_code=422, detail="Invalid deputy user")
    supervisor = db.get(User, body.supervisor_id)
    if not supervisor or supervisor.role != UserRole.SUPERVISOR:
        raise HTTPException(status_code=422, detail="Invalid supervisor user")
    existing = (
        db.query(DeputySupervisorLink)
        .filter(DeputySupervisorLink.supervisor_id == body.supervisor_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Supervisor already linked to a deputy")
    link = DeputySupervisorLink(**body.model_dump())
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.delete("/deputy-supervisor-links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_link(link_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    link = db.get(DeputySupervisorLink, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
