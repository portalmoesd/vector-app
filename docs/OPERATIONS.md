# Operations

## Routine checks

- `GET /api/health` returns `ok: true`.
- Application logs show successful schema migration during startup.
- Request logs show method, URL, response status, and duration for non-health traffic.
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
- Keep `ALLOW_DEFAULT_SEED_USERS=false` in production.
- Use HTTPS only for production access.
- Restrict database access to the application server and administrators.
- Review user accounts before buyer handoff and remove unused demo accounts.
- Browser hardening headers are set by the application; keep the app behind HTTPS so they are effective.

## Statistics data

The statistics setup is intentionally isolated from the event workflow. Current uploaded/packaged datasets continue to work. Direct Geostat integration should be completed only after the required intermediate certificate is available.

## Event email drafts

Event creation prepares a local email draft through the browser's `mailto:` handling. The portal does not send emails automatically. If the recipient list is too long, users receive a copyable fallback.

## Incident response

1. Check `/api/health`.
2. Check server logs for startup, database, authentication, or route errors.
3. Check PostgreSQL connectivity and disk space.
4. Restart the Node process only after confirming the database is reachable.
5. If data is missing or corrupted, stop writes and restore from the most recent verified backup.
