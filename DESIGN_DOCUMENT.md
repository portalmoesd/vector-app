# Vector Portal — Workflow & Architecture Design Document

## 1. Overview

This document defines the redesigned document approval workflow, user management,
event creation, and progress tracking for the Vector Portal system.

**Key changes from the previous approach:**
- Remove the rigid single-deputy linear workflow
- Introduce department/agency-based user assignment
- Make the document submitter role dynamic (Deputy, Supervisor, or Super-Collaborator)
- Remove Minister from the approval chain
- Replace Collaborator I / Head Collaborator with simplified Collaborator / Super-Collaborator roles
- Add external user support (non-Ministry of Economy)

---

## 2. Roles

### 2.1 Role Definitions

| Role                | Scope        | Description |
|---------------------|--------------|-------------|
| **Deputy**          | Cross-department | Top-level official. Acts as **Document Submitter** (final approver) or **Curator** (mid-tier reviewer) depending on the document. |
| **Supervisor**      | Per department | Oversees department workflow. Can also serve as Document Submitter. Each department has exactly **one** Supervisor. |
| **Super-Collaborator** | Per department | Senior collaborator. Can also serve as Document Submitter. Each department has **at least one**. |
| **Collaborator**    | Per department | Base-level contributor. Each department has **at least one**. |

### 2.2 Removed Roles

- **Minister** — Will not be involved in document creation or approval.
- **Collaborator I / Head Collaborator** — Replaced by the simplified Collaborator / Super-Collaborator distinction.

### 2.3 The "Curator" Label

"Curator" is **not a separate role**. It is a contextual label applied to a **Deputy**
when that Deputy is **not** the Document Submitter for a given document. In this context,
the Deputy drops into the approval chain as a mid-tier reviewer (curator).

---

## 3. Departments & Agencies

### 3.1 Structure

- The system manages multiple **departments** and **agencies**.
- Departments and agencies are created and managed via the **Admin Panel**.
- Each user is assigned to **exactly one** department or agency.

### 3.2 Department Composition Requirements

Each department must have:
- Exactly **1 Supervisor**
- At least **1 Super-Collaborator**
- At least **1 Collaborator**

Deputies exist **above** the department level and can be linked to one or more departments.

### 3.3 External Organizations

External entities (non-Ministry of Economy) are also represented as departments/agencies
with the `external` flag. They can have their own:
- Collaborators
- Super-Collaborators
- Supervisors
- Curators (Deputies acting as curators)

---

## 4. User Management

### 4.1 User Creation (Admin Panel)

When creating a user, the admin must provide:

| Field             | Required | Description |
|-------------------|----------|-------------|
| **Full Name**     | Yes      | User's full name |
| **Country**       | Yes      | Country selection (retained from current system) |
| **Department / Agency** | Yes | Assign to exactly one department or agency |
| **Role**          | Yes      | One of: Deputy, Supervisor, Super-Collaborator, Collaborator |
| **External**      | Yes      | Boolean flag — `true` for users not from the Ministry of Economy |
| **Email**         | Yes      | For authentication and notifications |

### 4.2 Validation Rules

- A department cannot have more than 1 Supervisor.
- A department must have at least 1 Super-Collaborator and 1 Collaborator before it can be used in events.
- Deputies are not bound to the 1-per-department constraint (they operate cross-department).

---

## 5. Document Approval Workflow

### 5.1 Core Concept

The approval chain is **dynamic** — it adapts based on who is designated as the
**Document Submitter** (the person who gives final approval and sends the document to the library).

Any of the following roles can be the Document Submitter:
- **Deputy**
- **Supervisor**
- **Super-Collaborator**

### 5.2 Workflow Chains

#### Chain A — Deputy is Document Submitter

```
Collaborator → Super-Collaborator → Supervisor → Deputy (approves & submits to library)
```

- The Supervisor assigned to this document is the **responsible Supervisor** shown in the progress bar.
- Deputy is at the top of the chain as the final approver.

#### Chain B — Supervisor is Document Submitter

```
Collaborator → Super-Collaborator → Deputy (as Curator) → Supervisor (approves & submits to library)
```

- The Deputy drops into the chain as a **Curator** (mid-tier reviewer).
- Supervisor is the final approver.

#### Chain C — Super-Collaborator is Document Submitter

```
Collaborator → Deputy (as Curator) → Super-Collaborator (approves & submits to library)
```

- The Deputy acts as **Curator** between the Collaborator and the Super-Collaborator.
- Super-Collaborator is the final approver.

### 5.3 Workflow Summary Table

| Document Submitter   | Chain Order | Deputy's Role |
|----------------------|-------------|---------------|
| Deputy               | Collaborator → Super-Collaborator → Supervisor → **Deputy** | Final Approver |
| Supervisor           | Collaborator → Super-Collaborator → **Deputy (Curator)** → Supervisor | Curator (mid-tier) |
| Super-Collaborator   | Collaborator → **Deputy (Curator)** → Super-Collaborator | Curator (mid-tier) |

---

## 6. Event Creation (Redesigned)

### 6.1 Event Fields

When creating an event, the following must be specified:

