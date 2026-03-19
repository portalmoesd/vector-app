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
- **Documents are composed of sections**, each owned by a department — approval chains are **per-section**
- Curator (Deputy) involvement on cross-department sections is **optional**, configured per event

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

### 3.4 Countries

Each event is associated with exactly **one country**. Countries control event visibility
and user access for pipeline roles.

- The system is seeded with a full ISO country list (~195 countries).
- Each country has: `name_en` (English name), `code` (ISO-2 country code), `is_active` flag.
- Countries can be deactivated (soft delete) but never removed.
- **Regions** (Neighbors, EU, Asia, Africa, etc.) are **UI-only groupings** used to help
  admins select countries more easily — they are not stored in the database.

#### 3.4.1 Country Assignments

- **Collaborators** and **Super-Collaborators** are assigned to one or more countries.
- **Supervisors** and **Deputies** are NOT assigned to countries — they can see all events
  within their scope (department or linked departments).
- A pipeline user can only view and work on events for countries they are assigned to.
- Country assignments are managed in the Admin Panel alongside section/department assignments.

#### 3.4.2 Country–Event Relationship

- Each event has a required `country_id` field — one country per event.
- When creating an event, the creator selects which country the event is for.
- All sections within an event inherit the event's country context.
- Document status (approval progress) is tracked per event (which is inherently per-country).

---

## 4. User Management

### 4.1 User Creation (Admin Panel)

When creating a user, the admin must provide:

| Field             | Required | Description |
|-------------------|----------|-------------|
| **Full Name**     | Yes      | User's full name |
| **Country Assignments** | Conditional | One or more countries the user can work on. Required for Collaborator and Super-Collaborator roles. Not applicable for Supervisors and Deputies. |
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

### 5.1 Core Concept — Per-Section Approval

A **document (event)** is composed of multiple **sections**. Each section is owned by
a specific **department**. The approval chain is **per-section**, not per-document.

Each section travels through its **own department's full approval chain** before reaching
the Document Submitter. The overall document is considered complete only when **all
sections** have been fully approved.

Any of the following roles can be the Document Submitter:
- **Deputy**
- **Supervisor**
- **Super-Collaborator**

### 5.2 Key Rules

1. **Own-department sections** (where the section's department matches the Document Submitter's department) go through the department chain and stop at the Document Submitter — **no Curator step**.
2. **Cross-department sections** (where the section's department differs from the Document Submitter's department) go through their own department's full chain, then **optionally** through the **Curator (Deputy)**, then through the **Document Submitter's home department receiving chain** (starting at SC), then to the Document Submitter.
3. The **Curator step is optional** — it is configured during event creation ("Curator required" toggle).
4. **Receiving chain**: When a cross-department section arrives at the Document Submitter's home department, it enters at the **Super-Collaborator** level and works up. This ensures the home department reviews cross-department content before the Document Submitter gives final approval. Exception: when SC is the Document Submitter, SC directly receives — no intermediate receiving chain.

### 5.3 Workflow Chains

#### Chain A — Deputy is Document Submitter

The Deputy is linked to a Supervisor (Dept A). Dept A serves as the **home department**
whose chain all sections must pass through before reaching the Deputy.

**Home-department section (Dept A):**
```
Collaborator(A) → Super-Collaborator(A) → Supervisor(A) → Deputy (approves & submits)
```

**Cross-department section (Dept B):**
```
Collaborator(B) → SC(B) → Supervisor(B) → [Deputy as Curator*] → SC(A) → Supervisor(A) → Deputy (approves & submits)
```

- Cross-department sections first complete their own department's chain, then pass through
  the home department's chain (SC(A) → Supervisor(A)) before reaching the Deputy.
- The Curator step is optional — it sits between the originating department's chain and the home department's receiving chain.
- Home-department sections skip the Curator step entirely.

`*` Curator step included only if "Curator required" is enabled during event creation.

#### Chain B — Supervisor (Dept A) is Document Submitter

**Own-department section (Dept A):**
```
Collaborator(A) → Super-Collaborator(A) → Supervisor(A) ✓ (approves & submits)
```
- No Curator needed — Supervisor directly oversees their own department's work.

**Cross-department section (Dept B):**
```
Collaborator(B) → SC(B) → Supervisor(B) → [Deputy as Curator*] → SC(A) → Supervisor(A) ✓ (approves & submits)
```
- The section goes through Dept B's **full internal chain** (up to Supervisor B).
- Then **optionally** through the Deputy acting as Curator.
- Then passes through the **home department's receiving chain** (SC(A) → Supervisor(A)) before reaching Supervisor A as the Document Submitter for final approval.

`*` Curator step included only if "Curator required" is enabled during event creation.

#### Chain C — Super-Collaborator (Dept A) is Document Submitter

**Own-department section (Dept A):**
```
Collaborator(A) → Super-Collaborator(A) ✓ (approves & submits)
```
- No Curator needed — Super-Collaborator directly oversees their own department's section.

