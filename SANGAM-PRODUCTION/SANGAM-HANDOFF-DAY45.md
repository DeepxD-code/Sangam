# SANGAM — Day 45 Handoff

## Status: ✅ COMPLETE — 1,500 tests, 0 failures

---

## Sprint 41–45 Summary

| Day | Feature | Tests Added |
|-----|---------|-------------|
| 41 | Transfer Detail Modal — timeline, blockchain proof | 27 |
| 42 | Notification Bell — live unread badge, dropdown | 25 |
| 43 | Seeder: movement orders + inventory sessions; dashboard MOV/STK live | 28 |
| 44 | Password Change Page — strength meter, mismatch guard, 401/400/503 errors | 33 |
| 45 | Reports Page — 4 CSV exports; useSearchState hook; filter persistence | 53 |

---

## Day 41 — Transfer Detail Modal

**`frontend/src/components/TransferDetailModal.jsx`**
- Opens when user clicks any transfer row in TransferListPage
- Clicks on action buttons (APPROVE/REJECT) do NOT trigger detail open (event propagation guard)
- Shows: item name, item code, quantity, FROM→TO route, notes, rejection reason
- Timeline: Requested → Approved/Rejected → Ledger Entry (with connector lines)
- Blockchain proof box: block index + truncated hash; "⛓ Block #N" button navigates to /supply/blockchain
- Officer+ action buttons in modal footer (Approve / Reject) for PENDING transfers
- Fetches fresh data from `GET /api/supply/transfers/:id` on open

**Backend change:** `SupplyChainService.approveTransfer()` now stores `transfer.blockIndex` and `transfer.blockHash` on the transfer object when a blockchain block is recorded.

**`frontend/src/api/client.js`:** Added `getTransfer(id)`.

**CSS:** `.transfer-detail`, `.td-timeline`, `.td-event`, `.td-proof`, `.td-blockchain-btn`, `.tr-clickable`.

---

## Day 42 — Notification Bell

**`frontend/src/components/NotificationBell.jsx`**
- Polls `GET /api/notifications/unread-count` every 30 seconds
- Renders in sidebar status bar (beside SYSTEM LIVE dot)
- Badge: red pill with count, disappears at 0
- Click opens a dropdown panel (280px wide, anchored above trigger)
- Panel shows 20 most recent notifications with severity icons
- Click outside closes panel (mousedown document listener)
- Mark one read: `POST /api/notifications/:id/read` → optimistic UI update
- Mark all read: `POST /api/notifications/mark-all-read`

**`frontend/src/api/client.js`:** Added `getNotifications`, `getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`.

**CSS:** `.notif-bell-wrap`, `.notif-bell-badge`, `.notif-panel`, `.notif-item`, `.notif-unread`, `.notif-read`, `.notif-mark-all`.

---

## Day 43 — Dashboard Live MOV + STK Widgets

**`backend/scripts/seed-demo-data.js` — extended:**
- Now imports `MovementOrderService` and `InventoryLedgerService`
- Creates 4 movement orders: ROUTINE, PRIORITY, IMMEDIATE (dispatched), EMERGENCY (dispatched)
- Creates 2 inventory sessions: Alpha Bn (open, 2 counts recorded), Beta Bn (finalized)
- `InventoryLedgerService` constructor: `(db, supplyChain, audit, notifications)` — supply is 2nd arg
- seeder `buildServices()` now returns `{ ..., movement, inventory }`
- Return object now includes `movementCount` and `inventoryCount`

**Dashboard integration:** `DashboardService` already receives `movement` and `inventory` from `app.js`. Seeder now populates data into those services so the dashboard widgets show `available: true` with real counts instead of `available: false`.

**Test:** Day 43 verify script creates a full seeder run and asserts `dashboard.getSummary()` returns `movement.available === true` and `stocktake.available === true`.

---

## Day 44 — Password Change Page

**`frontend/src/pages/PasswordChangePage.jsx`** — route: `/profile/password`

**Strength meter:**
- 4 rules: ≥8 chars, contains digit, contains uppercase, contains special char
- Visual bar: 4 segments fill left-to-right with colour (red→orange→yellow→green)
- Labels: Weak / Fair / Good / Strong
- Per-rule checklist below the bar (○ → ✓ as each rule is met)

**Validation:**
- Old password required
- New password must score ≥ 2 on strength
- Confirm must match new
- New must differ from old (self-change guard)
- Submit button disabled until all conditions met

**Error handling:**
- 401 → "Current password is incorrect."
- 400 → backend message or "does not meet requirements."
- 503 → "Database unavailable in offline mode — cannot change password."

**Sidebar:** `/profile/password` NavLink in the user identity block (below unit code). Active state shown.

**`frontend/src/api/client.js`:** Added `changePassword(oldPassword, newPassword)`.

**CSS:** `.pw-card`, `.pw-strength`, `.pw-strength-bar`, `.pw-bar-segment`, `.pw-rules`, `.pw-rule-met`, `.pw-strong/good/fair/weak`, `.sidebar-pw-link`.

---

## Day 45 — CSV Export + Search Persistence

### useSearchState hook

**`frontend/src/hooks/useSearchState.js`**
```js
const [filters, setFilters] = useSearchState('transfers', { statusFilter: 'ALL' });
```
- Persists to `sessionStorage` with namespace `sangam:search:{key}`
- Reads stored value on mount, merges with defaults (stored values win)
- All sessionStorage calls wrapped in try/catch (private browsing safe)
- Exports `clearSearchState(key)` for programmatic reset

