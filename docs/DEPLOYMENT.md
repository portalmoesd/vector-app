# Deployment

## Production environment

Set these variables before starting the service:

- `NODE_ENV=production`
- `DATABASE_URL=postgres://...`
- `DATABASE_SSL_MODE=auto`
- `JWT_SECRET=<strong random value>`
- `CORS_ORIGINS=https://your-domain.example`
- `ALLOW_DEFAULT_SEED_USERS=false`
- `PORT=3000` or the port assigned by the host

The application refuses to start in production if `DATABASE_URL`, `JWT_SECRET`, or `CORS_ORIGINS` are missing.
It also refuses to start in production if `ALLOW_DEFAULT_SEED_USERS=true`.

`DATABASE_SSL_MODE` accepts `auto`, `disable`, `require`, or `no-verify`. Use `require` when the buyer's PostgreSQL certificate chain is trusted by the server. Use `no-verify` only for managed services or transitional environments that require TLS but cannot present a locally trusted certificate chain yet. Local Docker deployments should use `disable`.

## Standard Node deployment

```bash
npm ci --omit=dev
npm start
```

Serve the app behind HTTPS through a reverse proxy such as Nginx, Apache, Caddy, or the hosting provider's load balancer. Forward requests to the Node process on `PORT`.

## Capacity profile

For 500-1000 live users, use a production PostgreSQL server rather than a developer workstation database. Keep the Node process close to PostgreSQL on the same private network, and monitor database connection count, CPU, memory, disk usage, and slow queries.

Recommended baseline:

- Reverse proxy terminates HTTPS and forwards to Node.
- Node runs under a process manager such as systemd, PM2, Docker, or the buyer's orchestrator.
- PostgreSQL has automated backups and enough storage headroom for uploaded files.
- The application and database run on private infrastructure; only HTTPS is public.
- `GET /api/health` is checked for process liveness.
- `GET /api/ready` is checked before routing traffic when the platform supports database-aware readiness checks.

If multiple Node processes are used, keep all application instances pointed at the same PostgreSQL database. Uploaded files are currently stored in PostgreSQL, so no shared filesystem is required for workflow files. If upload volume grows heavily, plan a later move to object storage and keep the API contract stable for the frontend and future mobile app.

The production entry point starts statistics cache loaders during startup. These loaders read cached/uploaded datasets from PostgreSQL and schedule the daily tourism refresh. Route imports used by tests and tooling do not start those jobs.

## Docker deployment

Build and run the app image:

```bash
docker build -t vector-portal .
docker run --env-file .env -p 3000:3000 vector-portal
```

For a local database-backed stack, use:

```bash
docker compose up --build
```

The image and compose service include a healthcheck against `GET /api/ready`, so the container reports unhealthy if PostgreSQL is not reachable after startup.

## Health check

Use:

```text
GET /api/health
```

A healthy response returns JSON with `ok: true`.

For deployment readiness, use:

```text
GET /api/ready
```

This endpoint returns `ok: true` only when PostgreSQL responds to a lightweight query. It returns HTTP 503 when the database is unavailable.

## Buyer server transfer checklist

- Create a PostgreSQL database and restricted database user.
- Generate a new `JWT_SECRET`; do not reuse development secrets.
- Configure HTTPS and the final public origin in `CORS_ORIGINS`.
- Keep `ALLOW_DEFAULT_SEED_USERS=false`.
- Run one startup and confirm `/api/health` and `/api/ready`.
- Create real administrator accounts and remove any demo accounts if they exist.
- Confirm file upload/download, event creation, email draft opening, document export, and statistics pages.
