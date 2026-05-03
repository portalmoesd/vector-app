# Database notes

Vector Portal uses PostgreSQL as the source of truth for users, events, workflow state, comments, uploaded files, templates, and uploaded statistics datasets.

## Startup schema

`server/schema.sql` is idempotent and is applied during server startup. It creates tables, enum types, compatibility columns, and performance indexes.

Production deployments should still keep normal database backups and should test restore before handoff.

## Performance posture

The schema includes indexes for the hot paths used by the app:

- event listing by status, country, creator, document submitter, deputy, supervisor, and creation date
- section listing by event and sort order
- section access checks by department
- workflow content by event and status
- files by event, section, uploader, and creation date
- history by event, section, user, role, action, and latest activity
- comments and return requests by event and section
- user dropdowns by role, department, and display name
- deputy-supervisor and deputy-department reverse lookups
- template visibility and template section ordering

These are intended for the expected 500-1000 concurrent-user range without changing the existing data model.

## Data safety

- Uploaded files are stored in PostgreSQL `BYTEA` rows.
- Default demo users are disabled in production unless explicitly enabled.
- Do not drop or rewrite tables during buyer migration without a verified backup and restore test.
- Add future schema changes as idempotent migrations or guarded `ALTER TABLE ... IF NOT EXISTS` statements.
