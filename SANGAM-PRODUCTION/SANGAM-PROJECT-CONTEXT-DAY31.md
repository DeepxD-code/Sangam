# SANGAM PROJECT CONTEXT — DAY 31

## Quick Facts
- **Working dir:** `/home/claude/SANGAM-PRODUCTION`
- **Stack:** Node.js 22 + Express 5 + PostgreSQL (offline-first) | React 18 + Vite 5 + TypeScript-safe JS
- **Total tests:** 918 (896 backend + 22 Day-31) — **0 failures**
- **Frontend build:** Vite production build passes (dist/index.html confirmed)
- **Days complete:** 1–31

---

## What Was Built — Day 31

### Backend
| Change | File | Detail |
|--------|------|--------|
| Alert singleton | `app.js` | `AlertEscalationService` constructed once, stored in `app.locals.services.alerts`; passed to both dashboard and alert routes |
| Alert routes refactored | `routes/alert.routes.js` | Accepts `sharedServices.alertService`; falls back to constructing one if not provided |
| Alert poller | `server.js` | `setInterval(30s)` scans all in-memory unit IDs; cleared on graceful shutdown; non-fatal |
| Dashboard alerts section | `services/dashboard.service.js` | `async _alertsSection(scopeIds)` returns `{ available, totalActive, critical, escalated, byType, totalRaised, totalResolved }` |
| Dashboard routes | `routes/dashboard.routes.js` | Passes `alerts: sharedServices.alerts` to `DashboardService` constructor |

### Frontend
| Change | File | Detail |
|--------|------|--------|
| React Router | `App.jsx` | `BrowserRouter` + `Routes`; 6 routes: `/`, `/supply/items`, `/supply/transfers`, `/supply/transfers/new`, `/supply/blockchain`, `/alerts` |
| API client extended | `api/client.js` | Added: `getTransfers`, `createTransfer`, `approveTransfer`, `rejectTransfer`, `getBlockchain`, `verifyBlockchain`, `getAlerts`, `getActiveAlerts`, `scanAlerts`, `acknowledgeAlert`, `resolveAlert`, `getUnits` |
| Dashboard updated | `pages/DashboardPage.jsx` | Uses `useNavigate`; ALT widget wired; all 8 widgets now drill-down to sub-pages |
| Transfer List | `pages/TransferListPage.jsx` | Status filter tabs; APPROVE / REJECT actions; feedback banners |
| Transfer Create | `pages/TransferCreatePage.jsx` | Full validated form; items + units loaded dynamically; submits to backend |
| Blockchain Viewer | `pages/BlockchainPage.jsx` | Last 50 blocks; VERIFY CHAIN button; tampered blocks highlighted red |
| Alert Monitor | `pages/AlertListPage.jsx` | Severity filter tabs; SCAN NOW; ACKNOWLEDGE / RESOLVE actions |
| BlockchainSeal | `components/BlockchainSeal.jsx` | Now clickable (`onClick` → BlockchainPage); keyboard accessible |
| ItemListPage | `pages/ItemListPage.jsx` | Migrated from `onBack` prop to `useNavigate('/')` |
| CSS | `styles/global.css` | +270 lines: tables, forms, blockchain cards, alert cards, interactive widgets, feedback banners, tab bars |

---

## Architecture Invariants (Critical — Do Not Break)

| Rule | Detail |
|------|--------|
| `RBACService.getCommandScope()` returns `{ids, codes}` | Always unwrap `.ids` before calling `.includes()` |
| `createApp(db, services={}, options={})` | services is 2nd arg |
| Valid supply categories | `AMMO, RATIONS, FUEL, MEDICAL, EQUIPMENT, COMMS, VEHICLE_PARTS, CLOTHING, ENGINEERING, GENERAL` — `ARMS` is NOT valid |
| Actor attribution | Always use `req.user.userId` (set by `RBACService.buildUserContext()`), never `req.user.id` |
| Offline-first | No CDN at runtime; fonts via `@fontsource`; all services degrade gracefully when `db` is null |
| Alert singleton | `app.locals.services.alerts` is the ONE instance used everywhere — never construct a second |
| `_alertsSection` is async | Must be `async` or the `.catch()` in `Promise.all` won't work |

---

## Test Inventory

