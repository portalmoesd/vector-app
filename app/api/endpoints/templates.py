from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_ds_eligible
from app.models import EventTemplate, EventTemplateSection, EventTemplateSectionDepartment, User
from app.schemas.template import EventTemplateCreate, EventTemplateOut

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("/", response_model=list[EventTemplateOut])
def list_templates(db: Session = Depends(get_db), current_user: User = Depends(require_ds_eligible)):
    return (
        db.query(EventTemplate)
        .filter(EventTemplate.created_by_id == current_user.id)
        .order_by(EventTemplate.name)
        .all()
    )


@router.post("/", response_model=EventTemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(
    body: EventTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ds_eligible),
):
    template = EventTemplate(
        name=body.name,
        created_by_id=current_user.id,
        document_submitter_role=body.document_submitter_role,
        curator_required=body.curator_required,
    )
    db.add(template)
    db.flush()

    for i, sec_data in enumerate(body.sections):
        section = EventTemplateSection(
            template_id=template.id,
            title=sec_data.title,
            sort_order=sec_data.sort_order or i,
        )
        db.add(section)
        db.flush()

        for dept_id in sec_data.department_ids:
            db.add(EventTemplateSectionDepartment(
                template_section_id=section.id,
                department_id=dept_id,
            ))

    db.commit()
    db.refresh(template)
    return template


@router.get("/{template_id}", response_model=EventTemplateOut)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ds_eligible),
):
    template = db.get(EventTemplate, template_id)
    if not template or template.created_by_id != current_user.id:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ds_eligible),
):
    template = db.get(EventTemplate, template_id)
    if not template or template.created_by_id != current_user.id:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(template)
    db.commit()
