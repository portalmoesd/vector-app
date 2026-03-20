from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin
from app.models import Department, User
from app.schemas.department import DepartmentCreate, DepartmentOut, DepartmentUpdate
from app.schemas.user import UserOut

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("/", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    return db.query(Department).order_by(Department.name).all()


@router.post("/", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(
    body: DepartmentCreate, db: Session = Depends(get_db), _admin=Depends(require_admin)
):
    if db.query(Department).filter(Department.name == body.name).first():
        raise HTTPException(status_code=409, detail="Department name already exists")
    dept = Department(**body.model_dump())
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept


@router.get("/{dept_id}", response_model=DepartmentOut)
def get_department(dept_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    return dept


@router.patch("/{dept_id}", response_model=DepartmentOut)
def update_department(
    dept_id: int, body: DepartmentUpdate, db: Session = Depends(get_db), _admin=Depends(require_admin)
):
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(dept, field, value)
    db.commit()
    db.refresh(dept)
    return dept


@router.delete("/{dept_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(dept_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    if db.query(User).filter(User.department_id == dept_id).first():
        raise HTTPException(status_code=409, detail="Cannot delete department with assigned users")
    db.delete(dept)
    db.commit()


@router.get("/{dept_id}/users", response_model=list[UserOut])
def list_department_users(dept_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    users = db.query(User).filter(User.department_id == dept_id).order_by(User.full_name).all()
    result = []
    for u in users:
        out = UserOut.model_validate(u)
        out.country_ids = [ca.country_id for ca in u.country_assignments]
        result.append(out)
    return result
