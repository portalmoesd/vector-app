# Vector Portal

Vector Portal is a document approval workflow system for creating events, assigning ministry departments, preparing section content, reviewing through role-based chains, exporting documents, and reviewing statistics.

## What is included

- Express API with PostgreSQL persistence.
- Static frontend served by the same Node service.
- JWT authentication and role-based access control.
- Event creation, workflow dashboards, section editing, comments, file uploads, library, templates, and statistics.
- Local email draft preparation after event creation.

## Quick start

1. Install Node.js 18 or newer and PostgreSQL 14 or newer.
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, and `PORT`.
3. Install dependencies with `npm install`.
4. Start the app with `npm start`.
5. Open `http://localhost:3000`.

The server applies the database schema on startup. Demo/default users are disabled in production unless `ALLOW_DEFAULT_SEED_USERS=true` is explicitly set.

## Documentation

- Setup: `docs/SETUP.md`
- Deployment: `docs/DEPLOYMENT.md`
- Operations: `docs/OPERATIONS.md`
- Database: `docs/DATABASE.md`
- Buyer handoff: `docs/BUYER_HANDOFF.md`
- Event email drafts: `docs/event-email-drafts.md`

## Useful commands

- `npm start` - run the production server.
- `npm run dev` - run the server with Node watch mode.
- `npm test` - run automated tests.
- `npm run check` - run tests and JavaScript syntax checks.

## Health check

Use `GET /api/health` for liveness checks. Use `GET /api/ready` when a load balancer or deployment check must confirm PostgreSQL connectivity before sending traffic.
