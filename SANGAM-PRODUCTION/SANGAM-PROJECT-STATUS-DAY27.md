# SANGAM — Project Status — Day 27
## Permissioned Blockchain Supply Chain Management System for Indian Army Evaluation

**Generated:** End of Day 27 development session
**Owner:** Deep (solo 90-day MVP sprint)
**Working directory:** `/home/claude/SANGAM-PRODUCTION`

---

## 1. PURPOSE & CONTEXT

SANGAM is a permissioned blockchain-based supply chain management system being built as a 90-day MVP sprint, targeting an Indian Army stakeholder evaluation. The goal is a working demo — not a production system — that proves the architecture and showcases capability before committing to a full production rewrite.

**Stack:** Node.js + Express + PostgreSQL, with a SQLite-compatible offline-first architecture (in-memory Maps with optional DB persistence, graceful degradation when `db` is null).

**Non-negotiable constraint:** Offline-first design throughout. The Army demo environment may not have live database access; every service must function correctly with `db = null`.

---

## 2. WHAT'S DONE (Days 1–27)

### Days 1–10 (pre-existing, inherited at session start)
Blockchain core, query optimization, offline-first operation queue, advanced sync (idempotency, conflict detection, topological sort), mesh networking (peer discovery, P2P sync, relay with TTL/loop detection).