**Cross-department section (Dept B):**
```
Collaborator(B) → SC(B) → Supervisor(B) → [Deputy as Curator*] → Super-Collaborator(A) ✓ (approves & submits)
```
- The section goes through Dept B's **full internal chain** (up to Supervisor B).
- Then **optionally** through the Deputy acting as Curator.
- Finally reaches Super-Collaborator A (the Document Submitter) for final approval.
- Note: SC(A) is the final approver here, so the section does **not** pass through SC(A) as an intermediate step — SC(A) directly receives and approves.

`*` Curator step included only if "Curator required" is enabled during event creation.

### 5.4 Workflow Summary Table

| Document Submitter        | Own-Dept Section Chain | Cross-Dept Section Chain | Curator Step |
|---------------------------|------------------------|--------------------------|--------------|
| **Deputy**                | Collab(A) → SC(A) → Supervisor(A) → **Deputy** | Collab(B) → SC(B) → Supervisor(B) → [Curator] → SC(A) → Supervisor(A) → **Deputy** | Optional |
| **Supervisor (Dept A)**   | Collab(A) → SC(A) → **Supervisor(A)** | Collab(B) → SC(B) → Supervisor(B) → [Curator] → SC(A) → **Supervisor(A)** | Optional |
| **Super-Collab (Dept A)** | Collab(A) → **SC(A)** | Collab(B) → SC(B) → Supervisor(B) → [Curator] → **SC(A)** | Optional |

---

## 6. Event Creation (Redesigned)

### 6.1 Event Fields

When creating an event, the following must be specified:

| Field                  | Required   | Description |
|------------------------|------------|-------------|
| **Event Title**        | Yes        | Name of the event |
| **Country**            | Yes        | The country this event is for. Determines which pipeline users (Collaborators, Super-Collaborators) can participate. |
| **Document Submitter Role** | Yes  | Who will be the final approver: Deputy, Supervisor, or Super-Collaborator |
| **Document Submitter** | Yes        | The specific user who will be the final approver (filtered by role selection) |
| **Deputy**             | Conditional | Selected from dropdown. Required if Deputy is Document Submitter **or** if Curator is enabled. |
| **Curator Required**   | Conditional | Toggle/checkbox. Shown when Document Submitter is **not** a Deputy. Controls whether the Deputy reviews cross-department sections. |
| **Supervisor**         | Conditional | Selected from dropdown, **filtered by the selected Deputy** (linked relationship). Required if Supervisor is in the chain. |
| **Sections**           | Yes        | Define the sections that compose this document (see §6.3). |
| **Other event fields** | ...        | (dates, description, etc. — to be defined) |

### 6.2 Deputy–Supervisor Linking

Supervisors are **linked to Deputies**. When the event creator selects a Deputy from
the dropdown, the Supervisor dropdown is filtered to only show Supervisors associated
with that Deputy.

This linking is defined in the admin panel when setting up department/Deputy relationships.

### 6.3 Section Definition

During event creation, the creator defines the **sections** that compose the document:

- Each section has a **title** and is assigned to a **department**.
- At least one section must be defined.
- A section assigned to the Document Submitter's own department follows the shorter (no-curator) chain.
- A section assigned to a different department follows the full cross-department chain.

The system automatically generates the correct **workflow steps** for each section based on:
1. The section's owning department
2. The Document Submitter role and department
3. Whether "Curator required" is enabled
4. The event's country (determines eligible pipeline users)

### 6.4 Assignment Logic

- If **Deputy is Document Submitter**: Select a Deputy → define sections (any departments) → all sections flow up to the Deputy.
- If **Supervisor is Document Submitter**: Select Supervisor → optionally enable "Curator required" → if enabled, select a Deputy (who acts as Curator) → define sections → own-dept sections skip curator, cross-dept sections go through curator if enabled.
- If **Super-Collaborator is Document Submitter**: Select Super-Collaborator → optionally enable "Curator required" → if enabled, select a Deputy (who acts as Curator) → define sections → own-dept sections skip curator, cross-dept sections go through curator if enabled.

---

## 7. Progress Bar

### 7.1 Per-Section Progress

Since documents are composed of sections with independent approval chains, the progress
bar displays **per-section status**. Each section shows its own chain progression.

#### Section-Level Progress Display

Each section shows its chain as a row/track:

**Example — Supervisor (Dept A) is Document Submitter, Curator enabled:**
```
Section "Budget" (Dept A — own dept):
  [Collaborator ✓] → [SC(A) ●] → [Supervisor A ○]

Section "Legal Review" (Dept B — cross-dept):
  [Collaborator ✓] → [SC(B) ✓] → [Supervisor B ✓] → [Curator ●] → [SC(A) ○] → [Supervisor A ○]

Section "Technical Spec" (Dept C — cross-dept):
  [Collaborator ●] → [SC(C) ○] → [Supervisor C ○] → [Curator ○] → [SC(A) ○] → [Supervisor A ○]
```

Legend: `✓` = Approved, `●` = In Progress, `○` = Pending

### 7.2 Overall Document Status

The overall document status is derived from the status of all its sections:

- **Draft** — Event created but workflow not started
- **In Progress** — At least one section is being worked on
- **Awaiting Final Approval** — All sections have reached the Document Submitter and await final sign-off
- **Completed** — All sections approved by the Document Submitter
- **Returned** — One or more sections have been sent back for revision

