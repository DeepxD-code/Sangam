# SANGAM — Day 60 Handoff

## Status: ✅ Demo-readiness checkpoint — 1,856 tests, 0 failures

This is a checkpoint, not a record that a real demo has happened. See
**Outstanding Risk** at the end — unchanged from Day 55.

---

## Sprint 56–60 Summary

| Day | Feature | Tests Added |
|-----|---------|-------------|
| 56 | Compliance page — chain of custody, discrepancy report, transfer register, audit export, summary (surfaces Day-20 ComplianceService, zero frontend surface before this) | 40 |
| 57 | Delegation & Emergency Override page (surfaces Day-15 DelegationService, zero frontend surface before this) | 33 |
| 58 | Notification digest + preferences + **critical fix**: notification.routes.js was silently disconnected from the shared NotificationService since Day 42 | 17 + 4 (contract) |
| 59 | Dashboard tour-prompt + ReportsPage DB-availability warning + **critical fix**: no working path existed to seed a real running server with demo data | 11 |
| 60 | RBAC edge-case tests (found + fixed a 3rd permission-matrix documentation error) + Demo Readiness Package | 13 + 22 (contract) |

**Framing note, carried forward from Day 55 and still true:** the Day 55
handoff explicitly named Day 60 "Demo Day" and Days 61–90 "stakeholder
feedback iteration." No stakeholder session has occurred. Day 60 here
means demo-*readiness* — rehearsed, packaged, regression-clean — not a
completed demo. Days 61–65 will continue as concrete, verifiable
hardening, the same discipline Days 52–55 already established, not
invented feedback.

**A pattern across all three "new page" days (56/57/58):** each surfaced
a fully-built backend capability that had existed for weeks to months
with zero frontend surface — a real, recurring risk category for this
project (backend-complete, invisible to any actual user). Worth keeping
in the "grounding checks" habit for any future day: scan for services
with no corresponding UI before assuming new work is needed.

---

## Day 56 — Compliance Page

