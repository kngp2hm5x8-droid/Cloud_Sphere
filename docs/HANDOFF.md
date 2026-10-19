# CloudSphere — Project Handoff Brief

Prepared by Claude on 2026-10-19 for the next AI assistant or engineer. Read this whole file first, then continue from **Section 11 (Next steps)**. Do not ask the owner to re-approve decisions in Section 5; they are final.

---

## 1. Project and owner

- **Project:** CloudSphere — "Intelligent Cloud Infrastructure Resource Allocation and Management System". A **college project**: an academic *simulation* of cloud infrastructure management (inspired by AWS/Azure/GCP). It does **not** provision real infrastructure or process real payments.
- **Owner:** Bhuvan, student and solo developer, MacBook Pro (Apple Silicon, macOS). Comfortable with the Terminal but copy-pastes commands, so give **one command per block**.
- **Deadline:** about **1.5 days** from sign-off (around 18–19 Oct 2026). Priority is a presentable app with a **genuinely working central workflow**, not perfection.
- **Central workflow that must work end to end:** log in → open a project → request a VM (CPU, RAM, OS, region, storage, budget) → quota and capacity validated transactionally in PostgreSQL → VM created → inspect VM state → view monitoring data.
- **Primary flow of the whole system:** Customer → Project → Resource Request → Quota Check → Concurrency-Safe Allocation → Cloud Host → VM Provisioning → Storage/Network → Monitoring → Scaling/Recommendation → Billing/Payment Simulation → Feedback.

### Collaboration rules the owner expects
1. Never claim code was run or tests passed unless it actually was. Say clearly what was only syntax-checked or only reasoned about.
2. No fabricated data in the UI. Unfinished modules show honest "not connected yet" states.
3. Give terminal commands **one at a time** (multi-line pastes have broken before). A terminal running `npm run dev` is occupied; commands pasted into it do nothing. Tell the owner to open a **new tab (Cmd+T)**.
4. Do not re-ask approved decisions. Flag genuine contradictions or missing definitions instead of silently deciding.
5. Owner decided: preserve working code, do not rebuild Stage 1, do not add libraries merely for architectural purity, never reset the existing database automatically.

---

## 2. Technology and versions

**Owner's machine:** Node v26.7.0, npm 12.0.2, PostgreSQL **18.6** (Homebrew, service `postgresql@18` started with `brew services start postgresql@18`), Git. Backend port **4000**, frontend port **5173**.

**Stack:** React + TypeScript + Vite (frontend), Bootstrap 5 + custom CSS tokens, React Router, TanStack Query, Axios, React Hook Form + Zod, Recharts, Lucide React; Node.js + Express (ESM, `"type": "module"`); PostgreSQL only (no MySQL, no second DB); `pg` pool; Postman; Git/GitHub.

**Installed frontend versions (Stage 1):** react 19.3.1, react-router-dom 7.18.4, @tanstack/react-query 5.104.4, axios 1.20.0, bootstrap 5.3.8, lucide-react 1.59.0, react-hook-form 7.90.0, zod 4.6.7, @hookform/resolvers 5.9.2, recharts 3.10.1, vite 8.3.4, @vitejs/plugin-react 6.1.2, typescript **7.0.2**.

**Backend deps installed so far:** express, pg, dotenv, cors, helmet, morgan, zod. **Still to add for auth:** `jsonwebtoken`, `cookie-parser`.

**Claude's sandbox (not the owner's machine):** Ubuntu with PostgreSQL **16.15** installed via apt, cluster `16 main` on port 5432. Roles `cloudsphere_migrator` (password `mig`) and `cloudsphere_app` (password `app`), database `cloudsphere` owned by the migrator were created there for testing. The sandbox does not persist between sessions; SQL should be compatible with PostgreSQL 15+ (uses `NULLS NOT DISTINCT`).

---

## 3. Repository and environment state