### 7.3 Status Indicators (Per Step)

Each step in a section's progress bar shows:
- **Pending** — Not yet reached
- **In Progress** — Currently being reviewed by this role
- **Approved** — This role has approved the section
- **Returned** — This role has sent the section back for revision

---

## 8. Data Model (High-Level)

### 8.1 Country

```
Country {
  id
  name_en: string              // English name (unique)
  code: string                 // ISO-2 country code (unique)
  is_active: boolean (default true)
  created_at
  updated_at
}
```

Seeded with the full ISO country list (~195 countries). Soft-deleted via `is_active = false`.

### 8.2 Country Assignment

```
CountryAssignment {
  user_id: FK → User           // PRIMARY KEY part 1
  country_id: FK → Country     // PRIMARY KEY part 2
}
```

Many-to-many link between users and countries. Only applicable for Collaborator and
Super-Collaborator roles. Supervisors and Deputies do not have country assignments.

### 8.3 Department / Agency

```
Department {
  id
  name
  is_external: boolean    // true for non-Ministry organizations
  created_at
  updated_at
}
```

### 8.4 User

```
User {
  id
  full_name
  email
  role: enum [DEPUTY, SUPERVISOR, SUPER_COLLABORATOR, COLLABORATOR]
  department_id: FK → Department
  is_external: boolean
  created_at
  updated_at
}
```

Country assignments are managed via the `CountryAssignment` join table (§8.2), not as a
direct field on the User model. Only Collaborator and Super-Collaborator roles have country assignments.

### 8.5 Deputy–Supervisor Link

```
DeputySupervisorLink {
  id
  deputy_id: FK → User (where role = DEPUTY)
  supervisor_id: FK → User (where role = SUPERVISOR)
}
```

This defines which Supervisors a Deputy oversees, enabling the filtered dropdown in event creation.

### 8.6 Event

```
Event {
  id
  title
  description
  country_id: FK → Country (NOT NULL)       // Each event is for exactly one country
  document_submitter_role: enum [DEPUTY, SUPERVISOR, SUPER_COLLABORATOR]
  document_submitter_id: FK → User          // The specific user who is the final approver
  deputy_id: FK → User (nullable)           // The assigned Deputy (as submitter or curator)
  curator_required: boolean (default false)  // Whether Deputy reviews cross-dept sections
  status: enum [DRAFT, IN_PROGRESS, COMPLETED, ARCHIVED]
  created_at
  updated_at
}
```

### 8.7 Section

```
Section {
  id
  event_id: FK → Event
  title: string
  department_id: FK → Department            // The department that owns this section
  is_own_department: boolean (computed)      // True if department matches Document Submitter's department
  status: enum [PENDING, IN_PROGRESS, APPROVED, RETURNED]
  created_at
  updated_at
}
```

Each section generates its own set of workflow steps based on whether it is an own-department
or cross-department section (see §5.3).

### 8.8 Document Workflow Step

```
WorkflowStep {
  id
  section_id: FK → Section                  // Steps belong to a section, not directly to an event
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
- Manage country assignments (for Collaborator and Super-Collaborator roles)
  - Region-based grouping in UI for easier selection (Neighbors, EU, Asia, Africa, etc.)
  - Hierarchical checkboxes: select a region to toggle all countries in that region

### 9.3 Deputy–Supervisor Linking
- Interface to define which Supervisors are overseen by which Deputies
- This drives the filtered dropdown behavior in event creation

---

## 10. Open Questions

1. **Can a Deputy act as Curator for multiple concurrent documents?** — One user can be assigned to more than one section. After all workflow is done and a Document Submitter submits the document to the library, the work is called a "document"; before that, every single user is working on one or more "sections".
2. **Can the same user hold different roles in different contexts?** — It is only the Deputy that, if they are not a Document Submitter, acts as Curator if they are required to participate. Other users hold their roles.
3. **Document types** — Users should be able to create **event templates** so they do not need to create event details every time manually.
4. **Notification system** — Users are created with email information. When an event is created, all participating users should be notified via email. They should also be notified when the section reaches their level. Additionally, on their respective dashboards there should be a notification for them to act.
5. **Rejection/return flow** — When a section is returned, it is returned to the **original editor level** (the first one to edit — not the specific user, but the level: Collaborator or Super-Collaborator).
6. **Section-level UX** — See the reference project for section visualization approach.
7. **Cross-department collaborator assignment** — Collaborators and Super-Collaborators are **automatically pulled from Dept B's roster** when a section is assigned to Dept B.
8. **Parallel vs sequential sections** — Sections are worked on **in parallel**.
9. **Section addition after event creation** — Sections **can be added** after event creation.
10. **Region groupings** — Should the UI region groupings for country selection match the previous system's groupings (Neighbors, EU, Other Europe, N. America, S. America, Africa, Asia, Oceania), or should they be customized for the new system?
11. **Country deactivation impact** — When a country is deactivated, what happens to existing events and user assignments for that country? Assumed: existing data is preserved but no new events can be created for that country.