| Script | Tests | What it covers |
|--------|-------|----------------|
| verify-day-11.js | 61 | Audit log, notifications |
| verify-day-12.js | 38 | Reporting service |
| verify-day-13.js | 73 | RBAC + command hierarchy |
| verify-day-14.js | 48 | Auth (JWT + refresh) |
| verify-day-15.js | 52 | Delegation + override |
| verify-day-16.js | 47 | Audit hardening (AES-256-GCM) |
| verify-day-17.js | 44 | Docker / env validation |
| verify-day-18.js | 45 | OpenAPI docs |
| verify-day-19.js | 62 | Supply chain routes |
| verify-day-20.js | 55 | Compliance reporting |
| verify-day-21.js | 43 | Bulk ops + CSV |
| verify-day-22.js | 56 | Unit management |
| verify-day-23.js | 65 | User management |
| verify-day-24.js | 51 | Inventory stock-take |
| verify-day-25.js | 55 | Movement orders |
| verify-day-26.js | 39 | Dashboard API |
| verify-day-28.js | 9  | React dashboard spike |
| verify-day-30.js | 37 | Alert escalation engine |
| verify-scope-contract.js | 16 | HTTP integration guard |
| **verify-day-31.js** | **22** | **Alert singleton + router + pages** |
| **TOTAL** | **918** | |

---

## Service Map (17 services)

```
AuditLogService          ← base, no deps
RBACService              ← db
NotificationService      ← db, rbac, audit
AuditHardeningService    ← db, audit, notifications
AuthService              ← db, audit
DelegationService        ← db, rbac, notifications, audit
SupplyChainService       ← db, rbac, notifications, audit
MovementOrderService     ← db, audit, notifications
UnitManagementService    ← db, audit, rbac
UserManagementService    ← db, audit, rbac
InventoryLedgerService   ← db, supply, audit, notifications
AlertEscalationService   ← {supply, inventory, movement, auditLog}, {}, notifications
DashboardService         ← {supply, units, users, inventory, movement, alerts, auditLog}
ReportingService         ← db, audit, notifications
ComplianceService        ← db, supply, audit
BulkOperationsService    ← db, supply, audit
RateLimiterService       ← (standalone)
```

---

## Route Map (16 routes)

```
/health                  healthRoutes
/api/auth                authRoutes
/api/rbac                rbacRoutes
/api/notifications       notificationRoutes
/api/reports             reportingRoutes
/api/delegation          delegationRoutes
/api/docs                docsRoutes
/api/supply              supplyRoutes  (items, transfers, blockchain, categories, stats)
/api/compliance          complianceRoutes
/api/bulk                bulkRoutes
/api/units               unitRoutes
/api/users               userRoutes
/api/inventory           inventoryRoutes
/api/movement            movementRoutes
/api/dashboard           dashboardRoutes
/api/alerts              alertRoutes   ← Day 31: singleton-wired
```

---

## Frontend Route Map (Day 31)

```
/                        DashboardPage   (8 widgets, 30s poll)
/supply/items            ItemListPage    (category filter, search, low-stock toggle)
/supply/transfers        TransferListPage (status tabs, approve/reject)
/supply/transfers/new    TransferCreatePage (validated form → POST)
/supply/blockchain       BlockchainPage  (50 blocks, verify chain)
/alerts                  AlertListPage   (severity tabs, scan, ack, resolve)
```

---

## Day 32+ Roadmap (per LLM Council Day 21 verdict)

**Priority 1 — Complete the vertical-slice demo path (Days 32–60):**
1. **Day 32:** Navbar component with active-route highlighting; mobile-responsive layout; TopBar links to all pages
2. **Day 33:** Login page polish + animated entrance; role-aware nav (OFFICER+ sees approve buttons)
3. **Day 34:** Movement Orders page (`/movement`) — active orders list, create EMERGENCY order
4. **Day 35:** Inventory / Stock-Take page (`/inventory`) — stock levels by category, initiate stock-take
5. **Day 36–40:** Demo data seeder (realistic Indian Army units, items, transfers, alerts) for a compelling live demo
6. **Day 41–50:** Compliance reports page; audit log viewer; bulk CSV upload UI
7. **Day 51–60:** Polish demo flow: guided tour overlay, print-ready briefing PDF, one-click Docker deploy script

**Priority 2 (non-technical, highest ROI):** Identify a named Indian Army stakeholder / internal champion

**Priority 3 (Days 60–90):** Security hardening, performance tuning, production deployment guide

---

## Known Gaps / Technical Debt
- Frontend has no Navbar yet — users navigate back via `← BACK TO OVERVIEW` links only
- `UnitManagementService` (in-memory) and `command_units` (SQL) have independent ID spaces — units must be created in matching order
- Alert poller in `server.js` reads `units._units` (internal Map) — fragile; should expose a `getUnitIds()` method (Day 32+)
- No pagination UI yet on Transfer List (limit=100 hardcoded)
- `TransferCreatePage` `fromUnitId` is read from the selected item — backend derives it from the requester's unit anyway, but the UI should reflect this more clearly
