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
- **Documents are composed of sections**, each assigned to one or more departments — approval chains are **per-section**
- Curator (Deputy) involvement on cross-department sections is **optional**, configured per event

---

## 2. Roles

### 2.1 Role Definitions

| Role                | Scope        | Description |
|---------------------|--------------|-------------|
| **Admin**           | System-wide  | System administrator. Manages departments, users, Deputy–Supervisor links, and country assignments via the Admin Panel. Does **not** participate in document workflows. |
| **Deputy**          | Cross-department | Top-level official. Acts as **Document Submitter** (final approver) or **Curator** (mid-tier reviewer) depending on the document. |
| **Supervisor**      | Per department | Oversees department workflow. Can also serve as Document Submitter. |
| **Super-Collaborator** | Per department | Senior collaborator. Can also serve as Document Submitter. |
| **Collaborator**    | Per department | Base-level contributor. |

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

### 3.2 Department Composition

- Departments have **no strict role composition requirements**. A department may have any combination of roles — sometimes only one person from a department participates in a section.
- Deputies exist **above** the department level and can be linked to one or more departments.
- If a department lacks a role level (e.g., no Super-Collaborator or no Supervisor), the workflow chain **skips that step** and proceeds to the next applicable level.

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
- Each country has: `name_en` (English name), `code` (ISO-2 country code).
- Countries are **permanent** — they cannot be deactivated or removed.
- **Regions** are **UI-only groupings** used to help admins select countries more easily — they are not stored in the database. The region groupings match the previous system exactly:
  - **Neighbors**: BY, UA, MD, RU, AZ, AM, KZ, TJ, KG, UZ, TM
  - **EU**: AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT, LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE
  - **Other Europe**: AL, AD, BA, CH, IS, LI, MC, ME, MK, NO, RS, SM, TR, GB, VA, GE, XK
  - **North America**: US, CA, MX, GL, BM
  - **Central America & Caribbean**: BZ, CR, SV, GT, HN, NI, PA, AG, BS, BB, CU, DM, DO, GD, HT, JM, KN, LC, VC, TT, PR
  - **South America**: AR, BO, BR, CL, CO, EC, GY, PY, PE, SR, UY, VE, FK, GF
  - **Africa**: All African nations (~54 countries)
  - **Asia**: All Asian nations (~48 countries)
  - **Oceania**: AU, NZ, FJ, FM, KI, MH, NR, PW, PG, WS, SB, TO, TV, VU

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
| **Username**      | Yes      | Unique login identifier. Used for authentication (username + password). |
| **Email**         | Yes      | For notifications and password reset |
| **Country Assignments** | Conditional | One or more countries the user can work on. Required for Collaborator and Super-Collaborator roles. Not applicable for Supervisors and Deputies. |
| **Department / Agency** | Yes | Assign to exactly one department or agency |
| **Role**          | Yes      | One of: Deputy, Supervisor, Super-Collaborator, Collaborator |
| **External**      | Yes      | Boolean flag — `true` for users not from the Ministry of Economy |

#### 4.1.1 Authentication Setup

Users authenticate with **username + password**. When creating a user, the admin can choose either:
- **Set an initial temporary password** — the user must change it on first login.
- **Send an email invitation** — the system emails the user a link to set their own password.

### 4.2 Validation Rules

- Usernames must be unique across all users.
- Deputies are not bound to a per-department constraint (they operate cross-department).
- A department must have at least **one user** to be usable in events.

---

## 5. Document Approval Workflow

### 5.1 Core Concept — Per-Section Approval

A **document (event)** is composed of multiple **sections**. Each section can be assigned
to **one or more departments**. The approval chain is **per-section**, not per-document.

When a section has multiple departments, each department's chain runs **in parallel**.
Once all department chains for a section are complete, the section moves to the
Curator/Document Submitter level. The overall document is considered complete only when
**all sections** have been fully approved.

Sections themselves also run **in parallel** — they do not depend on each other.
New sections **can be added** after event creation.

Any of the following roles can be the Document Submitter:
- **Deputy**
- **Supervisor**
- **Super-Collaborator**

### 5.2 Key Rules