### Days 11–18 (built in prior sessions)
- **Day 11:** Notification service
- **Day 12:** Reporting service (PostgreSQL-dependent — see Known Gap #1 below)
- **Day 13:** RBAC + command hierarchy security (military roles, permission matrix)
- **Day 14:** Auth service (login, account lockout, refresh token rotation)
- **Day 15:** Delegation & override
- **Day 16:** Audit hardening (AES-256-GCM + scheduled integrity sweep)
- **Day 17:** Docker full-stack containerization
- **Day 18:** OpenAPI 3.0.3 + Swagger UI documentation

### Days 19–25 (built this session)
- **Day 19:** Supply Chain HTTP routes — items, transfers, blockchain ledger endpoints
- **Day 20:** Compliance Reporting — chain of custody, transfer register, discrepancy report, audit export, compliance summary, CSV export
- **Day 21:** Bulk Operations — CSV item import, bulk transfer initiate/approve, bulk quantity update, CSV export
- **Day 22:** Unit Management — 8-level military hierarchy (SECTION→COMMAND), cycle detection, soft deactivation guards, reassignment
- **Day 23:** User Management — account lifecycle, role assignment (rank-gated), unit assignment, lockout/unlock, password reset
- **Day 24:** Inventory Stock-Take — session lifecycle (OPEN→COUNTING→PENDING_APPROVAL→RECONCILED), physical count recording, discrepancy detection, reconciliation with blockchain write-through
- **Day 25:** Movement Orders — logistics tracking (PLANNED→DISPATCHED→IN_TRANSIT→DELIVERED), vehicle assignment, checkpoint recording, shortage detection on delivery

### Day 26 (built this session)
- **Live Command Dashboard Service** (`dashboard.service.js`) — pure read-aggregator over all in-memory services (units, personnel, supply, transfers, movement, blockchain, stock-take, recent activity). Single-call API contract designed specifically for the upcoming React frontend. 30-second response cache. Graceful per-section degradation if any sub-service is unavailable.
- **Dashboard routes** (`dashboard.routes.js`) — `GET /api/dashboard/summary`, `POST /api/dashboard/refresh`

### Day 27 (built this session — React Dashboard UI Spike)
- **`frontend/`** — a new React 18 + Vite single-page app, the project's first UI of any kind, directly closing the LLM Council's #1 flagged risk
- **Login screen** — real integration with `POST /api/auth/login`, JWT + refresh-token storage, session restore via `GET /api/auth/me` on page reload
- **Command Dashboard screen** — seven SITREP-style widgets (Units, Personnel, Supply, Transfers, Movement, Stock-take, plus a bespoke Blockchain integrity seal) consuming `GET /api/dashboard/summary` in a single call, auto-refreshing every 30s
- **Deliberate design system** — military ops-room aesthetic (desaturated olive/brass/brick palette, condensed-display + monospace-data + humanist-UI type system), not a generic SaaS dashboard template; full rationale in `docs/day-27-react-dashboard-spike.md`
- **Component-level smoke test** (`frontend/scripts/verify-day-27.cjs`, 19 tests) using `react-dom/server` SSR rendering against mock data shaped exactly like the real Day 26 API response
- **Two further contract bugs found and fixed**: `POST /api/auth/login` returns `accessToken`, not `token`; `POST /api/auth/logout` requires `refreshToken` in the body. Both caught only by tracing the real backend source, not by trusting inferred contracts — same lesson as Day 26's `scope.ids` bug, now proven out a second time.
- **Architectural clarification documented**: `AuthService.login()` correctly requires a connected PostgreSQL database (by design — credentials must be durably persisted); this is not a violation of the offline-first promise, which applies to operational data (supply/units/transfers/movement), not initial authentication.

### Four Contract Bugs Found and Fixed This Session

**Bug #1 — `scopeFor()` contract mismatch (found during Day 26 work, affected Days 19–25):**
`RBACService.getCommandScope()` returns `{ ids: number[], codes: string[] }`, not a plain array. Every route file built in Days 19–25 (`supply.routes.js`, `compliance.routes.js`, `bulk.routes.js`, `unit.routes.js`, `user.routes.js`, `inventory.routes.js`, `movement.routes.js`) had a `scopeFor()` helper that called `.includes()` directly on the unwrapped object — this would throw `TypeError: scope.includes is not a function` on **every single authenticated request** in production. Unit tests never caught this because they used stub RBAC services that (incorrectly) returned plain arrays, masking the real contract.

**Fix:** All 7 `scopeFor()` helpers now unwrap `scope.ids` before returning. Verified via a new permanent regression test (`verify-scope-contract.js`) that boots the real Express app with the real `AuthMiddleware`/`RBACService` and a signed JWT, hitting 16 real scoped endpoints end-to-end. All return 200/403 (no 500s).

**Bug #2 — Missing shared singletons for Days 22–24 services:**
`UnitManagementService`, `UserManagementService`, and `InventoryLedgerService` were never instantiated once in `app.js` — each route file fell back to creating its own **private, isolated** instance. This meant data created via `/api/units` was invisible to `/api/users` (if it depended on unit data) and completely invisible to the new Dashboard service. Fixed by promoting all three to shared singletons in `app.js`, matching the pattern already used for `supply` and `movement`.

**Bug #3 — Frontend login client read the wrong token field (found during Day 27 work):**
The first draft of `frontend/src/api/client.js` read `result.token` from the login response. The real `AuthService._issueTokens()` returns `{ accessToken, refreshToken, refreshExpiresAt }` — `result.token` is `undefined`, which would have silently broken every login. Fixed by reading `result.accessToken`/`result.refreshToken` to match the actual backend contract.

**Bug #4 — Frontend logout call was missing a required field (found during Day 27 work):**
`POST /api/auth/logout` requires `refreshToken` in the request body and returns 400 `INVALID_REQUEST` without one. The first draft sent no body at all. Fixed by storing the refresh token at login and including it on logout.

**Why this matters:** All four bugs were silent in isolation (unit tests pass, each route "works" individually, the frontend compiles cleanly) but would have caused real production failures during an actual Army demo — Bugs #1–2 would 500 on every API call; Bugs #3–4 would silently break login/logout. Each was caught only because building real cross-service or cross-stack consumers (the dashboard, then the React client) exposed contracts that isolated testing couldn't. Lesson recorded in Key Learnings below — and notably, it held true a second time on Day 27 after being explicitly learned on Day 26, underscoring that this needs to be a standing practice, not a one-time fix.

---

## 3. CURRENT STATE — VERIFIED METRICS

```
Backend source code:  11,681 lines  (backend/src/)
Backend services:      16 files     (backend/src/services/)
Backend routes:        15 files     (backend/src/routes/)
Backend verify scripts:17 files     (backend/scripts/verify-*.js)
Frontend source code:  ~12 files    (frontend/src/) — React 18 + Vite
Frontend verify script: 1 file      (frontend/scripts/verify-day-27.cjs)
```

### Test Results (all passing, zero failures)

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
| **Backend Scope Contract Guard (HTTP integration)** | 16 | ✅ |
| **27 — Frontend component smoke test (SSR)** | 19 | ✅ |
| **TOTAL** | **869** | **✅ 0 failures** |

### Full-stack integration test (Day 27, ephemeral — not committed)
Booted the real Express backend, a real `vite preview` server, and a real
`vite dev` server in-process with a signed JWT. Confirmed: backend serves
real dashboard data (200), the built frontend's `index.html` serves
correctly, and both `vite dev`'s and `vite preview`'s proxy configs
correctly forward `/api/*` to the backend (tested empirically, not assumed).

---

## 4. API SURFACE (Mounted Routers)

| Prefix | Router File | Day Built |
|---|---|---|
| `/api/health` | health.routes.js | Pre-existing |
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

---

## 5. KNOWN GAPS / NOT YET DONE

1. **Day 12 `ReportingService` is PostgreSQL-only.** It queries `db.query(...)` directly and will show empty/unavailable data when running offline. This is by design (it predates the Days 19–25 in-memory services) but means there are now **two parallel reporting layers**: the old DB-backed one (Day 12) and the new live in-memory one (Day 26 dashboard). For the Army demo (likely offline), only the Day 26 dashboard should be used/shown. Future cleanup: either retire Day 12's service or make it read from the same in-memory services.

2. **No production static-file serving wired up.** The backend doesn't yet serve `frontend/dist/`. A Day 28+ task: either an Express static mount or an nginx reverse-proxy layer in `docker-compose.yml`.

3. **Frontend has no automatic token refresh on 401.** Session simply requires re-login after the 8-hour access-token expiry. The backend's refresh-token rotation (Day 14) exists but isn't wired into the client yet.

4. **Frontend is single-view only** — no client-side routing, no drill-down screens (e.g., clicking the SUP widget to see the full item list). Acceptable for a one-screen spike; will need a router for the Days 28–60 vertical-slice build-out.

5. **No named Army stakeholder identified.** Flagged by the council as a collective blind spot — an internal champion is needed before/alongside the technical demo.

6. **IP and classification exposure risk** — identified by the council, not yet addressed. No action taken yet on data classification or export-control review of the codebase itself.

7. **Movement Orders are not yet linked transactionally to Transfers.** A Movement Order can reference a `transferId`, but there's no enforced consistency check (e.g., a Movement Order's items quantities are not validated against the linked Transfer's quantity). Acceptable for MVP demo; flag for production hardening.

8. **No automated end-to-end (Jest/Supertest/Playwright) test suite — verification relies on custom Node scripts run manually** (`verify-day-N.js` on the backend, `verify-day-27.cjs` SSR-based on the frontend, since no browser is available in the development environment). This works but doesn't integrate with standard CI tooling and the frontend test cannot cover real DOM events, click handlers, or visual rendering. Acceptable for solo MVP sprint; revisit if the team grows or a CI pipeline with a real browser becomes available.

---

## 6. KEY LEARNINGS & PRINCIPLES (Updated)

- **No UI = critical demo gap** (LLM Council, Day 21 verdict): the absence of any UI is the single highest-priority risk before Army stakeholder demonstration.
- **Offline-first is non-negotiable for the demo.** Day 12's PostgreSQL-dependent reporting service taught this lesson; Day 26's dashboard was built specifically to avoid repeating it.
- **Stub services in unit tests can hide real integration bugs.** Both bugs found on Day 26 (`scopeFor()` contract mismatch, missing shared singletons) were invisible to 795 passing unit tests because those tests used hand-rolled stubs that didn't match the real service contracts. **New rule going forward: any cross-service wiring change must be validated with at least one real end-to-end HTTP test (real Express app + real JWT + real middleware), not just service-level unit tests with stubs.** `verify-scope-contract.js` is now a permanent fixture for this purpose.
- **This lesson held a second time on Day 27.** Building the first real *external* consumer of the backend (the React client) surfaced two more contract bugs neither 850 backend tests nor careful code review had caught: `POST /api/auth/login`'s real field is `accessToken` (not `token`), and `POST /api/auth/logout` requires a `refreshToken` body that nothing had been storing. Both were caught only by reading the actual `auth.service.js`/`auth.routes.js` source line-by-line while wiring the client — not by inferring the contract from naming conventions. **Whenever a new consumer (frontend, second backend, mobile app) is built against an existing API, trace the real implementation for every field name before writing the client — never assume.**
- **Don't assert tooling behavior without testing it.** Initial Day 27 drafts assumed `vite preview` doesn't apply the dev-server proxy config (a plausible-sounding but uninvestigated claim). Testing it directly showed it actually does. Lesson: when documenting *why* something works a certain way, verify empirically rather than writing a confident-sounding guess into a comment or doc.
- **Shared singleton services must be wired in `app.js`, not left to each route's fallback `|| new Service(...)`.** The fallback pattern is a useful safety net for standalone testing, but if a route's shared instance is never actually passed in production wiring, you silently get isolated, unsynchronized state. Audit `app.js` whenever a new in-memory service is added.
- **Test isolation matters:** Shared-state contamination between test groups caused cascading failures in earlier days (Day 24 lesson, still valid). Properly isolated test groups with valid seed data are required.
- **CSV parsing edge cases:** Header-only CSVs must return `NO_DATA_ROWS`, not a parse error.
- **Valid supply categories:** `AMMO, RATIONS, FUEL, MEDICAL, EQUIPMENT, COMMS, VEHICLE_PARTS, CLOTHING, ENGINEERING, GENERAL` — `ARMS` is **not valid** (caused a cascading test failure on Day 24 verify script before being caught and fixed).
- **Rate limiting on parallel LLM calls** (from the LLM Council runner artifact): sequential `for...of` with exponential backoff (8s → 16s → 32s) is the correct pattern for the council methodology, not parallel calls.
- **Architecture is conditionally sound** (LLM Council verdict): the council rated the technical foundation strong but contingent on the UI gap being closed and a stakeholder champion being identified.

---

## 7. LLM COUNCIL ROADMAP (Binding Verdict, Day 21 Session)

Per the five-advisor LLM Council session (Contrarian, First Principles, Expansionist, Outsider, Executor), the agreed roadmap is:

- **Days 22–60:** Complete remaining critical APIs (✅ done — Days 22–26), then spike React UI (✅ done — Day 27), then build the vertical-slice demo
- **Days 60–90:** Polish, demo scripting, stakeholder presentation prep
- **Open action item:** Identify a named Army stakeholder/internal champion (still open)
- **Risk to monitor:** IP and classification exposure (still open, not yet addressed)

**Immediate next step per the council roadmap: Day 28 onward — build out the vertical-slice demo.** Candidates for the first slice: (a) wire the dashboard's SUP widget to a drill-down item list using the existing `/api/supply/items` endpoint, (b) add a login→dashboard→logout flow walkthrough script for a live demo, (c) wire production static-file serving so the whole stack runs from one `docker-compose up`.

---

## 8. HOW TO RESUME

1. Unzip `SANGAM-PRODUCTION-DAY27.zip` into a working directory
2. Backend: `npm install` (from project root)
3. Frontend: `cd frontend && npm install`
4. Run the full regression suite to confirm a clean baseline:
   ```bash
   # from project root
   npm run test:all              # backend Days 11-26 + scope contract guard
   npm run test:frontend         # frontend component smoke test
   ```
   Expect 869/869 passing, 0 failures.
5. To run the full stack locally:
   ```bash
   # terminal 1 — backend (needs PostgreSQL; see docker-compose.yml)
   npm start
   # terminal 2 — frontend dev server (proxies /api to :3000)
   npm run frontend:dev
   ```
   Then open `http://localhost:5173`.
6. Continue with **Day 28 onward: vertical-slice demo build-out** per the LLM Council roadmap (see Section 7 for candidate first slices).
7. Re-read `skills/llm-council/SKILL.md` if another council session is warranted before continuing (e.g., before deciding the exact shape of the Days 28–60 vertical-slice phase).

---

## 9. FILE MANIFEST (This Session's Additions)

### New services (`backend/src/services/`)
- `supply-chain.service.js` (Day 19, pre-existing from prior turn, routes/verify added this session)
- `compliance.service.js` (Day 20)
- `bulk-operations.service.js` (Day 21)
- `unit-management.service.js` (Day 22)
- `user-management.service.js` (Day 23)
- `inventory-ledger.service.js` (Day 24)
- `movement-order.service.js` (Day 25)
- `dashboard.service.js` (Day 26)

### New routes (`backend/src/routes/`)
- `supply.routes.js`, `compliance.routes.js`, `bulk.routes.js`, `unit.routes.js`,
  `user.routes.js`, `inventory.routes.js`, `movement.routes.js`, `dashboard.routes.js`

### New verify scripts (`backend/scripts/`)
- `verify-day-19.js` through `verify-day-26.js`
- `verify-scope-contract.js` (permanent HTTP integration regression guard)

### New docs (`docs/`)
- `day-20-compliance-reporting.md`
- `day-26-live-dashboard.md`
- `day-27-react-dashboard-spike.md`

### New frontend (`frontend/`) — Day 27, entirely new directory
- `package.json`, `vite.config.js`, `index.html`, `.env.example`, `.gitignore`, `README.md`
- `src/main.jsx`, `src/App.jsx`
- `src/api/client.js` — fetch wrapper, JWT/refresh-token storage
- `src/pages/LoginPage.jsx`, `src/pages/DashboardPage.jsx`
- `src/components/Widget.jsx`, `BlockchainSeal.jsx`, `ActivityFeed.jsx`, `TopBar.jsx`
- `src/styles/global.css` — full design token system
- `scripts/verify-day-27.cjs` — SSR component smoke test (19 tests)

### Modified files
- `backend/src/app.js` — wired all new routers, promoted `units`/`users`/`inventory` to shared singletons, fixed `scopeFor()` calls
- `backend/src/services/rbac.service.js` — added `units:read`/`units:write`/`units:admin` permissions to the role matrix
- 7 backend route files — fixed `scopeFor()` to unwrap `{ids, codes}` correctly
- `package.json` (root) — extended test scripts through Day 26 + scope-contract + frontend; added `frontend:dev`/`frontend:build` convenience scripts

---

**End of Day 27 status. Development paused per instruction. Project zipped for handoff.**
