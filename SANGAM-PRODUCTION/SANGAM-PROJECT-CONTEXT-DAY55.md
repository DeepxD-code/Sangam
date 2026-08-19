# SANGAM — Project Context (Day 55)

## Project
**SANGAM** — Permissioned blockchain supply chain system for Indian Army logistics
**Goal:** Stakeholder demo by Day 60
**Day:** 55 of 90 — 61% through the sprint
**Working directory:** `/home/claude/SANGAM-PRODUCTION`

---

## Test Baseline
**1,716 tests — 0 failures** (`npm run test:all`)
Runs 45 verification scripts: days 11–55 (skipping 27, 29 — never planned) + scope-contract guard + actor-attribution-contract guard.

---

## Stack
- **Backend:** Node.js 22 + Express 5, 17 services, 16 routes
- **Frontend:** React 18 + Vite 5, 16 pages, 11 components, 1 hook — route-based code-split (Day 51)
- **Data:** In-memory Maps (offline-first) + optional PostgreSQL
- **Auth:** JWT + refresh-token rotation + bcrypt + pepper + account lockout
- **Audit:** AES-256-GCM encrypted log, in-memory buffer fallback

---

## File Map (changes since Day 45 in **bold**)

```
SANGAM-PRODUCTION/
├── backend/
│   ├── src/
│   │   ├── app.js                        ← createApp(db, services, options); **services.dashboard override added**
│   │   ├── server.js
│   │   ├── services/  (17 files)
│   │   │   ├── unit-management.service.js  **createUnit/updateUnit reject whitespace-only unitName**
│   │   │   ├── supply-chain.service.js     **createItem now validates + logs actor**
│   │   │   ├── user-management.service.js  **getUsersInScope accepts unitId filter**
│   │   │   ├── dashboard.service.js        **cache key fixed: userContext.userId not .id**
│   │   │   ├── inventory-ledger.service.js (db, supplyChain, audit, notifications)
│   │   │   ├── movement-order.service.js
│   │   │   ├── alert-escalation.service.js  scan() not scanAll(); STATUS = OPEN|ESCALATED|RESOLVED|SUPPRESSED only
│   │   │   ├── rbac.service.js
│   │   │   └── ...
│   │   └── routes/ (16 files)
│   │       ├── unit.routes.js       **req.user.userId fixed (was .id, 5 call sites)**
│   │       ├── supply.routes.js     **req.user.userId fixed (6 call sites)**
│   │       ├── inventory.routes.js  **req.user.userId fixed (5 call sites)**
│   │       ├── bulk.routes.js       **req.user.userId fixed (4 call sites)**
│   │       ├── user.routes.js       **req.user.userId fixed (9 call sites incl. self-vs-other scope check); unitId filter added to list route**
│   │       ├── movement.routes.js   **req.user.userId fixed (6 call sites)**
│   │       ├── dashboard.routes.js  **req.user.userId fixed (1 call site); services.dashboard injection support**
│   │       └── ...
│   └── scripts/
│       ├── verify-day-11.js … **verify-day-55.js**
│       ├── seed-demo-data.js
│       ├── verify-scope-contract.js
│       └── **verify-actor-attribution-contract.js**  ← real HTTP integration guard for the Day 46 fix
├── frontend/
│   └── src/
│       ├── App.jsx              ← 15 routes; **React.lazy() + Suspense for all but Login/Dashboard**; **2 ErrorBoundary levels**; **skip-link**; **tourActive state**
│       ├── api/client.js        ← 50+ methods; **unit CRUD, getAlert, suppressAlert, unitId filters added; duplicate getSupplyCategories removed**
│       ├── data/
│       │   └── **walkthroughSteps.js**  ← 8-step demo tour config
│       ├── hooks/
│       │   └── useSearchState.js
│       ├── components/
│       │   ├── Sidebar.jsx           ← **+COMMAND UNITS, +ABOUT links; +tour trigger button; minRankLevel gating**
│       │   ├── Modal.jsx             (unchanged — focus trap + Escape already solid)
│       │   ├── **AlertDetailModal.jsx**   ← escalation history timeline
│       │   ├── **DemoWalkthrough.jsx**    ← guided tour overlay, non-blocking
│       │   ├── **ErrorBoundary.jsx**      ← class component, 2 instances in App.jsx
│       │   ├── TransferDetailModal.jsx
│       │   ├── NotificationBell.jsx
│       │   ├── DemoBanner.jsx
│       │   ├── Widget.jsx
│       │   ├── ActivityFeed.jsx
│       │   └── BlockchainSeal.jsx
│       ├── pages/
│       │   ├── **UnitsPage.jsx**        ← hierarchy tree, drill-down landing page
│       │   ├── **UnitDetailPage.jsx**   ← roster/items/orders/children aggregate
│       │   ├── **AboutPage.jsx**        ← live stats + feature list + tour launcher
│       │   ├── DashboardPage.jsx        ← **UNT widget now clickable → /units**
│       │   ├── BlockchainPage.jsx       ← **click-to-expand block detail panel**
│       │   ├── AlertListPage.jsx        ← **fixed ACTIVE→OPEN, message→detail, itemId→meta.itemId bugs; row click opens modal**
│       │   ├── TransferListPage.jsx     ← **deep-link support (openTransferId router state)**
│       │   └── ... (ItemListPage, TransferCreatePage, MovementOrderPage, InventoryPage, ReportsPage, AuditLogPage, UserManagementPage, PasswordChangePage, LoginPage — unchanged)
│       └── styles/global.css   ← 3,633 lines (was ~3,150 at Day 45)
├── package.json               ← test:all runs days 11-55 (skip 27,29) + 2 contract guards
├── SANGAM-HANDOFF-DAY45.md    (superseded by SANGAM-HANDOFF-DAY55.md)
└── SANGAM-HANDOFF-DAY55.md
```

