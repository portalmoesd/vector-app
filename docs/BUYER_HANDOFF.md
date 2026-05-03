# Buyer handoff

This document is for the organization receiving Vector Portal. It explains what is included, what must be configured in the buyer environment, and how to verify the installation before users are invited.

## Product scope

Vector Portal is a browser-based document workflow system. Users create events, assign countries and departments, edit section content, move each section through the configured approval chain, attach supporting files, comment on content, publish completed events to the library, and review statistics.

The application is split into:

- A Node.js/Express API.
- A PostgreSQL database.
- A static browser frontend served by the same Node service.
- File and admin-uploaded dataset storage in PostgreSQL.

## Core workflows to verify

Before accepting a deployment, verify these flows with real buyer users:

- Administrator creates departments, users, country assignments, and deputy/supervisor links.
- Protocol or another authorized creator creates an event from scratch and from a template.
- Event creation opens a local email draft addressed by BCC to the workflow participants.
- Collaborator, super-collaborator, supervisor, deputy, and curator roles can act only on their assigned sections.
- Section content can be saved, submitted, approved, returned, pushed, and pulled according to the chosen workflow type.
- Comments remain anchored to saved section content.
- File upload, file listing, download, and deletion work with the buyer's maximum expected file sizes.
- Completed events appear in the library and can be reopened by the document submitter when allowed.
- Statistics pages load with the buyer's configured data source.

## Production configuration

The buyer environment must provide:

- `NODE_ENV=production`
- `DATABASE_URL` for PostgreSQL.
- `DATABASE_SSL_MODE` for PostgreSQL TLS behavior.
- `JWT_SECRET` generated specifically for this deployment.
- `CORS_ORIGINS` set to the final HTTPS origin.
- `ALLOW_DEFAULT_SEED_USERS=false`.
- Database backups sized for workflow files and admin-uploaded statistics datasets.

The service should run behind HTTPS through Nginx, Apache, Caddy, a load balancer, or the buyer's hosting platform.

For database TLS, prefer `DATABASE_SSL_MODE=require` when the buyer's server trusts the PostgreSQL certificate chain. Use `no-verify` only when the database requires TLS but certificate verification is not yet available.

## User and password policy

New users created by an administrator receive a temporary password and are marked to change it on first login. Passwords must be at least 8 characters and are stored as bcrypt hashes.

Default seed users are intended only for local development and demonstrations. Production deployments refuse to start with `ALLOW_DEFAULT_SEED_USERS=true`; provision real accounts instead.

## Email draft behavior

Event notifications use the user's local mail client through `mailto:`. The server prepares the recipient list and event summary, but it does not send email and does not store mail credentials.

Recipients are placed in BCC for privacy. Users without email addresses are skipped and shown to the event creator. If the draft is too long for reliable browser handling, the frontend shows a copyable fallback with BCC, subject, and body.

## Statistics status

Statistics integration is intentionally environment-specific. The current implementation supports the portal screens and local data processing, but final direct pulling from Geostat depends on the buyer's certificate and network configuration.

When the intermediate certificate is available, configure and test the statistics source in the buyer environment before relying on scheduled or live updates.

The production server starts statistics cache loaders explicitly during application startup. These loaders read cached tourism, FDI-sector, and companies datasets, then schedule the tourism refresh. Importing the API module for tests or tooling does not start background timers.

## Mobile app readiness

The current product is web-first, but the backend is organized as JSON API routes. A future mobile app can reuse the same authentication, event, workflow, file, library, and statistics endpoints.

The browser frontend uses a central `API_BASE` setting and can be pointed at a separate API host with `window.VECTOR_PORTAL_CONFIG.apiBase` if the buyer later separates frontend hosting from the Node API.

Before building a native app, decide:

- Whether login should remain JWT-only or move to the buyer's single sign-on.
- Whether mobile file upload/download should use the same storage path or object storage.
- Whether push notifications should be added alongside the current local email draft flow.
- Whether offline editing is required. Offline support would need conflict handling around section content and workflow state.

## Capacity notes

For 500-1000 live users, run PostgreSQL on dedicated managed or buyer-operated infrastructure, enable regular backups, and monitor CPU, memory, database connections, slow queries, disk usage, and upload storage growth.

Recommended production shape:

- One or more Node.js application processes behind a reverse proxy.
- PostgreSQL with tuned connection limits and backups.
- Upload and dataset storage in PostgreSQL, with a later object-storage migration only if file volume grows beyond the database plan.
- Health checks against `GET /api/health`.
- Readiness checks against `GET /api/ready` where the hosting platform supports them.
- Log collection for application errors and access patterns.

## Acceptance checklist

- `npm test` passes.
- `GET /api/health` returns `ok: true`.
- `GET /api/ready` returns `ok: true` and `database: true`.
- Production starts without default seed users.
- A real administrator can log in and create users.
- Role-based access checks prevent users from seeing unrelated events and sections.
- Event notification drafts open or show the long-draft fallback.
- Uploads are limited to approved file types and sizes.
- Completed events can be retrieved from the library.
- Database backups and restore procedures are documented by the buyer's operations team.
