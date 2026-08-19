# SANGAM — Project Context Document — Day 30
## Permissioned Blockchain Supply Chain Management System · Indian Army Evaluation Sprint

**Sprint:** 90-day solo MVP  
**Session End:** Day 30 of 90  
**Total Tests:** 935 passing, 0 failing  
**Owner:** Deep

---

## 1. WHAT SANGAM IS

A permissioned blockchain-based supply chain management system designed for Indian Army evaluation. The goal is a working demo compelling enough to secure approval for a full production rewrite.

**Core promise:** Every supply transaction is cryptographically chained. An Army officer can verify the entire ledger's integrity with a single API call. This is SANGAM's differentiator from conventional supply systems.

**Architecture constraint:** Offline-first throughout. The Army demo environment may not have live database connectivity — every operational service must function correctly with `db = null`. The blockchain ledger, all in-memory supply/unit/user/movement state, the dashboard, and the frontend work completely offline. Only initial authentication (`POST /api/auth/login`) requires PostgreSQL, which is correct by design (credentials must be durably persisted).

---

## 2. TECHNOLOGY STACK

```
Backend:   Node.js 22 + Express 5 + PostgreSQL (SQLite-compatible)
Frontend:  React 18 + Vite 5
Crypto:    AES-256-GCM audit log encryption, JWT auth, bcrypt passwords
Container: Docker multi-stage build (frontend + backend in one image)
Docs:      OpenAPI 3.0.3 + Swagger UI at /api/docs
Testing:   Custom Node.js verify scripts (no Jest/Supertest — by design for speed)
```

**Working directory:** `/home/claude/SANGAM-PRODUCTION`

---

## 3. COMPLETE BUILD STATE — DAYS 1–30

### Days 1–10 (pre-existing, not built this sprint)
Blockchain core, query optimisation, offline-first operation queue, advanced sync (idempotency, conflict detection), mesh networking (P2P sync, relay, TTL/loop detection).

### Days 11–18 (built in prior sessions)
| Day | What | Key Files |
|-----|------|-----------|
| 11 | Notification service | `notification.service.js` |
| 12 | Reporting service (DB-only) | `reporting.service.js` |
| 13 | RBAC + command hierarchy | `rbac.service.js` |
| 14 | Auth (login, lockout, JWT refresh) | `auth.service.js`, `auth.routes.js` |
| 15 | Delegation + permission override | `delegation.service.js` |
| 16 | Audit hardening AES-256-GCM | `audit-hardening.service.js` |
| 17 | Docker full-stack containerisation | `Dockerfile`, `docker-compose.yml` |
| 18 | OpenAPI 3.0.3 + Swagger UI | `docs.routes.js`, `generate-openapi.js` |

### Days 19–30 (built this session)
| Day | What | Key Files |
|-----|------|-----------|
| 19 | Supply Chain HTTP routes | `supply-chain.service.js`, `supply.routes.js` |
| 20 | Compliance Reporting | `compliance.service.js`, `compliance.routes.js` |
| 21 | Bulk Operations (CSV import/export) | `bulk-operations.service.js`, `bulk.routes.js` |
| 22 | Unit Management (8-level hierarchy) | `unit-management.service.js`, `unit.routes.js` |
| 23 | User Management | `user-management.service.js`, `user.routes.js` |
| 24 | Inventory Stock-Take | `inventory-ledger.service.js`, `inventory.routes.js` |
| 25 | Movement Orders (logistics tracking) | `movement-order.service.js`, `movement.routes.js` |
| 26 | Live Command Dashboard API | `dashboard.service.js`, `dashboard.routes.js` |
| 27 | React Dashboard UI spike | `frontend/src/` (full app) |
| 28 | Production static file serving | Dockerfile + app.js static block |
| 29 | Supply item drill-down (first vertical slice) | `ItemListPage.jsx`, `Widget.jsx` interactive |
| 30 | Alert & Escalation Engine | `alert-escalation.service.js`, `alert.routes.js` |

---

## 4. COMPLETE API SURFACE (16 Routers)

