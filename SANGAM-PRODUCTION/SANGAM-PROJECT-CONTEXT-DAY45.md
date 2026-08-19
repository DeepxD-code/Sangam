# SANGAM — Project Context (Day 45)

## Project
**SANGAM** — Permissioned blockchain supply chain system for Indian Army logistics  
**Goal:** Stakeholder demo by Day 60  
**Day:** 45 of 90 — halfway point  
**Working directory:** `/home/claude/SANGAM-PRODUCTION`

---

## Test Baseline
**1,500 tests — 0 failures** (`npm run test:all`)  
Runs 33 verify scripts: days 11–45 + scope-contract guard.

---

## Stack
- **Backend:** Node.js 22 + Express 5, 17 services, 16 routes
- **Frontend:** React 18 + Vite 5, 13 pages, 10 components, 1 hook
- **Data:** In-memory Maps (offline-first) + optional PostgreSQL
- **Auth:** JWT + refresh-token rotation + bcrypt + pepper + account lockout
- **Audit:** AES-256-GCM encrypted log, in-memory buffer fallback

---

## File Map

```
SANGAM-PRODUCTION/
├── backend/
│   ├── src/
│   │   ├── app.js                        ← createApp(db, services, options)
│   │   ├── server.js                     ← startup, validateEnv, getUnitIds()
│   │   ├── services/  (17 files)
│   │   │   ├── unit-management.service.js  getUnitIds() public method
│   │   │   ├── supply-chain.service.js     blockIndex/blockHash on approveTransfer
│   │   │   ├── inventory-ledger.service.js (db, supplyChain, audit, notifications)
│   │   │   ├── movement-order.service.js
│   │   │   ├── alert-escalation.service.js  scan() not scanAll()
│   │   │   ├── dashboard.service.js
│   │   │   ├── auth.service.js
│   │   │   ├── rbac.service.js
│   │   │   ├── notification.service.js
│   │   │   └── ...
│   │   └── routes/ (16 files)
│   │       ├── reporting.routes.js  ← /audit-log + /export/:type
│   │       ├── supply.routes.js     ← /transfers/:id GET
│   │       ├── auth.routes.js       ← /change-password
│   │       └── ...
│   └── scripts/
│       ├── verify-day-11.js … verify-day-45.js
│       ├── seed-demo-data.js  ← creates 5 units/users/20 items/7 transfers/4 orders/2 sessions
│       └── verify-scope-contract.js
├── frontend/
│   └── src/
│       ├── App.jsx              ← 12 routes, normalizeUser(), sidebar layout
│       ├── api/client.js        ← 40+ methods including exportCSV, changePassword
│       ├── hooks/
│       │   └── useSearchState.js  ← sessionStorage persistence hook
│       ├── components/
│       │   ├── Sidebar.jsx           ← adminOnly, DemoBanner, NotificationBell
│       │   ├── Modal.jsx
│       │   ├── DemoBanner.jsx        ← credential cheat-sheet for demo mode
│       │   ├── NotificationBell.jsx  ← 30s poll, dropdown, mark-read
│       │   ├── TransferDetailModal.jsx ← timeline + blockchain proof
│       │   ├── Widget.jsx
│       │   ├── ActivityFeed.jsx
│       │   └── BlockchainSeal.jsx
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── DashboardPage.jsx
│       │   ├── ItemListPage.jsx        ← useSearchState('items')
│       │   ├── TransferListPage.jsx    ← useSearchState('transfers') + TransferDetailModal
│       │   ├── TransferCreatePage.jsx
│       │   ├── BlockchainPage.jsx
│       │   ├── AlertListPage.jsx       ← useSearchState('alerts')
│       │   ├── MovementOrderPage.jsx
│       │   ├── InventoryPage.jsx
│       │   ├── ReportsPage.jsx         ← NEW Day 45
│       │   ├── AuditLogPage.jsx        ← SYSTEM_ADMIN only
│       │   ├── UserManagementPage.jsx  ← SYSTEM_ADMIN only
│       │   └── PasswordChangePage.jsx  ← NEW Day 44
│       └── styles/global.css   ← 3,000+ lines
├── package.json               ← test:all runs days 11-45 + scope-contract
└── SANGAM-HANDOFF-DAY45.md
```

