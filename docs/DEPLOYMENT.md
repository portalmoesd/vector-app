# Deployment

## Production environment

Set these variables before starting the service:

- `NODE_ENV=production`
- `DATABASE_URL=postgres://...`
- `DATABASE_SSL_MODE=auto`
- `DATABASE_POOL_MAX=20`
- `DATABASE_IDLE_TIMEOUT_MS=30000`
- `DATABASE_CONNECTION_TIMEOUT_MS=10000`
- `AUTH_RATE_LIMIT_WINDOW_MS=900000`
- `AUTH_RATE_LIMIT_MAX=20`
- `WORKFLOW_UPLOAD_MAX_MB=50`
- `ADMIN_UPLOAD_MAX_MB=50`
- `JSON_BODY_LIMIT_MB=10`
- `GEOSTAT_TLS_MODE=no-verify`
- `LOG_FORMAT=text`
- `JWT_SECRET=<strong random value>`
- `CORS_ORIGINS=https://your-domain.example`
- `ALLOW_DEFAULT_SEED_USERS=false`
- `PORT=3000` or the port assigned by the host

The application refuses to start in production if `DATABASE_URL`, `JWT_SECRET`, or `CORS_ORIGINS` are missing.
It also refuses to start in production if `ALLOW_DEFAULT_SEED_USERS=true`.

`DATABASE_SSL_MODE` accepts `auto`, `disable`, `require`, or `no-verify`. Use `require` when the buyer's PostgreSQL certificate chain is trusted by the server. Use `no-verify` only for managed services or transitional environments that require TLS but cannot present a locally trusted certificate chain yet. Local Docker deployments should use `disable`.

For 500-1000 live users, tune `DATABASE_POOL_MAX` together with the PostgreSQL server's connection limit and the number of Node processes. For example, two Node processes with `DATABASE_POOL_MAX=20` can open up to 40 application connections.

Set `LOG_FORMAT=json` when the buyer's hosting platform or log collector expects structured request logs. The default `text` format is easier to read during local development.

The login route is rate limited by IP address. Keep the default `AUTH_RATE_LIMIT_MAX=20` per `AUTH_RATE_LIMIT_WINDOW_MS=900000` unless the buyer's network has a shared proxy that requires a carefully reviewed adjustment.

`WORKFLOW_UPLOAD_MAX_MB` controls each workflow file upload. `ADMIN_UPLOAD_MAX_MB` controls the statistics source-file uploads. `JSON_BODY_LIMIT_MB` controls JSON request payloads such as editor autosaves. Raising these limits increases database storage and memory pressure.

`GEOSTAT_TLS_MODE` accepts `no-verify` or `strict`. Use `no-verify` only while Geostat's missing intermediate certificate is not available to the Node runtime. After the buyer installs the certificate through system trust or `NODE_EXTRA_CA_CERTS`, switch to `strict`.

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
The image runs the application directly with Node as a non-root container user.

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
