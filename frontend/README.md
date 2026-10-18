# CloudSphere frontend (Stage 1)

React + TypeScript + Vite, Bootstrap 5 with custom design tokens, React Router, TanStack Query,
Axios, React Hook Form + Zod, Recharts and Lucide.

## Run
```bash
cp .env.example .env      # VITE_API_BASE_URL defaults to http://localhost:4000/api/v1
npm install
npm run dev               # http://localhost:5173
npm run typecheck
npm run build
```

## What exists in Stage 1
- Application shell: collapsible sidebar, top bar with breadcrumbs, notification bell, profile menu, toasts, responsive drawer.
- Login (React Hook Form + Zod), session restoration via `GET /auth/me`, protected routes, role gate, access-denied and not-found pages.
- Dashboard wired to `GET /dashboard/summary` with loading, error, retry and "not implemented yet" states.
- Every other module has a route and an honest "not connected yet" page listing the endpoints it will use. No fake data.

## API contract v0 (see src/types/api.ts)
- Base URL `/api/v1`. Success: `{ data, meta? }`. Error: `{ error: { code, message, details? } }`.
- JSON field names are snake_case. BIGINT ids and NUMERIC amounts are STRINGS (node-postgres default).
- Session is an httpOnly cookie (`withCredentials`); the backend must enable CORS credentials for the frontend origin.

## Security note
Hiding a menu item is not security. The Express backend must enforce authentication, roles and tenant isolation on every endpoint.