---

## Route Table

| Route | Page | Min Role |
|-------|------|----------|
| `/` | Dashboard | Any |
| `/units` | Command Units (tree) | rankLevel ≥ 4 |
| `/units/:id` | Unit Detail | rankLevel ≥ 4 (edit ≥7, admin ≥8) |
| `/supply/items` | Items | Any |
| `/supply/transfers` | Transfers (approve: OFF+) | Any |
| `/supply/transfers/new` | New Transfer | Any |
| `/supply/blockchain` | Blockchain | Any |
| `/alerts` | Alerts | Any |
| `/movement` | Movement (dispatch: OFF+) | Any |
| `/inventory` | Stock-Take (finalize: NCO+) | Any |
| `/reports` | CSV Exports | reports:export |
| `/audit` | Audit Log | SYSTEM_ADMIN |
| `/admin/users` | User Management | SYSTEM_ADMIN |
| `/profile/password` | Change Password | Self |
| `/about` | About / System Info | Any |

---

## API Client Methods (50+, additions in **bold**)

Auth: `login, logout, getMe, changePassword`
Dashboard: `getDashboardSummary`
Supply: `getSupplyItems (+unitId filter), getSupplyCategories, getTransfer, getTransfers, approveTransfer, rejectTransfer, createTransfer, getBlockchain, verifyBlockchain`
Alerts: `getAlerts, **getAlert(id)**, scanAlerts, acknowledgeAlert, resolveAlert, **suppressAlert**`
Units: `getUnits, **getUnitsHierarchy, getUnit, getUnitSubtree, getUnitStats, createUnit, updateUnit, deactivateUnit, reactivateUnit, reassignUnit**`
Movement: `getMovementOrders, getMovementOrder, createMovementOrder, dispatchMovementOrder, deliverMovementOrder, cancelMovementOrder, **getActiveOrdersForUnit**`
Inventory: `getInventorySessions, getActiveInventorySession, getInventorySession, createInventorySession, recordInventoryCount, finalizeInventorySession`
Users: `getUsers (+unitId filter), createUser, deactivateUser, reactivateUser, changeUserRole, unlockUser`
Notifications: `getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead`
Audit: `getAuditLog`
Export: `exportCSV(type, params)`

---

## Critical Invariants (Day 55 — see handoff doc for full explanations)

1. `RBACService.getCommandScope()` → `{ids, codes}` — always `.ids`
2. **Actor attribution: `req.user.userId` not `.id` — now permanently regression-guarded (Day 46). Any reintroduction of `req.user.id` in a route file fails `test:all` immediately via a static scan.**
3. **Dashboard cache key: `userContext.userId` not `.id` — same guard family as #2.**
4. Valid supply categories: `AMMO RATIONS FUEL MEDICAL EQUIPMENT COMMS VEHICLE_PARTS CLOTHING ENGINEERING GENERAL` (no ARMS)
5. `AlertEscalationService.scan(scopeUnitIds)` — not `scanAll()`. **STATUS is only `OPEN|ESCALATED|RESOLVED|SUPPRESSED` — never `'ACTIVE'`.**
6. **Alert description field is `.detail`; item ref is `.meta.itemId`** (not `.message`/`.itemId`).
7. `InventoryLedgerService(db, supplyChain, audit, notifications)` — supply chain is 2nd arg
8. `UnitManagementService.getUnitIds()` — never access `._units` directly
9. `normalizeUser(u)` in App.jsx: `{ ...u, userId: u.userId ?? u.id }`
10. `createApp(db, services={}, options={})` — services is 2nd arg. **`services.dashboard` override supported (Day 46, for test injection).**
11. `app.locals.services.alerts` must be the shared singleton
12. **`GET /api/units/:id/hierarchy` wraps its single root in a 1-element array: `tree[0].children`, not `tree.children`.**
13. **`GET /api/units/:id/stats` → `{success, stats}` — nested, not flat.**
14. **`createItem()` rejects negative/NaN quantity or threshold (0 is valid) and now logs its actor.**
15. No CDN runtime deps — all fonts via `@fontsource`, offline-first

---

## Demo Seeder

`npm run seed:demo`

Creates per session: 5 units, 5 users, 20 supply items, 7 transfers, 4 movement orders, 2 inventory sessions, 3+ alerts.

Credentials: admin/Admin@1234, brig.sharma/Officer@1234, lt.col.verma/Officer@1234, maj.singh/Officer@1234, hav.kumar/Soldier@1234

---

## Days 56–90 Plan

| Day | Feature | Priority |
|-----|---------|----------|
| 56–59 | Continued hardening/polish (see handoff doc for candidate list) — **do not fabricate stakeholder feedback if a session hasn't happened yet; say so and keep doing concrete work** | MEDIUM |
| 60 | Demo Day | CRITICAL |
| 61–90 | Real stakeholder feedback iteration (post-demo) + production-rewrite hardening | CRITICAL |

**Biggest risk, unchanged since Day 45 and now more urgent:** Army stakeholder still not confirmed. The system is demo-ready (proven end-to-end by Day 55's vertical-slice smoke test) — this is the moment to push on scheduling the walkthrough, in parallel with any remaining Day 56–59 work.

---

*Last updated: Day 55 complete — 1,716/1,716 tests passing across 45 verification scripts*
