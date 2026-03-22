# Event Creation Permission Redesign

## Goal
- **ADMIN & PROTOCOL**: Can create events for anyone (unrestricted)
- **DEPUTY**: Can create events for themselves, their linked Supervisors, and SCs in the same departments as those Supervisors
- **SUPERVISOR & SUPER_COLLABORATOR**: Can no longer create events (removed)

---

## Changes

### 1. `server/helpers/roles.js` — Restrict event creator roles
- Update `EVENT_CREATOR_ROLES` from `[ADMIN, PROTOCOL, DEPUTY, SUPERVISOR, SUPER_COLLABORATOR]` to `[ADMIN, PROTOCOL, DEPUTY]`

### 2. `frontend/js/pages/calendar.js` — Restrict CAN_CREATE & filter dropdowns
- Update `CAN_CREATE` from 5 roles to `['ADMIN', 'PROTOCOL', 'DEPUTY']`
- When a **DEPUTY** opens the create-event modal:
  - **DS Role = DEPUTY**: Pre-select themselves in the Deputy dropdown (only option)
  - **DS Role = SUPERVISOR**: Load only their linked supervisors via existing `/api/admin/supervisors?deputy_id={self}`
  - **DS Role = SUPER_COLLABORATOR**: Load SCs via new endpoint `/api/admin/deputy-super-collaborators?deputy_id={self}`
- When **ADMIN/PROTOCOL** opens the modal: keep current behavior (all users shown)

### 3. `server/routes/admin.js` — New filtered SC endpoint
- Add `GET /api/admin/deputy-super-collaborators?deputy_id=X`
  - Query: select SCs whose `department_id` matches any department of supervisors linked to deputy X (via `deputy_supervisor_links` → `users.department_id`)

### 4. `server/routes/events.js` — Backend validation for DEPUTY
- After the existing `canCreateEvent` check, add a DEPUTY-specific guard:
  - **DS Role = DEPUTY**: `documentSubmitterId` must equal `req.user.id`
  - **DS Role = SUPERVISOR**: supervisor must exist in `deputy_supervisor_links` for this deputy
  - **DS Role = SUPER_COLLABORATOR**: SC's department must match a department of a linked supervisor

---

## File Summary
| File | Change |
|------|--------|
| `server/helpers/roles.js` | Remove SUPERVISOR & SC from EVENT_CREATOR_ROLES |
| `frontend/js/pages/calendar.js` | Update CAN_CREATE; add role-based dropdown filtering |
| `server/routes/admin.js` | Add `/api/admin/deputy-super-collaborators` endpoint |
| `server/routes/events.js` | Add DEPUTY assignment validation in POST handler |