**Owner's repo:** `~/Projects/cloudsphere` (moved out of Downloads). Branch `main`. First commit `49a9af2` = "Phase 0: scaffold, health endpoints, DB bootstrap".
**GitHub repo (created by owner):** https://github.com/kngp2hm5x8-droid/Cloud_Sphere — **not yet confirmed pushed.** Push with: `git remote add origin https://github.com/kngp2hm5x8-droid/Cloud_Sphere.git` then `git push -u origin main` (the owner authenticates).
**Stage 1 commit:** the owner was instructed to commit `frontend/` and the `backend/src/app.js` CORS change as "Stage 1: frontend shell, auth scaffold, CORS credentials". Unknown whether they did; ask them to run `git status --short` and `git log --oneline`.

**Tree (owner's repo):**
```
cloudsphere/
  README.md  .gitignore (ignores node_modules, .env, .env.*, !.env.example, dist)
  backend/   package.json (type: module; scripts dev=`node --watch src/server.js`, start)
    .env.example   .env (owner's; DATABASE_URL uses cloudsphere_app; contains their passwords — never commit)
    src/ server.js app.js config/env.js db/pool.js middleware/errors.js routes/health.js
         controllers/ services/ utils/ (empty .gitkeep)   tests/ (empty)
  database/ scripts/00_bootstrap.sql   migrations/ (empty in owner's repo)   seeds/ (empty)
  docs/ phase1-schema-design.md  CHECKLIST.md
  frontend/ (Stage 1, see Section 8)
```
**Backend `src/app.js`** currently: helmet, `cors({ origin: env.corsOrigin, credentials: true })` (owner applied this fix), `express.json({limit:'1mb'})`, morgan, `/api/health` router, 404 + error handler. Error envelope: `{ error: { code, message } }`. `/api/health` and `/api/health/db` work (verified by the owner).

**Database on owner's Mac:** roles `cloudsphere_migrator` (owns schema, runs migrations) and `cloudsphere_app` (DML only) and database `cloudsphere` were created by `database/scripts/00_bootstrap.sql`. The owner ran it with the placeholder passwords `YourPassword1` (migrator) and `YourPassword2` (app); development only. The bootstrap grants default privileges on tables/sequences to the app role. Schema `public` is owned by the migrator. **No application tables exist yet on the owner's machine.**

**Frontend dev:** `cd frontend && npm run dev` → http://localhost:5173. Owner verified the login page renders and the API-unreachable state works. `VITE_API_BASE_URL=http://localhost:4000/api/v1`.

---

## 4. Files delivered to the owner so far

| File | Status |
|---|---|
| `cloudsphere-phase0-scaffold.zip` | Delivered; owner unzipped, ran, committed |
| `phase1-schema-design.md` (revision 2) | Delivered; **partly superseded** — see Section 5 note on D2 |
| `cloudsphere-frontend-stage1.zip` | Delivered; owner ran it successfully |
| `HANDOFF.md` (this file) + migrations `0001`–`0006` | Delivered in `cloudsphere-handoff.zip` |

---

## 5. FINAL decisions (do not reopen)

**The owner signed off on the schema as the implementation baseline.** Defaults for A1–A12 and D1–D10, D12–D14 are approved unless overridden here.

| ID | Decision |
|---|---|
| **D1** | `MONITORING` and `SCALED` are activities/events, not VM states. Scaling = a `resource_allocation_log` row; the VM stays `RUNNING`. |
| **D2** | **RETAIN (final, owner said do not reopen).** A `STOPPED` VM keeps its `host_id` and its CPU/RAM/quota reservation. Host `allocated_*` counters and quota `used_*` counters **include STOPPED VMs**. Restart needs no new reservation. STOPPED VMs are billed **storage-only**. Termination, provisioning failure and spot preemption release reservations **exactly once**. |
| D3 | Shared `vm_configuration` rows, unique on (vcpu, ram_gb, os_image); get-or-create ad-hoc rows. |
| D4 | No extra tables: self-referencing `virtual_network` (VPC = no parent, subnet = has parent); `virtual_machine.load_balancer_id`. |
| D5 | Optional storage quota: `resource_quota.max_storage_gb` (NULL = unlimited) and `used_storage_gb`, maintained transactionally. |
| D6 | Project-level quota rows plus optional organization-level row; lock org then project. |
| **D7** | `notification_queue` is **mandatory** → **26 tables**; add `read_at TIMESTAMPTZ NULL`. |
| **D8** | Allocation is a **PL/pgSQL stored procedure**, the single owner of allocation logic; one atomic `CALL`, **no internal COMMIT/ROLLBACK**. Express only authenticates, validates, calls it, maps errors. No competing allocation algorithm anywhere else. |
| D9 | JSONB `usage_breakdown` on invoices; invoices carry `organization_id` + nullable `project_id`. |
| **D10** | Monthly range partitioning of `monitoring_log` by `logged_at`, designed into the initial migrations; **90-day retention** (provisional; whole monthly partitions dropped, so effective retention is 90 to ~120 days — A9). |
| **D11** | **Unresolved. The project notes contain no definition.** The number was a gap in Claude's own numbering (Claude had informally used it for "is Neo4j/DA3 required?"). Do not invent a meaning. Does not block implementation. |
| D12 | Deterministic spot pricing from the on-demand price and regional utilization/discount policy. |
| D13 | SLA uptime = expected vs received monitoring samples during the VM's running intervals. |
| D14 | Numbered SQL migration files + a lightweight Node migration runner. **No runner exists yet; it must be written.** |
| **A1** | Placement: if a region is given, consider only eligible hosts in it. If not, filter by `ACTIVE` status, free CPU/RAM and quota feasibility, then **prefer the lowest-carbon region**; deterministic tie-break by `host_id`. Never sacrifice capacity/quota correctness for carbon. |
| **A2** | Support both `project.monthly_budget` (non-negative, persisted) and a per-request `p_max_hourly_budget`. **Monthly projection = 730 hours × compute rate for PROVISIONING/RUNNING VMs, plus storage-only cost for STOPPED VMs and all storage volumes, plus the new request.** The hourly cap is checked separately against the new VM's hourly compute cost. Both server-side. |
| A3–A12 | Documented defaults in `docs/phase1-schema-design.md` §13 apply (A3 restart placement is now moot under D2-retain; A4 `REQUESTED` not written by allocation; A5 procedures with `INOUT`; A6 stop/start/terminate are DB procedures too; A7 counters protected from direct app-role updates; A8 missing quota row = deny, trigger creates default quota on project insert; A9 whole-partition retention; A10 allocation does not assign subnet/IP; A11 failed attempts audited by Express outside the call; A12 stopped = storage-only billing). |
| Notifications | Add `read_at`; UI read/unread must reflect persisted state. |
| Scaling | Applying a recommendation and reserving extra resources must be atomic; if capacity/quota is insufficient, do not mark the recommendation accepted. |
| Host admin | Changing host status (`DRAINING`, `MAINTENANCE`) must **not** modify allocation counters. |
| Auth | **httpOnly session cookie**; credentialed CORS and cookie settings consistent for local dev and production. |
| API | Namespace `/api/v1`; typed contract in `frontend/src/types/api.ts` (snake_case; **IDs and NUMERIC as strings**). Backend stays on port 4000; **do not remove or break `/api/health`**. |

> **IMPORTANT correction:** `docs/phase1-schema-design.md` revision 2 was written when D2 = *release*. Its §3.6, §3.8 (`region_id` on VM, `host_id` NULL while stopped, composite FK), §5, §6 (lifecycle table, "release/reserve" flags), §7 (host index predicate) and §10 (restart-failure seeds) are **superseded by D2-retain**. Under retain: no `region_id` on `virtual_machine` (region comes from the host); `host_id` NOT NULL for PROVISIONING/RUNNING/STOPPED; one flag "active" = state IN (PROVISIONING, RUNNING, STOPPED) used for both host/quota CPU/RAM and `used_vms`; stop/start change no counters. Update the document accordingly.

---

## 6. Database design (26 tables) — as implemented in migrations

Naming: snake_case singular, `User` = `app_user`. PKs are `<name>_id BIGINT GENERATED ALWAYS AS IDENTITY` (subscription_plan uses `plan_id`, app_user `user_id`). Timestamps `TIMESTAMPTZ`. State columns are `TEXT + CHECK`. FKs default `ON DELETE RESTRICT`; resources are retired by state, never deleted. Error codes use custom SQLSTATEs:

| SQLSTATE | Meaning (→ planned HTTP) |
|---|---|
| CS001 | insufficient host capacity (409) |
| CS002 | quota exceeded / no quota row (409) |
| CS003 | invalid request (400/422) |
| CS004 | invalid state transition (409) |
| CS005 | budget exceeded (409) |
| CS006 | not found (404) |
| 23505 | unique violation (409) |

**Migration files (actual numbering, written in this session):**

| File | Contents | Status |
|---|---|---|
| `0001_foundation.sql` | `pgcrypto`, `set_updated_at()` | written; **applied cleanly to a fresh PostgreSQL 16 database in Claude's sandbox** (not yet run on the owner's PG18) |
| `0002_identity_catalog.sql` | subscription_plan, cloud_region, organization, app_user (unique lower(email); role CHECK; non-admins need an org), project (`monthly_budget`) | written; **applied cleanly to a fresh PostgreSQL 16 database in Claude's sandbox** (not yet run on the owner's PG18) |
| `0003_infrastructure.sql` | carbon_profile (versioned, one current per region), cloud_host (generated `free_cpu`/`free_ram_gb`, CHECK allocated ≤ total, partial selection index), vm_configuration, virtual_network (self-FK, subnet-in-parent trigger), firewall_rule, load_balancer | written; **applied cleanly to a fresh PostgreSQL 16 database in Claude's sandbox** (not yet run on the owner's PG18) |
| `0004_compute.sql` | resource_quota (CHECK used ≤ max, incl. storage), default-quota trigger on project insert, virtual_machine (active states need a host; partial unique name/IP indexes; state-transition trigger), storage_volume, backup_snapshot, resource_allocation_log, spot_bid_request | written; **applied cleanly to a fresh PostgreSQL 16 database in Claude's sandbox** (not yet run on the owner's PG18) |
| `0005_monitoring.sql` | partitioned `monitoring_log` PK (vm_id, logged_at); `ensure_monitoring_partitions(months_back, months_ahead)` (migration calls it with 2,3 → 6 partitions); `drop_expired_monitoring_partitions(retention_days)` (non-concurrent DETACH, because `DETACH ... CONCURRENTLY` cannot run in a function) | written; applied cleanly in sandbox. Partition routing/pruning/retention tests **not yet written** |
| `0006_billing_support.sql` | billing_invoice (`UNIQUE NULLS NOT DISTINCT` on org/project/type/period), payment (simulated only), support_ticket, customer_feedback, audit_log, notification_queue (+`title`, `read_at`, `dedupe_key`), recommendation_log, sla_record (generated `is_breach`) | written; applied cleanly in sandbox |
| `0007_routines.sql` | stored procedures and triggers (Section 7) | not written |
| `0008_grants.sql` | privileges (Section 7) | not written |

