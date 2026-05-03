# Deployment

## Production environment

Set these variables before starting the service:

- `NODE_ENV=production`
- `DATABASE_URL=postgres://...`
- `JWT_SECRET=<strong random value>`
- `CORS_ORIGINS=https://your-domain.example`
- `ALLOW_DEFAULT_SEED_USERS=false`
- `PORT=3000` or the port assigned by the host

The application refuses to start in production if `DATABASE_URL`, `JWT_SECRET`, or `CORS_ORIGINS` are missing.

## Standard Node deployment

```bash
npm ci --omit=dev
npm start
```

Serve the app behind HTTPS through a reverse proxy such as Nginx, Apache, Caddy, or the hosting provider's load balancer. Forward requests to the Node process on `PORT`.

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

## Health check

Use:

```text
GET /api/health
```

A healthy response returns JSON with `ok: true`.

## Buyer server transfer checklist

- Create a PostgreSQL database and restricted database user.
- Generate a new `JWT_SECRET`; do not reuse development secrets.
- Configure HTTPS and the final public origin in `CORS_ORIGINS`.
- Keep `ALLOW_DEFAULT_SEED_USERS=false`.
- Run one startup and confirm `/api/health`.
- Create real administrator accounts and remove any demo accounts if they exist.
- Confirm file upload/download, event creation, email draft opening, document export, and statistics pages.
