# SANGAM — Handoff Document (Day 71 Checkpoint)

**Checkpoint requested mid-session.** This document covers Days 66–71
(this session's work, built on top of the Day 65 production baseline)
and closes with a concrete plan for Days 72–90 — the remainder of the
originally-scoped 90-day MVP sprint.

---

## 1. Executive Summary

Starting from the Day 65 baseline (1,920 assertions, 57 scripts, all
passing — re-verified fresh from the uploaded zip before touching
anything), this session found and fixed **eight real, previously-
invisible bugs**, each confirmed empirically rather than assumed:

| Day | Finding | Severity |
|---|---|---|
| 66 | Hierarchical command scope collapsed to self-only in offline mode (this project's default runtime) | **High** — core RBAC feature non-functional in the mode the system is demoed in |
| 67 | Migration seed and runtime seeder collided on `command_units` IDs, corrupting the SQL audit trail on first real-Postgres run | Medium — SQL-only, no live UI impact |
| 68 | Migrations were structurally out of dependency order (day-12 needed a table day-13 created) | **High** — fresh-database migrations were guaranteed to fail |
| 68 | `supply_items` writes failed 100% of the time whenever Postgres was connected (phantom `created_at` column) | **High** — silent, total data loss to SQL |
| 68 | Fire-and-forget SQL writes raced each other during bulk seeding, causing FK violations | Medium — fixed with a new, reusable `flushPendingWrites()` mechanism |
| 69 | Same race existed in bulk-import/bulk-transfer routes | Medium — same fix reused |
| 70 | Frontend's only test file had gone completely stale, silently, because it was never wired into the CI gate | Medium — masked 14 other valid assertions |
| 71 | **AUDITOR role — whose entire defined purpose is audit log access — was locked out of the Audit Log page at three separate layers** | **High** — a full role's core capability was inaccessible |

Also closed: genuine, first-ever proof (via a real, temporarily-installed
local PostgreSQL 16) that `RBACService.getCommandScope()`'s SQL
recursive-CTE hierarchy expansion actually works correctly — this had
never been executed against anything before Day 68.

**Current verified state: 2,029/2,029 assertions passing, 0 failures,
59 backend verify scripts + 1 frontend test suite, all wired into a
single `npm run test:all` gate.**

---

## 2. What Changed, File by File

### Backend
- `backend/src/services/rbac.service.js` — module-level shared-unit-service registry (`setSharedUnitService`/`getSharedUnitService`/`_resetSharedUnitService`) so offline-mode `getCommandScope()` resolves real hierarchy instead of self-only.
- `backend/src/services/unit-management.service.js` — new `getDescendantScope()`; `_dbWrite()` now called from `updateUnit`/`deactivateUnit`/`reactivateUnit`/`reassignUnit` (previously only `createUnit`), and its SQL now syncs `parent_unit_id`; new `_trackWrite()`/`flushPendingWrites()`.
- `backend/src/services/supply-chain.service.js` — `_persistItem()`'s SQL fixed to match `supply_items`'s real schema (no `created_at` column); new `_trackWrite()`/`flushPendingWrites()`.
- `backend/src/services/bulk-operations.service.js` — `importItemsFromCSV` and `bulkTransfer` now call `flushPendingWrites()` before their audit log entry.
- `backend/src/app.js` — registers the shared unit service with `RBACService` right after construction.
- `backend/src/routes/reporting.routes.js` — `/audit-log` now requires `audit:read` instead of `system:admin`.
- `database/migrations/001-command-units-schema.sql` — **new file**; `command_units` extracted here so it's created before `day-12` and `day-13`, which both depend on it.
- `database/migrations/day-13-rbac-schema.sql` — `command_units` table/index definitions removed (now in 001); colliding 12-unit SQL seed removed entirely (nothing read it back; nothing else referenced those unit codes).
- `backend/scripts/verify-day-66.js` through `verify-day-71.js` — new, 111 assertions total.
- `package.json` — `pg-mem` added as a devDependency (test-only, never imported by `src/`); `test:all` extended through Day 71 and now also runs `npm run test:frontend`.

### Frontend
- `frontend/src/components/Sidebar.jsx` — `/audit` link: `adminOnly: true` → `minRankLevel: 4`.
- `frontend/src/pages/AuditLogPage.jsx` — access gate: hardcoded `role === 'SYSTEM_ADMIN'` → `rankLevel >= 4`; new "Verify Integrity" button + result banner.
- `frontend/src/api/client.js` — new `verifyAuditIntegrity()`.
- `frontend/src/styles/global.css` — new `.integrity-banner` rules (reuses existing design tokens).
- `frontend/scripts/verify-day-27.cjs` — stale `TopBar.jsx` reference removed (component no longer exists); stale `LoginPage` text assertions corrected to match the real Day 33 redesign. 16/16 passing, now wired into the root test gate for the first time.
- `frontend/package.json` — `postcss` patched to 8.5.23 (fixes the one HIGH-severity npm audit finding that didn't require a breaking change).

---

## 3. Critical Facts for Continuation (read before touching anything)

**Everything in the Day 65 handoff's invariants section still holds** —
`getCommandScope().ids` unwrapping, actor attribution via `req.user.userId`,
service constructor signatures, etc. This section only adds what changed
or was newly discovered.

- **Offline mode now resolves real hierarchy.** `RBACService.getCommandScope(unitId, null)` no longer means "self only" — it consults the live `UnitManagementService` if one has been registered via `RBACService.setSharedUnitService()` (which `createApp()` does automatically). Direct `new RBACService(db)` usage that never goes through `createApp()` keeps the old self-only behavior — this is intentional and documented in `rbac.service.js`'s module-level comment.
- **The real, intended deployment uses Postgres.** `server.js` unconditionally requires `DATABASE_URL`; `docker-compose.yml` bundles a local Postgres container. "Offline-first" in this project means "no internet/cloud dependency," not "no database at all." Don't assume `db` is null in production — it usually won't be.
- **`flushPendingWrites()` exists on `UnitManagementService` and `SupplyChainService`.** Any *new* bulk-creation code path (many rapid, dependent creates) should call it before creating rows that reference what was just created. The live, single-item request path does not and should not call it.
- **Migration order matters and is now guarded.** `verify-day-68.js` Group A statically checks every migration's `REFERENCES` clauses against creation order — extend `createdByFile`/`violations` logic there if you add new cross-table FKs.
- **A real local PostgreSQL 16 was installed in this sandbox** (`apt-get install postgresql`) to do the Day 68 investigation. It is **not** part of the shipped project and won't necessarily exist in a future environment running this test suite — the automated suite uses `pg-mem` for portability. If you have real Postgres available again: `service postgresql start`, then `psql` as the `postgres` OS user (no password configured) — the daemon does not survive a sandbox turn boundary even though installed packages and data files do.
- **AUDITOR's access is now correct end-to-end** (backend permission, sidebar, page gate) — see Day 71 above. If you add a new admin-adjacent page, check what permission/rank it actually needs rather than defaulting to `system:admin`/`SYSTEM_ADMIN`-only, which is exactly the mistake that caused this.

---

## 4. Known, Honestly-Scoped Limitations (not fixed, carried forward)

These were found but deliberately not addressed this session, with
reasoning, not just left silently:

1. **`audit_logs.encryption_version` is never set by the INSERT**, so it silently defaults to 0 regardless of whether `details` was actually AES-256-GCM encrypted. Doesn't crash or corrupt anything — a metadata-accuracy question. Needs someone to read the encryption code's actual intent before touching it.
2. **`getChainOfCommand()`** in `rbac.service.js` has the same offline-mode gap Day 66 fixed for `getCommandScope()`, but it has **zero callers anywhere in the live app** — confirmed dead code, not a live bug. Left alone rather than fixed without need.
3. **React-router and esbuild/vite npm audit findings deferred.** Both require breaking major-version upgrades. Investigated real exposure: no user-controlled navigation target exists anywhere in this codebase (checked every `navigate()`/`<Link to=>` call site), and this app has no SSR, so both CVEs' actual attack vectors don't apply here today. esbuild's CVE is dev-server-only. Revisit if frontend test coverage grows, or as part of a future production rewrite.
4. **Frontend test coverage is still thin** (16 assertions, one file). `NotificationBell`, `TransferDetailModal`, `AlertDetailModal`, and `Sidebar` have no smoke-test coverage — `Sidebar` specifically needs a Router-context wrapper and bundles two further local components, more setup than fit this pass.
5. **The recursive-CTE proof from Day 68 was manual**, using a temporarily-installed real Postgres. It is not re-runnable by `npm test` in an arbitrary future environment. If real Postgres is available again, re-confirm this before a live demo: seed data, then check that a Commander's `/api/units` response actually includes subordinate units.
6. **`admin.routes.js`'s snapshot/restore has no UI** — investigated and concluded this is appropriate (an ops/incident-response tool, not a regular-user feature, consistent with `health.routes.js`/`docs.routes.js` also being intentionally UI-less) rather than an oversight, but flagging the reasoning here so a future session can disagree with it explicitly if warranted.
7. **The orphaned-capability scan (Day 71) was not exhaustive** across all 130 routes — it found one significant issue (AUDITOR) via targeted investigation, not a systematic pass over every route. A more thorough sweep is one reasonable candidate for Days 72+.

---

## 5. The Actual, Ongoing Non-Technical Risk

Unchanged from every prior handoff and stated plainly again: **no
confirmed Army stakeholder or demonstration session exists.** This
remains the single highest-priority risk to the project's real-world
outcome, and it is not something further engineering can resolve.
Everything in this document makes the demonstration *better* if and
when one happens; it does not make one happen.

---

## 6. Plan for Days 72–90

This project's own Day 65 assessment concluded it was "genuinely
feature-complete... further work should probably be driven by actual
stakeholder feedback rather than more speculative hardening." Days
66–71 found real, valuable, non-speculative work anyway (concrete bugs,
found by testing against real infrastructure rather than guessing) —
the plan below tries to keep that same character: verify-first,
evidence-over-assumption, and honest about what's genuinely useful
versus what would be scope-padding.

**Days 72–74 — Finish the orphaned-capability scan properly.**
Day 71 found one significant issue through targeted investigation, not
a systematic pass. Methodically cross-reference all 130 backend routes
against `frontend/src/api/client.js` and every page, in both directions:
backend capability with no frontend caller, and frontend calling
something that doesn't match current backend reality. Given Day 71's
result, this is a well-motivated, non-speculative use of three days.

**Days 75–76 — Frontend test coverage expansion.**
Address limitation #4 above: bring `NotificationBell`, `TransferDetailModal`,
`AlertDetailModal`, and `Sidebar` under the same smoke-test discipline
the backend has had since Day 1. `Sidebar` needs a Router-context
wrapper (`MemoryRouter` or equivalent) and bundling for its local
component imports — budget for that setup cost specifically.

**Day 77 — Encryption-version metadata (limitation #1).**
Read `audit-log.service.js`'s encryption code closely enough to
determine whether `encryption_version` should be set at write time, and
fix it if so. Explicitly deferred this session for lack of that
confidence — don't repeat the deferral without at least reading the code.

**Day 78 — Re-attempt real-Postgres validation if available.**
If a real (or better-than-pg-mem) Postgres instance can be stood up
again, re-run the Day 68 recursive-CTE proof and the full demo reseed
end-to-end, specifically to convert limitation #5 from "validated once,
manually, by a prior session" into either a repeatable check or an
explicit, current re-confirmation.

**Day 79 — Full regression pass + demo-readiness re-verification.**
Re-run `npm run test:all` clean from a fresh clone/extract (not just
incrementally in a long-lived session) to catch anything environment-
dependent that's crept in. Update `SANGAM-DEMO-RUNBOOK.md` and
`SANGAM-STAKEHOLDER-ONE-PAGER.md` with anything from Days 66–78 that
changes what's demoable or how.

**Day 80 — Packaging checkpoint** (handoff doc + zip), matching this
session's established convention, if the sprint continues that far in
one sitting.

**Days 81–90 — Genuinely stakeholder-driven,** per this project's own
repeated conclusion that further speculative hardening has diminishing
value without real feedback. If Day 90 arrives with no stakeholder
input, the most honest use of that time is: (a) a security-focused
external-facing review (input validation completeness, rate-limiting
coverage on any newly-added routes, dependency audit re-check now that
more time has passed), and (b) final, polished packaging — not inventing
new user-facing features nobody has asked for.

---

## 7. How to Verify This Checkpoint Yourself

```bash
cd SANGAM-PRODUCTION
npm install && cd frontend && npm install && cd ..
npm run test:all
```
Expect: `2029` total assertions passing across 59 backend scripts + the
frontend suite, exit code 0. No database of any kind is required — the
full suite runs entirely offline/in-memory plus `pg-mem` for the
SQL-connected-path coverage added Days 67–69.

To build the frontend: `cd frontend && npm run build` (outputs to
`frontend/dist/`).