Surfaced ComplianceService (built Day 20, fully tested, zero frontend
surface until now): chain of custody per item, discrepancy report
(quantity vs. blockchain-derived expected value), a live-browsable
transfer register (distinct from ReportsPage's CSV-only version), and
audit export — which turned out to matter more than expected: it's the
**only** UI path the AUDITOR role has to audit data at all, since
AuditLogPage is hard-gated to SYSTEM_ADMIN specifically.

**Key finding:** `reports:advanced` is not a clean rank-level cutoff —
LOGISTICS_OFFICER (rank 6) has it, OFFICER (rank 7) does not, despite
outranking. The client never receives a permissions array (only `role`
string + `rankLevel` number), so CompliancePage gates its sidebar link
with a rough `rankLevel >= 4` heuristic only, and each of its 5 tabs
independently handles a real 403 from the backend — the backend is
always the actual authority, matching the existing ReportsPage pattern.

Files: `frontend/src/pages/CompliancePage.jsx` (new), `client.js` (+6
methods), `App.jsx` (+route), `Sidebar.jsx` (+nav link).

---

## Day 57 — Delegation & Emergency Override Page

Surfaced DelegationService (Day 15), same zero-frontend-surface pattern.
Two mechanisms: **delegation** (planned, time-boxed handoff of a
permission the delegator already holds — server enforces you can't
delegate what you don't have), and **override** (emergency, self-issued,
single-use, logged as a SECURITY event immediately, reviewed after the
fact by AUDITOR/SENIOR_OFFICER/COMMANDER/SYSTEM_ADMIN).

Four tabs: My Delegations, Granted By Me (+ New Delegation modal),
Emergency Override, Review Queue. Unlike Compliance, this page has **no**
sidebar rank gate — creating/viewing delegations and issuing overrides
is open to every role; only the Review Queue tab needs `audit:read`,
handled the same per-tab-403 way as Compliance.

**Note:** there is no `GET /delegation/overrides/mine` — a user cannot
see their own override history through the API, only issue new ones.
Real, current backend limitation, not something this page works around.

Files: `frontend/src/pages/DelegationPage.jsx` (new), `client.js` (+8
methods), `App.jsx`, `Sidebar.jsx`.

---

## Day 58 — Notification Digest & Preferences + CRITICAL FIX

Extended `NotificationBell.jsx` with a 3-way view switch (🔔 recent / 📊
digest / ⚙ preferences) rather than a new page, since it's inherently
part of the existing dropdown.

**The bug (pre-existing since Day 42, not introduced by Day 58):**
`notification.routes.js`'s factory function declared only
`(db, sharedAudit)`, silently ignoring the shared `NotificationService`
instance `app.js` has always passed as a third argument — JavaScript
does not error on unused extra call arguments. The routes quietly
constructed their **own**, separate `NotificationService`. Every other
service that creates notifications (SupplyChainService,
MovementOrderService, InventoryLedgerService, DelegationService, ...)
was correctly wired to the shared instance. Practical effect: **any
notification triggered by a real domain action — low stock, transfer
approved/rejected, etc. — never reached the HTTP notification endpoints,
for any user, since Day 42.** `GET /notifications`, `/unread-count`,
`/digest` were silently disconnected from real system events the entire
time. Preference reads/writes happened to still "work" in isolation
(they don't depend on cross-service data), which is exactly why this
went unnoticed for so long.

**Found because** Day 58's verify script was the first test to actually
cross the boundary: create a notification via the shared instance (the
same way every other service does it) → read it back over real HTTP.

**Fixed** by declaring and using `sharedNotifications` as a third
parameter, matching the already-correct pattern in
delegation/reporting/supply/compliance routes.js — all four
independently confirmed correct via direct signature check, confirming
this was isolated to notification.routes.js alone.

**Permanent guard added:** `verify-notification-wiring-contract.js`.

---

## Day 59 — Tour Prompt + Reports DB-Awareness + CRITICAL FIX

Three items, but #2 and #3 were substantially reprioritized after
grounding checks surfaced bigger real issues than originally scoped.

**1. Dashboard tour-prompt** — `DashboardPage.jsx` already received
`onStartTour` via `pageProps` but never consumed it. Added a dismissible
banner.

**2. ReportsPage DB-availability warning** (reprioritized from "CSV
column customization") — all four CSV export types query Postgres
directly and return `available:false` with empty rows when `db` is
null, this app's **primary, default** mode. ReportsPage gave zero
indication of this — clicking Export in offline mode silently downloaded
a 0-byte file. Fixed by checking `GET /health` once on mount (already
existed, already reports `db.connected`) and disabling/labeling export
buttons accordingly, rather than building column-picker UI for a feature
silently broken in the primary demo mode.

**3. A real path to seed a running server** (reprioritized and expanded
from "demo-data reset"). **Major finding:** there was no working path at
all to get demo data into a real, browser-accessible running server.
`npm run seed:demo` builds its own disposable service instances — always
`db=null`, even with Postgres available — that vanish when the script
exits; it can never affect a separately-running `npm start` process,
since Node processes don't share memory, and services write-through to
Postgres but never hydrate from it on construction. `server.js` had zero
seeding hook of any kind.

**Fixed:** `server.js` now has an opt-in `SEED_DEMO_DATA=true` startup
hook calling `seedDemoData(app.locals.services)` directly — the actual
live instances every route serves from. `seedDemoData()` itself was made
idempotent (detects prior seeding via the brigade's `UNIT_CODE_EXISTS`,
skips cleanly rather than duplicating). Documented in `.env.example`.
"Reset the demo" = restart the process.

**⚠ Caveat, stated plainly:** the `server.js` + `SEED_DEMO_DATA`
integration is **not end-to-end tested** — this sandbox has no real
Postgres reachable (network policy only permits npm/pip/github domains),
and `server.js` unconditionally requires a live DB connection to boot.
Verified via code review, syntax check, and confirming every service the
seeder touches exists on `app.locals.services` with matching method
signatures — but genuinely not run for real. **Verify
`SEED_DEMO_DATA=true` against a real Postgres (e.g. via docker-compose)
before relying on it for the actual demo.**

---

## Day 60 — RBAC Edge Cases + Demo Readiness Package

**A third permission-matrix documentation error**, found while writing
this day's tests: Day 56/57 comments claimed `SENIOR_OFFICER` holds
`audit:export`. It only holds `audit:read` — a different,
overlapping-but-not-identical permission. `audit:export` = `{AUDITOR,
COMMANDER, SYSTEM_ADMIN}` only (3 roles); `audit:read` = `{AUDITOR,
SENIOR_OFFICER, COMMANDER, SYSTEM_ADMIN}` (4 roles). Neither Day 56 nor
57's tests happened to exercise SENIOR_OFFICER against either
permission specifically, so it went uncaught until this day's
systematic sweep.

**Lesson applied going forward:** stop hand-transcribing the permission
matrix into comments. `verify-rbac-contract.js` (new permanent guard)
computes `RBACService.ROLE_PERMISSIONS` **programmatically** rather than
trusting a hardcoded snapshot — it will self-correct if the matrix ever
changes, rather than silently going stale the way three separate
comments already did across two days. It also asserts structural
invariants (no typos, SYSTEM_ADMIN holds all 25 permissions, unique rank
levels), computes the full non-monotonic permission set live (7 total),
tests the specific SENIOR_OFFICER gap directly, sweeps
`reports:advanced` across all 9 roles (not just the 2 that happened to
get used before), and covers JWT edge cases that had zero prior
coverage anywhere (missing / expired / malformed / tampered signature /
wrong secret).

**Demo Readiness Package:**
- `verify-day-60.js` — extends Day 55's original proven golden-path
  smoke test with everything built since (Compliance, Delegation,
  Notification digest, Day 59 health check), one continuous narrative,
  13/13 passing. This is the tested basis for the runbook below, not an
  untested narrative.
- `SANGAM-DEMO-RUNBOOK.md` — startup instructions for both deployment
  paths, login credentials, the proven step-by-step demo flow, a
  rehearsal checklist, and the outstanding risk restated plainly.
- `SANGAM-STAKEHOLDER-ONE-PAGER.md` — external leave-behind: what it is,
  what it does, what it does **not** do yet (stated honestly), why it's
  built this way, and a soft next-step ask rather than a pitch for a
  specific deployment.

---

## Current Test Suite

`npm run test:all` — 52 scripts, 1,856 assertions, 0 failures:
- Day 11–60 feature verify scripts (one per day)
- `verify-scope-contract.js`, `verify-actor-attribution-contract.js` (Day
  46-era permanent guards)
- `verify-notification-wiring-contract.js` (Day 58)
- `verify-rbac-contract.js` (Day 60)

---

## Architectural Invariants (unchanged, still enforced by tests)

- `RBACService.getCommandScope()` returns `{ids, codes}` — always unwrap `.ids`
- Actor attribution always uses `req.user.userId`, never `req.user.id`
- `InventoryLedgerService` constructor: `(db, supplyChain, audit, notifications)`
- `AlertEscalationService.scan()` not `scanAll()`
- `UnitManagementService.getUnitIds()` — never access `._units` directly
- `normalizeUser()` in App.jsx ensures `userId` is always present
- Valid supply categories: AMMO, RATIONS, FUEL, MEDICAL, EQUIPMENT, COMMS, VEHICLE_PARTS, CLOTHING, ENGINEERING, GENERAL — `ARMS` is invalid
- `app.locals.services.alerts` is the single AlertEscalationService instance used everywhere
- `createApp(db, services={}, options={})` — services as second argument
- All services must degrade gracefully when `db` is null (offline-first non-negotiable)
- **New (Day 60):** `reports:advanced`, `audit:read`, `audit:export`, `supply:write`, `supply:delete`, `supply:export`, and `blockchain:write` are all non-monotonic in rank — never assume a permission follows a clean rank-level cutoff without checking `RBACService.ROLE_PERMISSIONS` directly. `verify-rbac-contract.js` computes the current full list live.
- **New (Day 58):** any route factory that's supposed to receive a shared service instance must actually declare a matching parameter — app.js passing an argument a function doesn't declare is silently dropped, not an error.
- **New (Day 59):** `SEED_DEMO_DATA=true` is required to get demo data into a real running server — `npm run seed:demo` alone does not do this.

---

## Outstanding Risk (unchanged from Day 55)

No Army stakeholder has been formally identified or a session confirmed.
This remains the single most important open item, and it is not solvable
by continued engineering — the code is in good, demo-ready shape as of
this checkpoint (52/52 scripts, 1,856/1,856 assertions passing, including
a real end-to-end smoke test of the full feature set). The business side
— a named champion, a scheduled slot — is the actual critical path from
here.

---

## On the Horizon: Days 61–65

Continuing as concrete, verifiable hardening (per the framing note
above — no invented stakeholder feedback):
- Day 61 — Rate limiting beyond login (currently only `auth.routes.js` uses `RateLimiterService`)
- Day 62 — Real UI pagination for Items/Transfers (backend already supports `limit`/`offset`; frontend currently requests a flat `limit:100`)
- Day 63 — Backup/restore snapshot tooling for the in-memory store
- Day 64 — Accessibility + keyboard-shortcut polish (extends Day 52)
- Day 65 — Final full regression + handoff document + zip package
