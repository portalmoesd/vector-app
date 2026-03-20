"""Workflow generation engine.

Generates the correct workflow steps for each section based on:
1. The section's assigned departments
2. The Document Submitter role and department
3. Whether "Curator required" is enabled
4. Which roles exist in each department (missing levels are skipped)
"""

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models import (
    CountryAssignment,
    Department,
    DocumentSubmitterRole,
    Event,
    Section,
    User,
    UserRole,
    WorkflowStep,
)


def _find_users_by_role_dept_country(
    db: Session, role: UserRole, department_id: int, country_id: int | None = None
) -> list[User]:
    """Find active users in a department with a given role, optionally filtered by country."""
    q = db.query(User).filter(
        User.role == role,
        User.department_id == department_id,
        User.is_active.is_(True),
    )
    if country_id and role in (UserRole.COLLABORATOR, UserRole.SUPER_COLLABORATOR):
        q = q.filter(
            User.id.in_(
                db.query(CountryAssignment.user_id).filter(
                    CountryAssignment.country_id == country_id
                )
            )
        )
    return q.all()


def _build_department_chain(
    db: Session, department_id: int, country_id: int
) -> list[dict]:
    """Build the internal chain for a department: Collaborator → SC → Supervisor.

    Returns list of {role_label, assigned_user_id, department_id} dicts.
    Skips any role level that has no users in the department.
    """
    chain = []
    role_order = [
        (UserRole.COLLABORATOR, "Collaborator"),
        (UserRole.SUPER_COLLABORATOR, "Super-Collaborator"),
        (UserRole.SUPERVISOR, "Supervisor"),
    ]
    for role, label in role_order:
        users = _find_users_by_role_dept_country(db, role, department_id, country_id)
        if users:
            # Assign the first eligible user (could be enhanced to support multi-assignment)
            chain.append({
                "role_label": label,
                "assigned_user_id": users[0].id,
                "department_id": department_id,
            })
    return chain


def generate_workflow_steps(db: Session, event: Event, section: Section) -> list[WorkflowStep]:
    """Generate all workflow steps for a section.

    Logic:
    - For each department assigned to the section, build the internal chain.
    - If the department is the DS's home department, that's a home-department track.
    - If cross-department, add optional Curator step + receiving chain in DS's home dept.
    - Multi-department sections: each department track is independent but shares
      the same Curator/DS-level steps at the end.
    """
    ds_user = db.get(User, event.document_submitter_id)
    ds_dept_id = ds_user.department_id
    ds_role = event.document_submitter_role

    # Gather assigned departments for this section
    dept_ids = [sd.department_id for sd in section.departments]

    steps: list[WorkflowStep] = []
    step_order = 0

    is_any_cross_dept = any(d_id != ds_dept_id for d_id in dept_ids)

    # --- Department internal chains ---
    for dept_id in dept_ids:
        chain = _build_department_chain(db, dept_id, event.country_id)

        is_home = dept_id == ds_dept_id
        for entry in chain:
            # For home department, stop before the DS role level
            # (the DS approval is handled as the final step)
            if is_home and _role_is_at_or_above_ds(entry["role_label"], ds_role):
                break
            steps.append(WorkflowStep(
                section_id=section.id,
                department_id=entry["department_id"],
                step_order=step_order,
                role_label=entry["role_label"],
                assigned_user_id=entry["assigned_user_id"],
            ))
            step_order += 1

    # --- Cross-department tail: Curator + Receiving chain + DS ---
    if is_any_cross_dept:
        # Optional Curator step
        if event.curator_required and event.deputy_id:
            steps.append(WorkflowStep(
                section_id=section.id,
                department_id=None,
                step_order=step_order,
                role_label="Curator",
                assigned_user_id=event.deputy_id,
            ))
            step_order += 1

        # Receiving chain in DS's home department (SC → Supervisor → ...)
        # Only if DS is not Super-Collaborator (SC directly receives when they are DS)
        if ds_role != DocumentSubmitterRole.SUPER_COLLABORATOR:
            receiving_roles = []
            if ds_role == DocumentSubmitterRole.DEPUTY:
                receiving_roles = [
                    (UserRole.SUPER_COLLABORATOR, "Super-Collaborator"),
                    (UserRole.SUPERVISOR, "Supervisor"),
                ]
            elif ds_role == DocumentSubmitterRole.SUPERVISOR:
                receiving_roles = [
                    (UserRole.SUPER_COLLABORATOR, "Super-Collaborator"),
                ]

            for role, label in receiving_roles:
                users = _find_users_by_role_dept_country(db, role, ds_dept_id, event.country_id)
                if users:
                    steps.append(WorkflowStep(
                        section_id=section.id,
                        department_id=ds_dept_id,
                        step_order=step_order,
                        role_label=label,
                        assigned_user_id=users[0].id,
                    ))
                    step_order += 1

    # --- Final DS approval step ---
    ds_label = {
        DocumentSubmitterRole.DEPUTY: "Deputy",
        DocumentSubmitterRole.SUPERVISOR: "Supervisor",
        DocumentSubmitterRole.SUPER_COLLABORATOR: "Super-Collaborator",
    }[ds_role]

    steps.append(WorkflowStep(
        section_id=section.id,
        department_id=ds_dept_id if ds_role != DocumentSubmitterRole.DEPUTY else None,
        step_order=step_order,
        role_label=ds_label,
        assigned_user_id=event.document_submitter_id,
    ))

    # Set the first step as IN_PROGRESS
    if steps:
        steps[0].status = "IN_PROGRESS"

    return steps


def _role_is_at_or_above_ds(role_label: str, ds_role: DocumentSubmitterRole) -> bool:
    """Check if a role label is at or above the DS role in the hierarchy."""
    hierarchy = {
        "Collaborator": 0,
        "Super-Collaborator": 1,
        "Supervisor": 2,
        "Deputy": 3,
    }
    ds_level = {
        DocumentSubmitterRole.SUPER_COLLABORATOR: 1,
        DocumentSubmitterRole.SUPERVISOR: 2,
        DocumentSubmitterRole.DEPUTY: 3,
    }
    return hierarchy.get(role_label, 0) >= ds_level.get(ds_role, 0)