**Applied to:**
- `ItemListPage` — key `'items'`, state `{ search, category, lowStockOnly }`
- `TransferListPage` — key `'transfers'`, state `{ statusFilter }`
- `AlertListPage` — key `'alerts'`, state `{ sevFilter }`

### ReportsPage

**`frontend/src/pages/ReportsPage.jsx`** — route: `/reports`

Four export cards in a responsive grid:
| Type | Content | Date Range? |
|------|---------|-------------|
| stock-levels | Current inventory by unit | No |
| transfers | Transfer register | Yes |
| unit-roster | Unit hierarchy + counts | No |
| mesh-health | Peer connectivity summary | No |

- Global date range picker (start / end) applies to transfer export
- Per-card ⬇ Export CSV button → triggers browser file download
- Downloading state shown per card (not all disabled)
- 403/other errors shown as feedback banner
- Sidebar REPORTS link (⬇ icon)

**`frontend/src/api/client.js`:** `exportCSV(type, params)`:
- Uses `fetch()` directly (not `request()`) to get a blob response
- Creates object URL → synthetic `<a>` click → download
- Revokes object URL after click (no memory leak)

**Backend:** `GET /api/reports/export/:type` already existed with `reports:export` permission (OFFICER+, COMMANDER, SYSTEM_ADMIN).

**CSS:** `.report-grid`, `.report-card`, `.report-export-btn`, `.report-date-range`, `.report-note`.

---

## Complete Route Table (Day 45)

| Path | Page | Access |
|------|------|--------|
| `/` | Dashboard | All |
| `/supply/items` | Item List | All |
| `/supply/transfers` | Transfer Register | All (approve: OFFICER+) |
| `/supply/transfers/new` | New Transfer | All |
| `/supply/blockchain` | Blockchain Ledger | All |
| `/alerts` | Alert Monitor | All |
| `/movement` | Movement Orders | All (dispatch: OFFICER+) |
| `/inventory` | Stock-Take | All (finalize: NCO+) |
| `/reports` | CSV Exports | All with reports:export |
| `/audit` | Audit Log | SYSTEM_ADMIN |
| `/admin/users` | User Management | SYSTEM_ADMIN |
| `/profile/password` | Change Password | All (self only) |

---

## Full Component Inventory (Day 45)

### Pages (13)
LoginPage, DashboardPage, ItemListPage, TransferListPage, TransferCreatePage, BlockchainPage, AlertListPage, MovementOrderPage, InventoryPage, ReportsPage, AuditLogPage, UserManagementPage, PasswordChangePage

### Components (10)
Sidebar, Modal, DemoBanner, NotificationBell, TransferDetailModal, Widget, ActivityFeed, BlockchainSeal

### Hooks (1)
`hooks/useSearchState.js`

---

## Test Count by Day

| Day | Tests |
|-----|-------|
| 11–30 | 896 |
| 31–40 | 479 |
| 41 | 27 |
| 42 | 25 |
| 43 | 28 |
| 44 | 33 |
| 45 | 53 |
| Scope Contract | 16 |
| **Total** | **1,500** |

---

## Demo Credentials (`npm run seed:demo`)

| Username | Password | Role | Scope |
|----------|----------|------|-------|
| admin | Admin@1234 | SYSTEM_ADMIN | Full system |
| brig.sharma | Officer@1234 | COMMANDER | Full brigade |
| lt.col.verma | Officer@1234 | OFFICER | Alpha Bn |
| maj.singh | Officer@1234 | OFFICER | Beta Bn |
| hav.kumar | Soldier@1234 | NCO | Alpha Bn |

Seeder creates: 5 units, 5 users, 20 items, 7 transfers, 4 movement orders, 2 inventory sessions, 3+ alerts.

---

## npm Scripts

```bash
npm run test:all      # 1,500 tests across all 33 verify scripts
npm run test:day45    # Day 45 only (53 tests)
npm run seed:demo     # Full demo dataset
npm run start         # Production server
npm run migrate       # DB migrations
```

---

## Critical Invariants

1. `RBACService.getCommandScope()` → `{ids, codes}` — always unwrap `.ids`
2. Actor attribution → `req.user.userId` (not `.id`)
3. Valid categories: `AMMO RATIONS FUEL MEDICAL EQUIPMENT COMMS VEHICLE_PARTS CLOTHING ENGINEERING GENERAL`
4. `AlertEscalationService.scan(scopeUnitIds)` — not `scanAll()`
5. `InventoryLedgerService(db, supplyChain, audit, notifications)` — supply is 2nd arg
6. `UnitManagementService.getUnitIds()` — public method, never access `._units`
7. `normalizeUser()` in App.jsx — ensures `userId` is always set from both login and `/me`
8. `createApp(db, services={}, options={})` — services is 2nd arg

---

## Days 46–60 Plan

| Day | Feature |
|-----|---------|
| 46 | Unit detail page (drill-down from dashboard) |
| 47 | Blockchain block detail panel (click a block to expand) |
| 48 | Alert detail expand + full escalation history |
| 49 | Demo walk-through mode (guided overlay for stakeholder presentation) |
| 50 | Performance audit + lazy loading |
| 51–59 | Stakeholder feedback iteration |
| 60 | **DEMO DAY** |

**#1 strategic risk:** Army stakeholder still not confirmed. The Day 45 system is demo-ready — schedule the first walkthrough now.
