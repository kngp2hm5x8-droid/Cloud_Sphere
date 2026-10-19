# CloudSphere

CloudSphere is an academic simulation of cloud infrastructure management. It does not provision real infrastructure or process real payments.

## Stack and layout

- `frontend/`: React, TypeScript, Vite, Bootstrap, React Router, TanStack Query, Axios, and Recharts.
- `backend/`: Express 5 on JavaScript ESM, PostgreSQL through `pg`.
- `database/`: numbered PostgreSQL migrations, demo seed, and safe test database setup.
- `docs/`: schema, handoff, checklist, and the [Database Systems demo guide](docs/DATABASE_DEMO_GUIDE.md).

## Local setup

Use Node.js 26 and PostgreSQL 15 or later. On macOS with Homebrew, start PostgreSQL 18 and create the application and migration roles with `database/scripts/00_bootstrap.sql`. Create the separate test database with `database/scripts/01_bootstrap_test_db.sql`.

In `backend/`, copy `.env.example` to `.env`, set the database passwords and generate `JWT_SECRET` with `openssl rand -hex 32`. Set `COOKIE_SECURE=true` when serving over HTTPS. Keep `.env` local. Then run:

```sh
npm ci
npm run migrate
npm run seed
```

For tests, set `TEST_DATABASE_URL` and `TEST_MIGRATOR_DATABASE_URL` to the dedicated `cloudsphere_test` database, apply migrations with `npm run migrate:test`, then run `npm test`. The test helper refuses database names that do not end in `_test` and truncates that database before each suite.

In another terminal, run the API from `backend/` with `npm run dev`. In `frontend/`, copy `.env.example` to `.env`, run `npm ci`, then `npm run dev`. The frontend uses `http://localhost:4000/api/v1` by default.

## Demo sign-in

The demo seed uses password `Demo@12345`. For a customer workflow, use `alice@acme.test`. The seed also creates `admin@cloudsphere.test`, `bob@acme.test`, `carol@globex.test`, and `dave@initech.test`.

## API scope

Core API routes include authentication (`/auth/login`, `/auth/me`, `/auth/logout`), projects, dashboard, regions, configurations, quotas, VM create/list/detail/lifecycle/cost estimate, VM metrics, monitoring summary, unread notification count, `/health`, and `/ready`. The existing `/api/health` remains available. `/api/health/db` requires an authenticated session and returns only a generic status.

Successful API responses use `{ "data": ... }`; errors use `{ "error": { "code", "message" } }`. Session cookies are HTTP-only. Mutating requests require the CSRF cookie token in `X-CSRF-Token` and the `X-Requested-With: CloudSphere` header.

## Deferred

The durable background-jobs migration and worker, monitoring bulk ingestion, and request classifier are not implemented. Idempotency, advanced rate limiting, backpressure, circuit breakers, a full metrics subsystem, performance benchmarking, and OpenAPI documentation are also deferred.

Never commit `.env` files or secrets.