All 26 tables: subscription_plan, organization, app_user, project, cloud_region, cloud_host, vm_configuration, virtual_machine, storage_volume, virtual_network, firewall_rule, load_balancer, monitoring_log, resource_allocation_log, backup_snapshot, billing_invoice, payment, support_ticket, customer_feedback, audit_log, recommendation_log, resource_quota, spot_bid_request, carbon_profile, sla_record, notification_queue.

---

## 7. Routines, locking and privileges (design to implement in 0007/0008)

**Active-state flag (D2-retain):** `active = state IN ('PROVISIONING','RUNNING','STOPPED')`. Host `allocated_cpu/allocated_ram_gb` and quota `used_vcpu/used_ram_gb/used_vms` count active VMs. `used_storage_gb` counts non-deleted volumes allocated through the routines (root volume at allocation).

**Global lock order (all routines):** (1) the VM row (existing VMs) → (2) quota rows: organization-level row first, then project row → (3) host rows in ascending `host_id`. `allocate_resource` creates a new VM so it starts at (2).

**`allocate_resource` (PROCEDURE, SECURITY DEFINER, `SET search_path = public, pg_temp`):**
`allocate_resource(p_user_id, p_project_id, p_name, p_vcpu, p_ram_gb, p_storage_gb, p_os_image, p_volume_type, p_region_id /*NULL=any*/, p_max_hourly_budget /*NULL=none*/, INOUT p_vm_id)`.
Steps: validate inputs/project/org ACTIVE → get-or-create `vm_configuration` (os_family WINDOWS if image starts with "windows", else LINUX) → hourly cost from the org's plan (`vcpu×price_per_vcpu_hour + ram×price_per_gb_ram_hour`), reject if above hourly cap (CS005) → lock org quota (if any) then project quota (`FOR UPDATE`); missing project quota = CS002; check vCPU, RAM, VM count, storage → monthly budget check via `project_projected_monthly_cost()` + new VM (730 h, plus storage price × GB) against `project.monthly_budget` (CS005) → up to 3 rounds: pick up to 5 candidate hosts unlocked (ACTIVE, region filter, enough free CPU/RAM, ordered by current carbon intensity then `host_id`), lock them `WHERE host_id = ANY(...) ORDER BY host_id FOR UPDATE`, re-select the best one that still fits; none → CS001 → update host + quota counters, insert VM as `PROVISIONING`, insert root `storage_volume` (is_root, ATTACHED, region of the host), insert `resource_allocation_log` (ALLOCATE) → return `p_vm_id`.
No `COMMIT`/`ROLLBACK`, no exception handler that swallows errors. Express retries the whole `CALL` only on SQLSTATE 40P01/40001.