| Field                  | Required   | Description |
|------------------------|------------|-------------|
| **Event Title**        | Yes        | Name of the event |
| **Document Submitter Role** | Yes  | Who will be the final approver: Deputy, Supervisor, or Super-Collaborator |
| **Deputy**             | Conditional | Selected from dropdown. Required if Deputy is Document Submitter or if a Curator is needed in the chain. |
| **Supervisor**         | Conditional | Selected from dropdown, **filtered by the selected Deputy** (linked relationship). Required if Supervisor is in the chain. |
| **Department / Agency** | Yes       | The originating department for this event |
| **Other event fields** | ...        | (dates, description, etc. — to be defined) |

### 6.2 Deputy–Supervisor Linking

Supervisors are **linked to Deputies**. When the event creator selects a Deputy from
the dropdown, the Supervisor dropdown is filtered to only show Supervisors associated
with that Deputy.

This linking is defined in the admin panel when setting up department/Deputy relationships.

### 6.3 Assignment Logic

- If **Deputy is Document Submitter**: Select a Deputy → filtered Supervisors appear → select Supervisor.
- If **Supervisor is Document Submitter**: Select a Deputy (who will act as Curator) → filtered Supervisors appear → select Supervisor (who becomes the submitter).
- If **Super-Collaborator is Document Submitter**: Select a Deputy (who will act as Curator) → Super-Collaborator is selected from the department roster.

---

## 7. Progress Bar

### 7.1 Dynamic Display

The progress bar adapts based on the Document Submitter:

#### When Deputy is Document Submitter:
```
[Collaborator] → [Super-Collaborator] → [Supervisor*] → [Deputy ✓]
                                          (* responsible)
```
- The assigned Supervisor is shown as the "responsible Supervisor."

#### When Supervisor is Document Submitter:
```
[Collaborator] → [Super-Collaborator] → [Deputy (Curator)] → [Supervisor ✓]
```

#### When Super-Collaborator is Document Submitter:
```
[Collaborator] → [Deputy (Curator)] → [Super-Collaborator ✓]
```

### 7.2 Status Indicators

Each step in the progress bar shows:
- **Pending** — Not yet reached
- **In Progress** — Currently being reviewed by this role
- **Approved** — This role has approved the document
- **Returned** — This role has sent the document back for revision

---

## 8. Data Model (High-Level)

### 8.1 Department / Agency

```
Department {
  id
  name
  is_external: boolean    // true for non-Ministry organizations
  created_at
  updated_at
}
```

### 8.2 User

```
User {
  id
  full_name
  email
  country
  role: enum [DEPUTY, SUPERVISOR, SUPER_COLLABORATOR, COLLABORATOR]
  department_id: FK → Department
  is_external: boolean
  created_at
  updated_at
}
```

### 8.3 Deputy–Supervisor Link

```
DeputySupervisorLink {
  id
  deputy_id: FK → User (where role = DEPUTY)
  supervisor_id: FK → User (where role = SUPERVISOR)
}
```

This defines which Supervisors a Deputy oversees, enabling the filtered dropdown in event creation.

### 8.4 Event

```
Event {
  id
  title
  description
  department_id: FK → Department
  document_submitter_role: enum [DEPUTY, SUPERVISOR, SUPER_COLLABORATOR]
  deputy_id: FK → User (nullable — the assigned Deputy)
  supervisor_id: FK → User (nullable — the assigned Supervisor)
  super_collaborator_id: FK → User (nullable — if SC is submitter)
  status: enum [DRAFT, IN_PROGRESS, COMPLETED, ARCHIVED]
  created_at
  updated_at
}
```

### 8.5 Document Workflow Step

```
WorkflowStep {
  id
  event_id: FK → Event
  step_order: integer
  role_label: string          // "Collaborator", "Super-Collaborator", "Curator", "Supervisor", "Deputy"
  assigned_user_id: FK → User
  status: enum [PENDING, IN_PROGRESS, APPROVED, RETURNED]
  reviewed_at: datetime (nullable)
  comments: text (nullable)
}
```

---

## 9. Admin Panel Requirements

### 9.1 Department Management
- CRUD operations for departments/agencies
- View department members and their roles
- Validate department composition (1 Supervisor, 1+ Super-Collaborator, 1+ Collaborator)

### 9.2 User Management
- Create/edit/deactivate users
- Assign role and department
- Set external flag
- Country selection

### 9.3 Deputy–Supervisor Linking
- Interface to define which Supervisors are overseen by which Deputies
- This drives the filtered dropdown behavior in event creation

---

## 10. Open Questions

1. **Can a Deputy act as Curator for multiple concurrent documents?** — Assumed yes.
2. **What happens if a department has no Deputy linked?** — Should event creation be blocked, or can events proceed without a Curator step?
3. **Can the same user hold different roles in different contexts?** — Currently assumed one role per user. If a Deputy needs to sometimes act as a Collaborator, this would need role-per-event assignment.
4. **Document types** — Are there specific document types that determine which role must be the Document Submitter, or is this always a manual choice per event?
5. **Notification system** — How should users be notified when a document reaches their step in the workflow?
6. **Rejection/return flow** — When a document is returned, does it go back one step or all the way to the Collaborator?
