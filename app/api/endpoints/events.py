from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_ds_eligible
from app.models import (
    DocumentSubmitterRole,
    Event,
    EventStatus,
    Section,
    SectionDepartment,
    SectionStatus,
    User,
    UserRole,
    WorkflowStep,
    WorkflowStepStatus,
)
from app.schemas.event import (
    EventCreate,
    EventListOut,
    EventOut,
    SectionAddRequest,
    SectionOut,
    WorkflowActionRequest,
)
from app.services.workflow import generate_workflow_steps

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/", response_model=list[EventListOut])
def list_events(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Event).order_by(Event.created_at.desc()).all()


@router.post("/", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    body: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_ds_eligible),
):
    # Validate DS user
    ds_user = db.get(User, body.document_submitter_id)
    if not ds_user:
        raise HTTPException(status_code=422, detail="Document submitter not found")

    # Validate deputy if required
    if body.document_submitter_role == DocumentSubmitterRole.DEPUTY and not body.deputy_id:
        raise HTTPException(status_code=422, detail="Deputy is required when DS role is Deputy")
    if body.curator_required and not body.deputy_id:
        raise HTTPException(status_code=422, detail="Deputy is required when curator is enabled")

    if not body.sections:
        raise HTTPException(status_code=422, detail="At least one section is required")

    event = Event(
        title=body.title,
        description=body.description,
        country_id=body.country_id,
        document_submitter_role=body.document_submitter_role,
        document_submitter_id=body.document_submitter_id,
        deputy_id=body.deputy_id,
        curator_required=body.curator_required,
        status=EventStatus.DRAFT,
        created_by_id=current_user.id,
    )
    db.add(event)
    db.flush()

    for i, sec_data in enumerate(body.sections):
        section = Section(
            event_id=event.id,
            title=sec_data.title,
            sort_order=sec_data.sort_order or i,
            status=SectionStatus.PENDING,
        )
        db.add(section)
        db.flush()

        for dept_id in sec_data.department_ids:
            db.add(SectionDepartment(section_id=section.id, department_id=dept_id))
        db.flush()

        steps = generate_workflow_steps(db, event, section)
        for step in steps:
            db.add(step)

    db.commit()
    db.refresh(event)
    return event


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("/{event_id}/sections", response_model=SectionOut, status_code=status.HTTP_201_CREATED)
def add_section(
    event_id: int,
    body: SectionAddRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_ds_eligible),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    section = Section(
        event_id=event.id,
        title=body.title,
        sort_order=body.sort_order,
        status=SectionStatus.PENDING,
    )
    db.add(section)
    db.flush()

    for dept_id in body.department_ids:
        db.add(SectionDepartment(section_id=section.id, department_id=dept_id))
    db.flush()

    steps = generate_workflow_steps(db, event, section)
    for step in steps:
        db.add(step)

    db.commit()
    db.refresh(section)
    return section


@router.post("/{event_id}/start")
def start_event(event_id: int, db: Session = Depends(get_db), _user=Depends(require_ds_eligible)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status != EventStatus.DRAFT:
        raise HTTPException(status_code=409, detail="Event already started")

    event.status = EventStatus.IN_PROGRESS
    for section in event.sections:
        section.status = SectionStatus.IN_PROGRESS
        # First step in each section should already be IN_PROGRESS from generation
    db.commit()
    return {"detail": "Event started"}


# --- Workflow Actions ---

@router.post("/workflow-steps/{step_id}/approve")
def approve_step(
    step_id: int,
    body: WorkflowActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    step = db.get(WorkflowStep, step_id)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    if step.status != WorkflowStepStatus.IN_PROGRESS:
        raise HTTPException(status_code=409, detail="Step is not in progress")
    if step.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not assigned to this step")

    step.status = WorkflowStepStatus.APPROVED
    step.reviewed_at = datetime.now(timezone.utc)
    step.comments = body.comments

    # Advance to next step
    section = step.section
    all_steps = sorted(section.workflow_steps, key=lambda s: s.step_order)
    current_idx = next(i for i, s in enumerate(all_steps) if s.id == step.id)

    if current_idx + 1 < len(all_steps):
        all_steps[current_idx + 1].status = WorkflowStepStatus.IN_PROGRESS
    else:
        # All steps complete — section is approved
        section.status = SectionStatus.APPROVED
        _check_event_completion(db, section.event)

    db.commit()
    return {"detail": "Step approved"}


@router.post("/workflow-steps/{step_id}/return")
def return_step(
    step_id: int,
    body: WorkflowActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    step = db.get(WorkflowStep, step_id)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    if step.status != WorkflowStepStatus.IN_PROGRESS:
        raise HTTPException(status_code=409, detail="Step is not in progress")
    if step.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not assigned to this step")

    step.status = WorkflowStepStatus.RETURNED
    step.reviewed_at = datetime.now(timezone.utc)
    step.comments = body.comments

    # Return to original editor level (first step in the chain)
    section = step.section
    section.status = SectionStatus.RETURNED

    all_steps = sorted(section.workflow_steps, key=lambda s: s.step_order)

    # Reset all steps from the beginning to PENDING, set first step as IN_PROGRESS
    for s in all_steps:
        if s.id != step.id:
            s.status = WorkflowStepStatus.PENDING
            s.reviewed_at = None
    all_steps[0].status = WorkflowStepStatus.IN_PROGRESS

    db.commit()
    return {"detail": "Section returned to original editor"}


def _check_event_completion(db: Session, event: Event):
    """Check if all sections are approved and update event status."""
    all_approved = all(s.status == SectionStatus.APPROVED for s in event.sections)
    if all_approved:
        event.status = EventStatus.COMPLETED