**Other routines (all SECURITY DEFINER):**
- `complete_provisioning(vm_id)` PROVISIONING→RUNNING (sets `started_at`). Express calls it right after allocation (simulated provisioning); if it fails the VM honestly remains PROVISIONING.
- `stop_vm(user_id, vm_id)` RUNNING→STOPPED; **no counter change**.
- `start_vm(user_id, vm_id)` STOPPED→RUNNING; **no counter change**; fail CS001 if the retained host is `MAINTENANCE`/`DECOMMISSIONED`.
- `terminate_vm`, `fail_provisioning`, `preempt_vm` (spot only) all call **one internal function** `release_active_vm(vm_id, new_state, user_id, action)` which locks the VM, validates the old state is active and the transition is allowed, locks quota then host, decrements host and quota counters, **deletes the root volume** (state DELETED, vm_id NULL, releases `used_storage_gb`), detaches data volumes (state AVAILABLE, vm_id NULL), clears `load_balancer_id`, sets state/timestamps and writes `resource_allocation_log`. Because the active→terminal transition can happen only once under the VM lock, resources are released exactly once.
- `project_projected_monthly_cost(project_id)` — 730 h × compute for PROVISIONING/RUNNING VMs + storage price × GB for non-deleted volumes (STOPPED VMs contribute storage only).
- `estimate_vm_cost(project_id, vcpu, ram_gb, storage_gb)` for the wizard pricing step (single source of pricing logic).
- Triggers: `enforce_vm_state_transition` (already in 0004); audit trigger on `virtual_machine` state change writing `audit_log` (actor read from `current_setting('cloudsphere.user_id', true)` which the routines set with `set_config(..., true)`); low-capacity trigger on `cloud_host` counters writing `notification_queue` rows for admins with a dated `dedupe_key`.

