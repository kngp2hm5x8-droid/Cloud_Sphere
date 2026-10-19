# CloudSphere delivery checklist

## Implemented in this branch

- [x] Preserve the existing PostgreSQL allocator and lifecycle procedures as the only source of allocation and reservation logic.
- [x] Add Express API routes for login/session/logout, projects, VM lifecycle and cost estimate, dashboard, regions, catalog configurations, quotas, metrics, monitoring summary, unread notification count, health, and readiness.
- [x] Add HTTP-only signed session cookies, CSRF double-submit validation, project/tenant filtering, and SQLSTATE error mapping.
- [x] Require authentication for `/api/health/db`; return only generic availability status.
- [x] Connect the existing frontend routes for projects, VM list/create/detail, and monitoring; show recent metric charts.
- [x] Add an API integration workflow test; retain existing allocation/concurrency/lifecycle safety suites.
- [x] Document setup and explicitly deferred features in `README.md`.

## Verification status for this checkout

- [x] Frontend `npm run typecheck` and `npm run build` pass.
- [x] Owner ran `node --test tests/api.test.js`: 1 test passed, 0 failed.
- [x] Owner ran backend `npm test`: 72 tests passed, 0 failed, including allocator safety, concurrency, lifecycle, monitoring partitions, privileges, seed data, and the API workflow.
- [x] Owner started the application locally and confirmed the demo workflow looks good in the browser.
- [x] The API integration test points the Express app at `TEST_DATABASE_URL`, the same isolated database reset by its fixtures.
- [x] Unread notification count response uses the existing frontend `{ count }` contract; the API integration test checks it.
- [x] Final read-only development database check found the Alice demo account, 3 Acme projects, 12 VMs, and 6,088 monitoring samples.
- [ ] Final browser recheck in the Codex environment was blocked because local servers were not running and localhost returned `ERR_CONNECTION_REFUSED`. The owner's earlier local browser check was successful.

Codex could not rerun the PostgreSQL-backed suite in its execution environment; test results above are recorded from the owner's terminal output. Frontend typecheck and production build were rerun during final review and passed.

## Explicitly deferred

- [ ] Migration 0009, durable background jobs, bounded worker, monitoring bulk ingestion, and request classifier.
- [ ] Idempotency, advanced rate limiting, backpressure, circuit breakers, full metrics subsystem, benchmarking, and OpenAPI.
- [ ] Non-core application modules remain disconnected and should continue to show truthful unavailable states.
