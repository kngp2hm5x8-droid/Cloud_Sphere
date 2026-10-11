# CloudSphere

Academic simulation of cloud infrastructure management (React + Vite, Node/Express, PostgreSQL).

## Layout
- `backend/`   Express REST API (`src/` routes, controllers, services, db, middleware, config)
- `frontend/`  React + Vite + Bootstrap
- `database/`  `migrations/` (versioned SQL), `seeds/`, `scripts/` (bootstrap)
- `docs/`      design docs, ERD, data dictionary, checklist

## Setup (macOS / Homebrew)
See the Phase 0 steps in the conversation; summary:
1. `nvm install --lts` and `brew install postgresql@17 && brew services start postgresql@17`
2. Create roles/database with `database/scripts/00_bootstrap.sql`
3. `cd backend && cp .env.example .env` (edit passwords) `&& npm install express pg dotenv cors helmet morgan zod`
4. `npm run dev`, then `curl localhost:4000/api/health` and `curl localhost:4000/api/health/db`

## Record your versions here
node: ?   npm: ?   PostgreSQL: ?   (run `node -v`, `npm -v`, `psql --version`)

Never commit `.env` files or secrets.