**Privileges (A7 hardening, in 0008):** app role: `REVOKE` table-level UPDATE on `cloud_host`, `resource_quota`, `virtual_machine` (and INSERT/DELETE on `virtual_machine`), then `GRANT UPDATE` only on non-counter columns (host: `status`, `low_capacity_threshold_pct`; quota: the `max_*` columns; VM: `name`). `audit_log`: INSERT/SELECT only. Routines run as the migrator via SECURITY DEFINER. Revoke PUBLIC EXECUTE on internal helpers. (Column-level REVOKE does not override a table-level grant, so revoke at table level first.)

**Monitoring partitions:** created in 0005 via `ensure_monitoring_partitions(2, 3)`; names `monitoring_log_YYYY_MM`; bounds written as UTC (`'2026-10-01 00:00:00+00'`); no DEFAULT partition; nothing may reference `monitoring_log`; ingestion must reject timestamps outside existing partitions. Required tests: routing via `tableoid::regclass`, pruning via `EXPLAIN`, idempotent maintenance.

---

## 8. Frontend (Stage 1 — built, type-checked, builds, runs on owner's machine)

`tsc --noEmit` and `vite build` passed in Claude's sandbox; the owner ran `npm run dev` and saw the login page. Not tested against a live backend (no auth routes exist yet).