| Route Prefix | File | Day |
|---|---|---|
| `/health` | health.routes.js | Pre-existing |
| `/api/auth` | auth.routes.js | 14 |
| `/api/rbac` | rbac.routes.js | 13 |
| `/api/notifications` | notification.routes.js | 11 |
| `/api/reporting` | reporting.routes.js | 12 |
| `/api/delegation` | delegation.routes.js | 15 |
| `/api/docs` | docs.routes.js | 18 |
| `/api/supply` | supply.routes.js | 19 |
| `/api/compliance` | compliance.routes.js | 20 |
| `/api/bulk` | bulk.routes.js | 21 |
| `/api/units` | unit.routes.js | 22 |
| `/api/users` | user.routes.js | 23 |
| `/api/inventory` | inventory.routes.js | 24 |
| `/api/movement` | movement.routes.js | 25 |
| `/api/dashboard` | dashboard.routes.js | 26 |
| `/api/alerts` | alert.routes.js | 30 |

---

## 5. VERIFIED TEST COUNTS

| Day | Tests | Status |
|---|---|---|
| 11 | 61 | ✅ |
| 12 | 38 | ✅ |
| 13 | 73 | ✅ |
| 14 | 48 | ✅ |
| 15 | 52 | ✅ |
| 16 | 47 | ✅ |
| 17 | 44 | ✅ |
| 18 | 45 | ✅ |
| 19 | 62 | ✅ |
| 20 | 55 | ✅ |
| 21 | 43 | ✅ |
| 22 | 56 | ✅ |
| 23 | 65 | ✅ |
| 24 | 51 | ✅ |
| 25 | 55 | ✅ |
| 26 | 39 | ✅ |
| 28 | 9 | ✅ |
| 30 | 37 | ✅ |
| Scope Contract Guard (HTTP/e2e) | 16 | ✅ |
| Frontend Day 27 (SSR components) | 19 | ✅ |
| Frontend Day 29 (SSR + real backend) | 22 | ✅ |
| **TOTAL** | **935** | **✅ 0 failures** |

---

## 6. ARCHITECTURE — CRITICAL FACTS FOR NEXT DEVELOPER

### Services are shared singletons in `app.js`
Every service is instantiated ONCE in `app.js` and injected into routes. Each route file has a fallback `|| new Service(db, ...)` for standalone testing, but in production the singleton is always used. If you add a new service, **register it in `app.js` and pass it to the route factory** — do not rely on the fallback.

### `getCommandScope` returns `{ids, codes}` not a plain array
`RBACService.getCommandScope(unitId, db)` returns `{ ids: number[], codes: string[] }`. All route files' `scopeFor()` helper correctly unwraps `scope.ids` since Day 26. If you add a new route that calls this, unwrap `.ids` before calling `.includes()`. The `verify-scope-contract.js` integration test guards against regression.

### Valid supply categories (10 total)
`AMMO, RATIONS, FUEL, MEDICAL, EQUIPMENT, COMMS, VEHICLE_PARTS, CLOTHING, ENGINEERING, GENERAL`  
`ARMS` is **not valid** and will return `INVALID_CATEGORY`. This has caused cascading test failures before.

### `AuthService.login()` requires PostgreSQL
Auth requires a live DB connection — this is correct by design, not a gap. The offline-first promise covers operational data (supply, transfers, units, movement) not initial credential verification. Run with `docker-compose up` which provisions Postgres automatically.

### Frontend proxy
Vite dev server (`npm run frontend:dev`) proxies `/api/*` to `localhost:3000`. Production: the built `frontend/dist/` is served directly by Express (conditional on `frontend/dist/index.html` existing). The Dockerfile builds the frontend in a dedicated stage and copies the output into the final image. One container, one port.

### Alert escalation timing
`AlertEscalationService.scan(scopeIds)` is designed to be called periodically (e.g. every 30s). With `escalationMins=0` (test mode), alerts escalate in the same scan they're raised. In production, use `escalationMins=15` (15-minute grace period before escalation).

---

## 7. KNOWN GAPS (ordered by impact)

### 1. No named Army stakeholder identified (CRITICAL STRATEGIC RISK)
LLM Council verdict: this is an existential risk to the project. A technical demo without an internal Army champion to receive it is wasted effort. **This must be addressed in parallel with continued development.**

### 2. Alert engine has no HTTP polling loop
`AlertEscalationService.scan()` exists and is tested but is never called automatically — it requires a `POST /api/alerts/scan` call to trigger. For a real demo, you need either a `setInterval` in `server.js` or a UI button that polls periodically. Currently the dashboard widget shows last-known alert counts from the in-memory state set during the last manual scan.

