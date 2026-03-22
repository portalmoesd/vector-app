# Event Creation Permission Redesign

## Goal — Who can create events for whom (as Document Submitter)

| Creator Role | Can assign DS to |
|---|---|
| **ADMIN / PROTOCOL** | Anyone (unrestricted) |
| **DEPUTY** | Self + linked Supervisors + SCs in those supervisors' departments |
| **SUPERVISOR** | Self + their linked Deputy + SCs in same department |
| **SUPER_COLLABORATOR** | Self + Supervisors in same department + Deputies linked to those supervisors |

### Relationship map
- **Deputy ↔ Supervisor**: `deputy_supervisor_links` table
- **Supervisor ↔ SC**: same `department_id`
- **SC → Deputy**: SC's dept → Supervisors in that dept → linked Deputies via `deputy_supervisor_links`

---

## Changes

### 1. `server/helpers/roles.js` — No change needed
- `EVENT_CREATOR_ROLES` stays as `[ADMIN, PROTOCOL, DEPUTY, SUPERVISOR, SUPER_COLLABORATOR]`

### 2. `server/routes/admin.js` — New filtered endpoints
Add endpoints that return only the users a given role is allowed to assign:

- **`GET /api/admin/linked-deputies?user_id=X`**
  - For SUPERVISOR: reverse-lookup `deputy_supervisor_links` where `supervisor_id = X`
  - For SC: find supervisors in same dept → their linked deputies

- **`GET /api/admin/linked-supervisors?user_id=X`**
  - For DEPUTY: `deputy_supervisor_links` where `deputy_id = X`
  - For SC: supervisors sharing the same `department_id`

- **`GET /api/admin/linked-super-collaborators?user_id=X`**
  - For DEPUTY: SCs in departments of linked supervisors
  - For SUPERVISOR: SCs sharing the same `department_id`

### 3. `frontend/js/pages/calendar.js` — Filter dropdowns by role
- `CAN_CREATE` stays as all 5 roles
- **ADMIN/PROTOCOL**: keep current behavior (load all users for every dropdown)
- **DEPUTY/SUPERVISOR/SUPER_COLLABORATOR**: use the new `linked-*` endpoints to populate dropdowns, scoped to only the users they're allowed to assign

### 4. `server/routes/events.js` — Backend validation
After `canCreateEvent` check, validate the DS assignment based on the creator's role:
- **ADMIN/PROTOCOL**: no restriction
- **DEPUTY**:
  - DS=DEPUTY → `documentSubmitterId` must be self
  - DS=SUPERVISOR → must be in `deputy_supervisor_links`
  - DS=SC → SC's dept must match a linked supervisor's dept
- **SUPERVISOR**:
  - DS=SUPERVISOR → must be self
  - DS=DEPUTY → must be linked via `deputy_supervisor_links`
  - DS=SC → SC must share same `department_id`
- **SUPER_COLLABORATOR**:
  - DS=SC → must be self
  - DS=SUPERVISOR → must share same `department_id`
  - DS=DEPUTY → must be linked to a supervisor in same dept

---

## File Summary
| File | Change |
|------|--------|
| `server/helpers/roles.js` | No change |
| `server/routes/admin.js` | Add 3 new `linked-*` endpoints |
| `frontend/js/pages/calendar.js` | Use `linked-*` endpoints for non-admin roles |
| `server/routes/events.js` | Add per-role backend validation for DS assignment |