**Structure (`frontend/src`):** `app/{App,providers,router}.tsx`; `components/layout/{AppShell,Topbar,Breadcrumbs,nav.ts}`; `components/common/{PageHeader,StateViews(LoadingBlock,ErrorState,EmptyState,FeatureUnavailable),StatusBadge,StatCard,UsageMeter,ToastProvider,PlannedModule,NotFoundPage}`; `features/auth/{AuthContext,ProtectedRoute,LoginPage,AccessDeniedPage}`; `features/dashboard/DashboardPage.tsx` (real query to `/dashboard/summary`, handles loading/error/404-not-implemented); one page file per module (all `PlannedModule` placeholders except dashboard/login); `lib/{api-client,query-client,formatting}.ts`; `types/api.ts`; `hooks/usePersistentFlag.ts`; `styles/{tokens,app}.css`.

**Key behaviors:** Axios with `withCredentials`, header `X-Requested-With: CloudSphere`; `ApiError {status, code, message, details, isNetworkError, isNotImplemented}`; helpers `getData/getPage/postData/patchData/deleteData` unwrap `{data, meta?}`; 401 from a non-`/auth/` call clears the session. Session restored by `GET /auth/me` (network failure → "Cannot reach the API" screen with retry; any other failure → anonymous). Routes: `/login`, `/` (dashboard), `/projects`, `/projects/:projectId`, `/vms`, `/vms/new`, `/vms/:vmId`, `/monitoring`, `/storage`, `/networks`, `/billing`, `/recommendations`, `/spot-market`, `/sla-carbon`, `/support`, `/notifications`, `/admin/{hosts,organizations,catalog,quotas,audit}` (role-gated), `/forbidden`, `*`. Sidebar hides the Administration group for customers (backend must still enforce).

**API contract v0 (`types/api.ts`):** success `{ data, meta?: {page,page_size,total} }`; error `{ error: { code, message, details? } }`; snake_case fields; BIGINT/NUMERIC arrive as **strings** (node-postgres default); `User {user_id,email,full_name,role,organization_id}`; `DashboardSummary` is a union discriminated by `role` (`customer`: total_vms, running_vms, stopped_vms, allocated_vcpu, allocated_ram_gb, quota{...}|null, estimated_usage_charges, pending_recommendations, open_tickets; `admin`: total_hosts, total_vms, total_cpu, allocated_cpu, total_ram_gb, allocated_ram_gb, hosts_near_capacity, active_organizations, active_projects, pending_spot_requests). Currency is a single constant `CURRENCY_CODE='USD'` in `lib/formatting.ts` (placeholder).

---

## 9. Backend plan (not yet built)

- Mount `/api/v1` alongside the existing `/api/health` (keep it working).
- **Auth:** `POST /auth/login` verifies the password **in SQL** using pgcrypto (`password_hash = crypt($2, password_hash)`), avoiding a bcrypt dependency; issues a signed JWT (library `jsonwebtoken`) in an **httpOnly** cookie named `cs_session` (`SameSite=Lax`, `Secure` in production, ~8 h); `GET /auth/me`; `POST /auth/logout` clears the cookie. Env: `JWT_SECRET` (≥32 chars; generate with `openssl rand -hex 32`), `COOKIE_SECURE`. Every request re-loads the user from the DB (active flag, organization). **Never trust a submitted `organization_id`.** CSRF mitigation: reject non-GET requests lacking `X-Requested-With`, plus SameSite. CORS: `origin: CORS_ORIGIN, credentials: true`.
- **Authorization:** customers only see rows where `project.organization_id` equals their organization; admins see all; admin-only routes use a role middleware. Parameterized SQL only; validate with zod; consistent `{error:{code,message}}`; never leak DB errors (map SQLSTATEs above).
- **Endpoints (priority order):** auth; `GET /dashboard/summary`; `GET/POST /projects`, `GET/PATCH /projects/:id`; `GET /regions`, `GET /configurations`, `GET /quotas`; `GET/POST /vms`, `GET /vms/:id`, `POST /vms/:id/start|stop|terminate`, `POST /vms/estimate`, `GET /vms/:id/metrics`; `GET /monitoring/summary`; `GET /hosts` (admin); `GET /notifications/unread-count` (the topbar already polls it and shows nothing if absent). Scaling (`POST /vms/:id/scale`) and supporting modules are later; show disabled/"not implemented" states, never fake success.
- `POST /vms` flow: validate → `CALL allocate_resource(...)` → `CALL complete_provisioning(vm_id)` → return the VM with real state/host/region. `INOUT` results via `node-postgres` must be tested (pass `NULL::bigint` for the INOUT arg).
- Provide a repeatable concurrency test (`node:test`) that fires N parallel allocations at a host that fits exactly K and asserts exactly K succeed and the reconciliation query shows zero differences.

