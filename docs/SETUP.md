# Local setup

## Requirements

- Node.js 18 or newer
- PostgreSQL 14 or newer
- Git

## Environment

Create `.env` from `.env.example` and set:

- `DATABASE_URL` - PostgreSQL connection string.
- `DATABASE_SSL_MODE` - database TLS mode: `auto`, `disable`, `require`, or `no-verify`.
- `JWT_SECRET` - long random secret used for login tokens.
- `PORT` - server port, usually `3000`.
- `CORS_ORIGINS` - allowed browser origin in production.
- `ALLOW_DEFAULT_SEED_USERS` - optional local/demo setting. Production refuses to start if this is `true`.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Database

The server runs `server/schema.sql` on startup. The schema is idempotent, so it can be applied repeatedly. Startup also performs compatibility fixes for older databases and seeds reference departments/countries/templates when needed.

For a production buyer environment, create real administrator accounts through an approved provisioning process. Default seeded users are intentionally blocked in production.

## Tests

```bash
npm test
```

Tests cover deployment health and readiness, security headers, rate limiting, access helpers, validation helpers, event email draft resolution, event creation, workflow movement, comments, files, library, templates, users, departments, countries, sections, and section history.

For the full local verification gate, run:

```bash
npm run check
```

After startup, confirm:

```text
GET /api/health
GET /api/ready
```