### 3. No token refresh in the frontend
The React client stores `accessToken` (8h expiry) but does not auto-refresh using `refreshToken` when it expires. Session simply shows an auth error after 8 hours. The backend refresh endpoint exists (`POST /api/auth/refresh`) — wire it into `api/client.js`'s request wrapper.

### 4. Day 12 `ReportingService` is DB-only
It queries PostgreSQL directly and shows nothing when offline. The Day 26 `DashboardService` is the correct replacement for offline demos. The Day 12 service should either be retired or repointed at the in-memory services.

### 5. No client-side router yet
The React app uses simple `useState`-based view switching. Works for the current 2 screens (Dashboard + ItemList). Needs `react-router-dom` once a third screen is added (e.g. transfer list, user management, alert detail).

### 6. IP and classification exposure risk
Flagged by LLM Council but not yet acted on. Review the codebase for any inadvertent disclosure of sensitive military logistics information before sharing externally.

### 7. Docker build not tested end-to-end
`docker` is unavailable in the development sandbox. The Dockerfile's multi-stage build was validated by manually replicating each step, but an actual `docker build && docker-compose up` should be run before the demo. See `docs/day-28-production-static-serving.md`.

### 8. Frontend drill-downs beyond ItemList not yet built
Days 29 covered supply items. Transfer register, unit hierarchy, user roster, alert detail, movement tracker — all exist as backend APIs but have no frontend screens yet. This is the Days 31–60 vertical-slice work.

---

## 8. HOW TO RUN

### Local development (requires Docker for PostgreSQL)

```bash
# Start the database
docker-compose up -d db

# Start backend
npm install
npm start             # backend on :3000

# Start frontend (in a second terminal)
npm run frontend:dev  # frontend on :5173 (proxies /api to :3000)
```

### Run all tests

```bash
npm run test:all            # backend days 11-30 + scope contract
npm run test:frontend       # frontend component smoke tests
cd frontend && node scripts/verify-day-29.cjs   # frontend + real backend
```

### Full stack in one container (requires Docker)

```bash
docker-compose build
docker-compose up
# Browse to http://localhost:3000
```

---

## 9. LLM COUNCIL ROADMAP (Day 21 verdict, binding)

- **Days 22–30:** Complete remaining critical APIs ✅ DONE
- **Days 31–60:** Vertical-slice demo — build out the full user journey with UI at every step:
  - Transfer initiation → approval → blockchain record (the core workflow)
  - Alert acknowledgement flow (Day 30 backend done, needs frontend)
  - Unit/user management UI screens
  - Movement order tracker
- **Days 60–90:** Polish, demo scripting, stakeholder presentation

**Immediate next session:** Wire `POST /api/alerts/scan` to a periodic poller (either `setInterval` in `server.js` or a frontend timer), then build the transfers vertical slice — the most compelling demo path (create a transfer request → approve it → see it appear as a blockchain block → blockchain verified).

---

## 10. BUGS FOUND AND FIXED THIS SESSION (4 total)

All 4 were invisible to unit tests with stubs and only surfaced when real cross-service or cross-stack consumers were built.

| # | Bug | Found | Fix |
|---|-----|-------|-----|
| 1 | `scopeFor()` called `.includes()` on `{ids,codes}` object → TypeError on every auth'd request | Day 26 | Unwrap `.ids` in all 7 route files; permanent `verify-scope-contract.js` HTTP test added |
| 2 | `UnitManagementService`, `UserManagementService`, `InventoryLedgerService` never wired as singletons in `app.js` — each route had isolated private instance | Day 26 | Promoted all 3 to shared singletons in `app.js` |
| 3 | Frontend login read `result.token` — real `AuthService` returns `result.accessToken` | Day 27 | Fixed `api/client.js` to read `accessToken` + `refreshToken` |
| 4 | Frontend `logout()` sent no body — real route requires `{ refreshToken }` in body | Day 27 | Store refreshToken at login, send it on logout |

**Recurring pattern:** Test stubs that return the wrong shape (plain arrays instead of `{ids,codes}`) hide real contract bugs. Standing rule: any new cross-service wiring must be validated with at least one real HTTP-level test (real app + real JWT), not just service-unit tests with stubs.
