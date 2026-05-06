# Vector Portal

Vector Portal is a document approval workflow system for creating events, assigning ministry departments, preparing section content, reviewing through role-based chains, exporting documents, and reviewing statistics.

## What is included

- Express API with PostgreSQL persistence.
- Static frontend served by the same Node service.
- JWT authentication and role-based access control.
- Event creation, workflow dashboards, section editing, comments, file uploads, library, templates, and statistics.
- Local email draft preparation after event creation.
- Structured logging with Pino.
- Server-side HTML sanitization for user-generated content.
- Content Security Policy and security headers.
- Database migration system with versioned SQL files.
- Pluggable file storage backend (PostgreSQL BYTEA by default, S3-ready interface).

## Quick start

1. Install Node.js 18 or newer and PostgreSQL 14 or newer.
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, and `PORT`.
3. Install dependencies with `npm install`.
4. Start the app with `npm start`.
5. Open `http://localhost:3000`.

The server applies the database schema and runs pending migrations on startup. Demo/default users are blocked in production and are only available for local development or demo environments.

### Docker

```bash
docker compose up --build
```

This starts the app on port 3000 with a PostgreSQL 16 database. Health checks are configured for both services.

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Run the production server |
| `npm run dev` | Run with Node watch mode |
| `npm test` | Run backend and frontend tests |
| `npm run check` | Run tests + JavaScript syntax checks |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without modifying |
| `npm run migrate` | Run pending database migrations |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (prod) | PostgreSQL connection string |
| `JWT_SECRET` | Yes (prod) | JWT signing secret (must not be default) |
| `CORS_ORIGINS` | Yes (prod) | Comma-separated allowed origins |
| `PORT` | No | Server port (default: 3000) |
| `LOG_LEVEL` | No | Pino log level (default: info) |
| `STORAGE_BACKEND` | No | File storage backend: `database` (default) |
| `NODE_ENV` | No | Set to `production` for strict config validation |

## Architecture

```
server/
  routes/         14 route modules + tests
  middleware/     Auth, rate limiting, security headers, logging
  helpers/        Pipeline logic, access control, validation, sanitization
  storage/        Pluggable file storage (database backend)
  migrations/     Versioned SQL migration files
  data/           JSON seed data (departments, countries, org chart)
frontend/
  js/core/        Shared modules (API client, i18n, editor, utils)
  js/pages/       Per-page scripts
  css/            Stylesheets with CSS variables
  locales/        en.json, ka.json translations
```

## CI

GitHub Actions runs lint, format check, and tests on every push/PR to main. See `.github/workflows/ci.yml`.

## Documentation

- Setup: `docs/SETUP.md`
- Deployment: `docs/DEPLOYMENT.md`
- Operations: `docs/OPERATIONS.md`
- Database: `docs/DATABASE.md`
- API specification: `docs/openapi.yaml`
- Performance: `docs/PERFORMANCE.md`
- Buyer handoff: `docs/BUYER_HANDOFF.md`
- Final acceptance: `docs/FINAL_ACCEPTANCE.md`
- App readiness: `docs/APP_READINESS.md`
- Event email drafts: `docs/event-email-drafts.md`

## Health check

Use `GET /api/health` for liveness checks. Use `GET /api/ready` when a load balancer or deployment check must confirm PostgreSQL connectivity before sending traffic.
