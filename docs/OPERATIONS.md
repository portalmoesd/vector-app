# Operations

## Routine checks

- `GET /api/health` returns `ok: true`.
- `GET /api/ready` returns `ok: true` and `database: true`.
- Application logs show successful schema migration during startup.
- Request logs show method, URL, response status, and duration for non-health traffic.
- Disallowed production browser origins return HTTP 403 with `Origin not allowed by CORS`.
- Malformed JSON requests return HTTP 400 with `Invalid JSON request body`.
- PostgreSQL has current backups and enough disk space.
- Users can log in, create events, upload files, and export documents.

## Backups

Back up PostgreSQL daily at minimum. The database stores users, events, workflow state, comments, templates, uploaded files, and admin-uploaded statistics datasets.

Recommended backup expectations:

- Daily automated dump.
- At least one restore test before production handoff.
- Separate secure storage for backup files.
- Documented retention period agreed with the buyer.

## Security operations

- Rotate `JWT_SECRET` if credentials or environment files may have leaked. This signs out existing sessions.
- Keep `ALLOW_DEFAULT_SEED_USERS=false` in production. The application refuses to start if this is set to `true` with `NODE_ENV=production`.
- Use HTTPS only for production access.
- Restrict database access to the application server and administrators.
- Review user accounts before buyer handoff and remove unused demo accounts.
- Browser hardening headers are set by the application; keep the app behind HTTPS so they are effective.

## Statistics data

The statistics setup is intentionally isolated from the event workflow. Current uploaded/packaged datasets continue to work. Direct Geostat integration should be completed only after the required intermediate certificate is available.

On real server startup, the application explicitly starts statistics background loaders. They load cached tourism, FDI-sector, and companies datasets, then schedule the daily tourism refresh. Test and tooling imports do not start these background jobs.

Admin statistics uploads accept XLSX, XLS, and CSV files up to 50MB. Unsupported file types are rejected before parsing.

## Event email drafts

Event creation prepares a local email draft through the browser's `mailto:` handling. The portal does not send emails automatically. If the recipient list is too long, users receive a copyable fallback.

## File uploads

Workflow uploads are stored in PostgreSQL and are limited to 10 files per request, 50MB per file. Supported types are PDF, Word, Excel, PowerPoint, PNG/JPEG images, plain text, and CSV. Unsupported types are rejected before storage.

## Capacity monitoring

For 500-1000 live users, review these signals daily during launch and weekly after the system stabilizes:

- PostgreSQL connection count and slow queries.
- PostgreSQL database size, especially `section_files`.
- Application memory and CPU.
- Request durations for workflow, file, statistics, and library endpoints.
- HTTP 4xx and 5xx rates.
- Backup completion and restore-test status.

Tune `DATABASE_POOL_MAX` against PostgreSQL's connection limit and the number of running Node processes. Keep enough spare connections for backups, migrations, and administrator access.

Avoid running production with local-only database storage or an unmonitored single terminal process. Use a managed service, systemd, PM2, Docker, or the buyer's standard server manager so the process restarts cleanly after host reboot or failure.

## Incident response

1. Check `/api/health`.
2. Check `/api/ready` to confirm whether PostgreSQL is reachable.
3. Check server logs for startup, database, authentication, or route errors.
4. Check PostgreSQL connectivity and disk space.
5. Restart the Node process only after confirming the database is reachable.
6. If data is missing or corrupted, stop writes and restore from the most recent verified backup.