1. **Home-department sections** (where the section's department matches the Document Submitter's department) go through the department chain and stop at the Document Submitter — **no Curator step**.
2. **Cross-department sections** (where the section's department differs from the Document Submitter's department) go through their own department's full chain, then **optionally** through the **Curator (Deputy)**, then through the **Document Submitter's home department receiving chain** (starting at SC), then to the Document Submitter.
3. The **Curator step is optional** — it is configured during event creation ("Curator required" toggle).
4. **Receiving chain**: When a cross-department section arrives at the Document Submitter's home department, it enters at the **Super-Collaborator** level and works up. This ensures the home department reviews cross-department content before the Document Submitter gives final approval. Exception: when SC is the Document Submitter, SC directly receives — no intermediate receiving chain.
5. **Skip missing levels**: If a department lacks a role (e.g., no Super-Collaborator or no Supervisor), the workflow chain **skips that step** and proceeds to the next applicable level.
6. **Return flow**: When a section is returned (rejected), it goes back to the **original editor level** — the first level to edit (Collaborator or Super-Collaborator), not one step back. The section must then re-traverse the entire chain from that point.
7. **Auto-assignment**: When a section is assigned to a department, Collaborators and Super-Collaborators are **automatically pulled from that department's roster** (filtered by the event's country assignment).
8. **Multi-department sections**: When a section is assigned to multiple departments, each department's internal chain runs **in parallel**. Once all department chains complete, the section proceeds to the Curator/DS level.

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

#### Multi-Department Sections

When a section is assigned to multiple departments (e.g., Dept B and Dept C), each department's
chain runs in parallel. Once all have completed, the section proceeds to the Curator/DS level:

```
Section "Joint Analysis" (Dept B + Dept C):
  Dept B track: Collaborator(B) → SC(B) → Supervisor(B) ──┐
  Dept C track: Collaborator(C) → SC(C) → Supervisor(C) ──┤→ [Curator*] → SC(A) → Supervisor(A) → Deputy
```

#### Skipping Missing Levels

If a department lacks a role, that step is skipped. For example, if Dept B has no Super-Collaborator:

```
Collaborator(B) → Supervisor(B) → ...
```

### 5.4 Workflow Summary Table

| Document Submitter        | Own-Dept Section Chain | Cross-Dept Section Chain | Curator Step |
|---------------------------|------------------------|--------------------------|--------------|
| **Deputy**                | Collab(A) → SC(A) → Supervisor(A) → **Deputy** | Collab(B) → SC(B) → Supervisor(B) → [Curator] → SC(A) → Supervisor(A) → **Deputy** | Optional |
| **Supervisor (Dept A)**   | Collab(A) → SC(A) → **Supervisor(A)** | Collab(B) → SC(B) → Supervisor(B) → [Curator] → SC(A) → **Supervisor(A)** | Optional |
| **Super-Collab (Dept A)** | Collab(A) → **SC(A)** | Collab(B) → SC(B) → Supervisor(B) → [Curator] → **SC(A)** | Optional |

---

## 6. Event Creation (Redesigned)

### 6.0 Who Can Create Events

Events can be created by any user with a **DS-eligible role**:
- **Deputy**
- **Supervisor**
- **Super-Collaborator**

Collaborators and Admins **cannot** create events.

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

- Each section has a **title** and is assigned to **one or more departments**.
- At least one section must be defined.
- Sections can be **added after event creation**.
- If all of a section's departments match the Document Submitter's home department, it follows the shorter (no-curator) chain.
- If any of a section's departments differ from the Document Submitter's department, the section follows the cross-department chain for those departments.
- When a section has multiple departments, each department's chain runs in parallel; once all complete, the section proceeds to the Curator/DS level.

The system automatically generates the correct **workflow steps** for each section based on:
1. The section's assigned departments
2. The Document Submitter role and department
3. Whether "Curator required" is enabled
4. The event's country (determines eligible pipeline users)
5. Which roles exist in each department (missing levels are skipped)

### 6.4 Assignment Logic

- If **Deputy is Document Submitter**: Select a Deputy → define sections (any departments) → all sections flow up to the Deputy.
- If **Supervisor is Document Submitter**: Select Supervisor → optionally enable "Curator required" → if enabled, select a Deputy (who acts as Curator) → define sections → own-dept sections skip curator, cross-dept sections go through curator if enabled.
- If **Super-Collaborator is Document Submitter**: Select Super-Collaborator → optionally enable "Curator required" → if enabled, select a Deputy (who acts as Curator) → define sections → own-dept sections skip curator, cross-dept sections go through curator if enabled.

### 6.5 Event Templates

Users can create **event templates** to avoid re-entering event details manually each time.
A template saves:
- Section structure (titles and department assignments)
- Document Submitter role
- Curator required toggle

Templates are **user-created and user-owned** — each user manages their own templates.
When creating a new event from a template, the saved configuration is pre-filled and can be
adjusted before finalizing.

See §8.10–8.12 for the template data model.

---

## 7. Progress Bar

### 7.1 Per-Section Progress

Since documents are composed of sections with independent approval chains, the progress
bar displays **per-section status**. Each section shows its own chain progression.

#### Section-Level Progress Display

Each section shows its chain as a row/track:

