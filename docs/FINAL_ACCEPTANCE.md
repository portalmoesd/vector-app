# Final acceptance checklist

Use this checklist before delivering Vector Portal to the buyer or moving it to the buyer's server.

## Code and tests

- `npm run check` passes.
- The working tree is clean before packaging.
- Production-only settings are configured through environment variables, not code edits.
- Demo/default users are disabled with `ALLOW_DEFAULT_SEED_USERS=false`.

## Production environment

- `NODE_ENV=production`
- `DATABASE_URL` points to the buyer PostgreSQL database.
- `DATABASE_SSL_MODE` matches the buyer database TLS setup.
- `JWT_SECRET` is a new strong secret generated for this deployment.
- `CORS_ORIGINS` is the final HTTPS browser origin.
- `ALLOW_DEFAULT_SEED_USERS=false`
- `LOG_FORMAT=json` if the buyer collects structured logs.
- `GEOSTAT_TLS_MODE=strict` after the Geostat intermediate certificate is trusted; otherwise document the temporary `no-verify` setting.

## Capacity settings

- `DATABASE_POOL_MAX` is sized against PostgreSQL's connection limit and the number of Node processes.
- `AUTH_RATE_LIMIT_WINDOW_MS` and `AUTH_RATE_LIMIT_MAX` are kept enabled for login protection.
- `WORKFLOW_UPLOAD_MAX_MB`, `ADMIN_UPLOAD_MAX_MB`, and `JSON_BODY_LIMIT_MB` match the buyer's expected document sizes.
- PostgreSQL storage has headroom for workflow files and uploaded statistics datasets.

## Operational checks

- `GET /api/health` returns `ok: true`.
- `GET /api/ready` returns `ok: true` and `database: true`.
- The app runs behind HTTPS.
- Database backups are automated.
- At least one database restore test is completed before handoff.
- Logs are collected and retained according to buyer policy.

## Workflow verification

- A real administrator can log in and create users.
- User roles can access only their assigned events and sections.
- Event creation works from scratch and from templates.
- Event creation opens an email draft or shows the copyable fallback.
- Section editing, autosave, submit, approve, return, push, and pull work for the buyer's expected roles.
- Comments, history, file upload, file download, and deletion work.
- Completed events appear in the library and can be reopened by the document submitter when allowed.
- Statistics screens load using the configured datasets and source behavior.

## Buyer sign-off notes

- Direct Geostat pulling remains environment-dependent until the certificate chain is available to Node.js.
- The current notification feature opens a local email draft; the server does not send mail automatically.
- A future mobile app can reuse the existing JSON API, but push notifications, single sign-on, and offline editing require separate product decisions.