---

## Route Table

| Route | Page | Min Role |
|-------|------|----------|
| `/` | Dashboard | Any |
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

---

## API Client Methods (40+)

Auth: `login, logout, getMe, changePassword`  
Dashboard: `getDashboardSummary`  
Supply: `getSupplyItems, getSupplyCategories, getTransfer, getTransfers, approveTransfer, rejectTransfer, createTransfer, getBlockchain, verifyBlockchain`  
Alerts: `getAlerts, scanAlerts, acknowledgeAlert, resolveAlert`  
Units: `getUnits`  
Movement: `getMovementOrders, getMovementOrder, createMovementOrder, dispatchMovementOrder, deliverMovementOrder, cancelMovementOrder`  
Inventory: `getInventorySessions, getActiveInventorySession, getInventorySession, createInventorySession, recordInventoryCount, finalizeInventorySession`  
Users: `getUsers, createUser, deactivateUser, reactivateUser, changeUserRole, unlockUser`  
Notifications: `getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead`  
Audit: `getAuditLog`  
Export: `exportCSV(type, params)` — downloads CSV file  

---

## Critical Invariants

1. `RBACService.getCommandScope()` → `{ids, codes}` — always `.ids`
2. Actor attribution: `req.user.userId` not `req.user.id`
3. Valid supply categories: `AMMO RATIONS FUEL MEDICAL EQUIPMENT COMMS VEHICLE_PARTS CLOTHING ENGINEERING GENERAL` (no ARMS)
4. `AlertEscalationService.scan(scopeUnitIds)` — not `scanAll()`
5. `InventoryLedgerService(db, supplyChain, audit, notifications)` — supply chain is 2nd arg
6. `UnitManagementService.getUnitIds()` — never access `._units` directly
7. `normalizeUser(u)` in App.jsx: `{ ...u, userId: u.userId ?? u.id }`
8. `createApp(db, services={}, options={})` — services is 2nd arg
9. `app.locals.services.alerts` must be the shared singleton
10. No CDN runtime deps — all fonts via `@fontsource`, offline-first

---

## Demo Seeder

`npm run seed:demo`

Creates per session:
- 5 units (1 Brigade → 3 Battalions → 1 Company)
- 5 users with Indian Army names
- 20 supply items (realistic nomenclature across 10 categories)
- 7 transfers (4 PENDING, 2 APPROVED, 1 REJECTED)
- 4 movement orders (ROUTINE, PRIORITY, IMMEDIATE/dispatched, EMERGENCY/dispatched)
- 2 inventory sessions (1 open with counts, 1 finalized)
- 3+ alerts (raised for below-threshold items)

Credentials: admin/Admin@1234, brig.sharma/Officer@1234, lt.col.verma/Officer@1234, maj.singh/Officer@1234, hav.kumar/Soldier@1234

---

## Days 46–60 Plan

| Day | Feature | Priority |
|-----|---------|----------|
| 46 | Unit detail page — drill-down with personnel + items | HIGH |
| 47 | Blockchain block detail panel | MEDIUM |
| 48 | Alert detail expand + escalation history | MEDIUM |
| 49 | Demo walk-through mode (guided overlay) | HIGH |
| 50 | Performance audit + lazy loading | MEDIUM |
| 51–59 | Stakeholder feedback iteration | CRITICAL |
| 60 | Demo Day | CRITICAL |

**Biggest risk:** Army stakeholder not yet confirmed. Must be actioned in parallel with development.

---

*Last updated: Day 45 complete — 1,500/1,500 tests passing*