**Example — Supervisor (Dept A) is Document Submitter, Curator enabled:**
```
Section "Budget" (Dept A — home dept):
  [Collaborator ✓] → [SC(A) ●] → [Supervisor A ○]

Section "Legal Review" (Dept B — cross-dept):
  [Collaborator ✓] → [SC(B) ✓] → [Supervisor B ✓] → [Curator ●] → [SC(A) ○] → [Supervisor A ○]

Section "Joint Analysis" (Dept B + Dept C — multi-dept):
  Dept B: [Collaborator ✓] → [SC(B) ✓] → [Supervisor B ✓] ──┐
  Dept C: [Collaborator ●] → [SC(C) ○] → [Supervisor C ○] ──┤→ [Curator ○] → [SC(A) ○] → [Supervisor A ○]
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
  created_at
  updated_at
}
```

Seeded with the full ISO country list (~195 countries). Countries are permanent and cannot be removed.

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
  username: string (unique)        // Login identifier
  email
  password_hash: string            // Bcrypt/argon2 hash — never store plaintext
  role: enum [ADMIN, DEPUTY, SUPERVISOR, SUPER_COLLABORATOR, COLLABORATOR]
  department_id: FK → Department (nullable) // Null for Admin users
  is_external: boolean
  must_change_password: boolean (default true)  // Forces password change on first login
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
  status: enum [PENDING, IN_PROGRESS, APPROVED, RETURNED]
  created_at
  updated_at
}
```

Departments are assigned to sections via the `SectionDepartment` join table (§8.8).
Each section generates its own set of workflow steps. When a section has multiple departments,
each department's chain runs in parallel; the section proceeds to the Curator/DS level once all complete.

### 8.8 Section–Department Assignment

```
SectionDepartment {
  section_id: FK → Section         // PRIMARY KEY part 1
  department_id: FK → Department   // PRIMARY KEY part 2
}
```

Many-to-many link between sections and departments. A section can be assigned to one or more departments.

### 8.9 Document Workflow Step

```
WorkflowStep {
  id
  section_id: FK → Section                  // Steps belong to a section, not directly to an event
  department_id: FK → Department (nullable) // Which department track this step belongs to (null for Curator/DS steps)
  step_order: integer
  role_label: string          // "Collaborator", "Super-Collaborator", "Curator", "Supervisor", "Deputy"
  assigned_user_id: FK → User
  status: enum [PENDING, IN_PROGRESS, APPROVED, RETURNED]
  reviewed_at: datetime (nullable)
  comments: text (nullable)
}
```

### 8.10 Event Template

```
EventTemplate {
  id
  name: string                               // User-defined template name
  created_by_id: FK → User                   // The user who created this template
  document_submitter_role: enum [DEPUTY, SUPERVISOR, SUPER_COLLABORATOR]
  curator_required: boolean (default false)
  created_at
  updated_at
}
```

Templates are user-created and user-owned — each user manages their own templates.

### 8.11 Event Template Section

```
EventTemplateSection {
  id
  template_id: FK → EventTemplate
  title: string
  sort_order: integer
}
```

### 8.12 Event Template Section–Department

```
EventTemplateSectionDepartment {
  template_section_id: FK → EventTemplateSection   // PRIMARY KEY part 1
  department_id: FK → Department                    // PRIMARY KEY part 2
}
```

---

## 9. Admin Panel Requirements

### 9.1 Department Management
- CRUD operations for departments/agencies
- View department members and their roles

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

## 10. Notification System

### 10.1 Email Notifications

Users receive email notifications in the following scenarios:
- **Event created** — All participating users are notified when an event is created.
- **Section reaches user's level** — A user is notified when a section arrives at their step in the workflow chain.
- **Section returned** — The original editor level is notified when a section is returned for revision.

### 10.2 Dashboard Notifications

Each user's dashboard displays **pending action notifications** — sections that are currently
at their level and require their review or editing. This ensures users can see at a glance
what work is waiting for them.

---

## 11. Resolved Design Decisions

The following questions were raised during design and have been resolved:

1. **Concurrent curator duties** — A Deputy can act as Curator for multiple concurrent documents. Users work on "sections" during the workflow; the work becomes a "document" only after the Document Submitter submits it to the library.
2. **Role consistency** — Users hold their assigned role. The only contextual change is that a Deputy acts as Curator when they are not the Document Submitter but are required to participate.
3. **Event templates** — Implemented in §6.5. Users can create templates to avoid re-entering event details.
4. **Notification system** — Implemented in §10. Email + dashboard notifications.
5. **Return flow** — Documented in §5.2 rule 6. Returns go to the original editor level, not one step back.
6. **Section-level UX** — See the reference project for section visualization approach.
7. **Cross-department auto-assignment** — Documented in §5.2 rule 7. Collaborators and Super-Collaborators are automatically pulled from the assigned department's roster.
8. **Parallel sections** — Documented in §5.1. Sections are worked on in parallel.
9. **Section addition** — Documented in §5.1. Sections can be added after event creation.
10. **Region groupings** — Documented in §3.4. Use the same groupings as the previous system.
11. **Country permanence** — Documented in §3.4. Countries are permanent; no deactivation needed.