---

## 10. Seed data plan (deterministic; implemented by calling the real routines so counters stay consistent)

Seed script runs as the migrator, idempotent (skips if `Acme Robotics` exists). Development-only demo password for all accounts: `Demo@12345` (hashed with `crypt(..., gen_salt('bf', 10))`).
- **Plans:** Basic / Standard / Premium with different unit prices, SLA 99.5 / 99.9 / 99.99 and default quotas.
- **Regions:** `ap-south-1` (Mumbai), `eu-north-1` (Stockholm), `us-east-1` (Virginia). Simulated carbon: ap-south-1 v1 700 (closed) then v2 650 current; eu-north-1 30; us-east-1 380 (label as simulated).
- **Hosts:** eun-host-01 (32/128), eun-host-02 (16/64), aps-host-01 (64/256), aps-host-02 (4/8 tiny), aps-host-03 (MAINTENANCE), use-host-01 (64/256), use-host-02 (8/16, nearly filled by a seeded VM).
- **Orgs/users:** Acme Robotics (Premium), Globex Labs (Basic), Initech (Standard); `admin@cloudsphere.test` (admin), `alice@acme.test`, `bob@acme.test`, `carol@globex.test`, `dave@initech.test`.
- **Projects:** Acme `web-prod` (monthly_budget 5000, quota 32 vCPU/64 GB/10 VMs/2000 GB), Acme `analytics` (16/32/5); Globex `sandbox` (budget 100, tiny quota 4/8/2, 200 GB) with two VMs using 3/4 vCPU and 2/2 VMs so quota rejection is testable; Initech `internal-tools`.
- **Sample VMs** created through `allocate_resource`, then lifecycle calls: running, one STOPPED, one left PROVISIONING, one terminated, one spot.
- **Monitoring:** formula-driven (no `random()`), ~7 days at 5-minute intervals for a high-CPU VM, a normal VM and an idle VM; plus explicit rows in previous/current/next month for partition tests.
- Also: two recommendations (SCALE_UP, TERMINATE_IDLE), one subscription invoice (PAID) + one usage invoice (ISSUED) with JSONB breakdown and a simulated payment, one support ticket + feedback, a few notifications, one SLA record.
- **Reconciliation query (must return zero differences after seeding and after every test):** per host, `allocated_cpu/ram_gb` = sum over active VMs; per quota row, `used_*` = same sums and `used_vms` = count of active VMs; `used_storage_gb` = sum of non-deleted allocated volumes.
- **Test cases to make demonstrable:** success; insufficient capacity (e.g. 128 vCPU in ap-south-1); quota failure (Globex sandbox); budget failure; carbon preference (no region → eu-north-1).

---

## 11. Next steps (in order)

