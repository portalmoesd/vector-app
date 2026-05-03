# Local setup

## Requirements

- Node.js 18 or newer
- PostgreSQL 14 or newer
- Git

## Environment

Create `.env` from `.env.example` and set:

- `DATABASE_URL` - PostgreSQL connection string.
- `JWT_SECRET` - long random secret used for login tokens.
- `PORT` - server port, usually `3000`.
- `CORS_ORIGINS` - allowed browser origin in production.
- `ALLOW_DEFAULT_SEED_USERS` - use `false` for production and buyer handoff.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Database

The server runs `server/schema.sql` on startup. The schema is idempotent, so it can be applied repeatedly. Startup also performs compatibility fixes for older databases and seeds reference departments/countries/templates when needed.

For a production buyer environment, create real administrator accounts through an approved provisioning process instead of enabling default seeded users.

## Tests

```bash
npm test
```

Tests currently cover the event email draft resolver and are intended to grow around workflow, access control, and statistics behaviour.