1. **Write migrations `0007`–`0008`** (Section 7; `0001`–`0006` already exist and apply cleanly), write the **migration runner** `database/scripts/migrate.js` (applies `database/migrations/*.sql` in filename order inside one transaction per file, records them in a `schema_migrations` table, uses `MIGRATOR_DATABASE_URL`; never drops anything), add `npm run migrate` / `npm run seed`. Update `.env.example` (`MIGRATOR_DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECURE`).
2. **Run them for real** against a clean database (Claude's sandbox PG16 and the owner's PG18) and fix errors. Write seeds (`database/seeds/001_demo.sql`) and run the reconciliation query.
3. **Write and run tests:** allocation success/capacity/quota/budget/invalid request, rollback after a simulated failure, stop/start/terminate release-exactly-once, concurrent allocations (invariants hold), partition routing and pruning, privilege checks (app role cannot update counters).
4. **Backend foundation + auth + endpoints** (Section 9). Test with `curl`/Postman against the running server.
5. **Frontend Stage 2** on top of the existing scaffold (do not rebuild it), running `npm run typecheck` and `npm run build` after each significant change: connect login (already coded), dashboard (already queries), projects (list with search/filter/pagination, create, edit, detail with quota meters), VM list/detail with lifecycle actions and confirm dialogs (disable invalid actions, show backend errors), the **7-step provisioning wizard** (project → configuration → storage → placement → pricing/budget estimate → review → result), monitoring charts with Recharts from `monitoring_log` (real empty/no-data states, no random values). Then supporting modules as time allows.
6. Update `docs/phase1-schema-design.md` for D2-retain; update `README.md`/`docs/CHECKLIST.md`; add API endpoint list and demo accounts to the README.
7. Test the central workflow in the real stack and report exactly what works and what remains disconnected.
8. Ensure the owner commits and pushes to GitHub regularly.

---

## 12. Gotchas learned

- The sandbox shell is `sh`: **no brace expansion** (`mkdir -p a/{b,c}` creates a literal directory). Use explicit `mkdir` lines.
- TypeScript 7 is installed; do not set `baseUrl` in `tsconfig.json` (paths work with `moduleResolution: bundler`).
- `node-postgres` returns BIGINT and NUMERIC as **strings**.
- PostgreSQL: a partitioned table's PK/unique constraints must include the partition key; `timestamptz + interval` is not immutable so it cannot be a generated column (`expires_at` is set by the app); `CREATE EXTENSION pgcrypto` works for a database owner because the extension is trusted; `DETACH PARTITION CONCURRENTLY` cannot run inside a function; column-level `REVOKE` does not override table-level grants; `FOR UPDATE` with `ORDER BY` locks in that order; do not use `SKIP LOCKED` for allocation (false "no capacity").
- psql variable quoting: `-v pw="'secret'"` then `:pw` in SQL.
- The owner's pasted commands sometimes include stray bracketed-paste characters; ask for single-line commands.
- Date references: the conversation date is Mon 19 Oct 2026; owner screenshots show Sun 18 Oct 10 PM local.
- Health endpoint `/api/health/db` exposes the Postgres version (development convenience only).
- There is no `/api/v1` yet, so the frontend dashboard shows "not available yet" and login shows "sign-in service not available" until the backend work is done.

---

## 13. Verification status summary (be honest about this)

| Item | Verified how |
|---|---|
| Phase 0 backend health endpoints | Run by the owner on macOS (works) |
| Frontend Stage 1 type check + build | Run by Claude in the sandbox (passed); runs in the owner's browser |
| Frontend ↔ backend auth | **Not tested** (backend auth not built) |
| Migrations 0001–0006 | **Applied cleanly to a fresh PostgreSQL 16 in Claude's sandbox** (26 tables, 6 monthly partitions created). Not yet run on the owner's PG18. No behavior tests yet |
| Migrations 0007–0008 (routines, privileges), seeds, runner | **Not written** |
| Concurrency/invariant tests | **Not written/run** |
| Any `/api/v1` endpoint | **Not built** |

*Open items needing the owner:* confirm Stage 1 was committed; confirm GitHub push; keep `.env` files out of Git; choose real passwords for the database roles before any demo outside their own laptop.

---

## 14. Sandbox helper (Claude's environment only)

`/home/claude/sandbox_setup.sh` restarts sandbox PostgreSQL 16, drops/recreates schema `public`, applies the grants and every `database/migrations/*.sql` as `cloudsphere_migrator` (password `mig`, host localhost). A fresh AI session will not have it; recreate it from Section 2 and the bootstrap SQL in `database/scripts/00_bootstrap.sql` (install PostgreSQL with `apt-get update && apt-get install -y postgresql`, then `pg_ctlcluster 16 main start`).
