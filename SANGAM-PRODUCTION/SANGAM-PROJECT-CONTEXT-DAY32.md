# SANGAM — Project Context  (Day 32)

## Project Identity
**SANGAM** — Permissioned blockchain-based supply chain management system  
**Target:** Indian Army logistics stakeholder evaluation  
**Sprint:** 90-day solo MVP (Day 1–60 = vertical-slice demo; Day 61–90 = polish)  
**Current Day:** 32 complete  
**Working Directory:** `/home/claude/SANGAM-PRODUCTION`

---

## Architecture Snapshot

### Backend (Node.js 22 + Express 5)
- **17 services** — all in `backend/src/services/`
- **16 route files** — all in `backend/src/routes/`
- **JWT auth** with refresh-token rotation
- **AES-256-GCM** audit log encryption
- **In-memory + PostgreSQL** (offline-first, SQL optional)
- **7 alert types** in AlertEscalationService

### Frontend (React 18 + Vite 5)
- **Sidebar layout** (Day 32): fixed 220px left rail + scrolling main area
- **6 pages** all wired: Dashboard, Items, Transfers, TransferCreate, Blockchain, Alerts
- **Design system**: dark ops-console, IBM Plex Sans/Mono, Oswald, brass-gold `#C9A227`
- **Offline-first**: no CDN runtime deps, fonts via `@fontsource` npm packages

### Database
- SQLite-compatible SQL (dev) / PostgreSQL (prod)
- 7 migration files in `database/migrations/`

---

## Test Baseline — Day 32

**975 tests, 0 failures** across all days.

| Days | Tests |
|------|-------|
| 11–30 (prior) | 896 |
| 31 | 22 |
| 32 | 57 |
| **Total** | **975** |

Run: `npm run test:all`

---

## Critical Architectural Invariants

These rules are enforced by tests — violating them breaks things:

1. **`RBACService.getCommandScope()`** returns `{ids, codes}` — always unwrap `.ids`, never treat as plain array
2. **Actor attribution** uses `req.user.userId` (not `req.user.id`) — 36 historical call sites had this wrong; fixed Day 27
3. **Valid supply categories:** `AMMO, RATIONS, FUEL, MEDICAL, EQUIPMENT, COMMS, VEHICLE_PARTS, CLOTHING, ENGINEERING, GENERAL` — `ARMS` is invalid
4. **Offline-first:** All services degrade gracefully when `db` is null
5. **`createApp(db, services={}, options={})`** — services is the second argument
6. **`app.locals.services.alerts`** must be the single shared `AlertEscalationService` singleton
7. **`UnitManagementService.getUnitIds()`** — use this public method; never access `._units` directly
8. **`AlertEscalationService.scan(scopeUnitIds)`** — method is `scan()` not `scanAll()`
9. **In-memory/SQL ID alignment:** Unit IDs in `UnitManagementService._units` and `command_units` SQL table are independent — order of creation matters for RBAC scope filtering

---

## Unit Hierarchy (UNIT_TYPES, ascending authority)
```
SECTION < PLATOON < COMPANY < BATTALION < BRIGADE < DIVISION < CORPS < COMMAND
```
Child must have strictly lower TYPE_RANK than parent.

## User Roles & Rank Levels
| Role | rankLevel | Access |
|------|-----------|--------|
| SOLDIER | 1 | Read-only, own unit |
| NCO | 2 | Unit scope |
| JCO | 2 | Unit scope |
| LOGISTICS_OFFICER | 3 | Command scope |
| OFFICER | 3 | Command scope, can approve transfers |
| SENIOR_OFFICER | 3 | Command scope |
| COMMANDER | 3 | Full command scope |
| AUDITOR | 3 | Read-only all |
| SYSTEM_ADMIN | 5 | System-wide |

---

## Frontend Layout (Day 32)

```
<div class="app-layout">          ← flex row
  <nav class="sidebar">           ← fixed 220px left rail
    wordmark → nav links → status dot → user identity → logout
  </nav>
  <main class="app-main">         ← flex-grow, overflow-y: auto
    <div class="page-content">    ← max-width 1100px, padded
      <div class="page-header">   ← title left, action right
      ... page body ...
    </div>
  </main>
</div>
```

### Mobile (≤ 768px)
- Sidebar slides off-canvas (translateX(-100%))
- `.sidebar--open` translates back to 0
- Hamburger button (`.sidebar-hamburger`) appears top-left, fixed
- Dark overlay backdrop (`.sidebar-overlay`) closes sidebar on tap
- `app-main` gets `padding-top: 56px` to clear hamburger

### Tiny (≤ 480px)
- Widget grid drops to 1-column
- Tabs wrap
- Page title shrinks to 20px

---

## Demo Data Seeder

`npm run seed:demo` → `backend/scripts/seed-demo-data.js`

Creates a complete vertical-slice demo dataset:
- **5 units**: 1 Brigade → 3 Battalions → 1 Company
- **5 users**: SYSTEM_ADMIN, COMMANDER, 2× OFFICER, NCO
- **20 items**: Ammo, Rations, Fuel, Medical, Comms, Equipment (realistic Indian Army nomenclature)
- **7 transfers**: 4 PENDING, 2 APPROVED, 1 REJECTED
- **3 alerts**: Auto-raised for below-threshold stock levels

Credentials:
```
admin         / Admin@1234    (SYSTEM_ADMIN)
brig.sharma   / Officer@1234  (COMMANDER)
lt.col.verma  / Officer@1234  (OFFICER — Alpha Bn)
maj.singh     / Officer@1234  (OFFICER — Beta Bn)
hav.kumar     / Soldier@1234  (NCO — Alpha Bn)
```

---

## npm Scripts (package.json)

```bash
npm run test:all         # runs all day verify scripts + scope contract
npm run test:day32       # Day 32 only
npm run test:day31       # Day 31 only
npm run seed:demo        # populate fresh demo data
npm run migrate          # apply DB migrations
npm run start            # start production server
```

---

## File Map — Key Files

```
SANGAM-PRODUCTION/
├── backend/
│   ├── src/
│   │   ├── server.js                        ← Express app factory (createApp)
│   │   ├── services/
│   │   │   ├── unit-management.service.js   ← getUnitIds() added Day 32
│   │   │   ├── supply-chain.service.js      ← items, transfers, blockchain
│   │   │   ├── alert-escalation.service.js  ← scan(), 7 alert types
│   │   │   ├── rbac.service.js              ← getCommandScope() → {ids, codes}
│   │   │   └── auth.service.js              ← JWT + bcrypt + pepper
│   │   └── routes/
│   │       ├── supply.routes.js
│   │       ├── alerts.routes.js
│   │       └── auth.routes.js
│   └── scripts/
│       ├── verify-day-32.js                 ← Day 32 test suite (57 tests)
│       ├── seed-demo-data.js                ← Demo data seeder
│       └── verify-day-*.js                  ← All prior day tests
├── frontend/
│   └── src/
│       ├── App.jsx                          ← Sidebar layout shell (Day 32)
│       ├── components/
│       │   ├── Sidebar.jsx                  ← NEW Day 32
│       │   ├── Widget.jsx
│       │   ├── BlockchainSeal.jsx
│       │   ├── ActivityFeed.jsx
│       │   └── TopBar.jsx                   ← Kept but unused (remove Day 33)
│       ├── pages/
│       │   ├── DashboardPage.jsx            ← Refactored Day 32
│       │   ├── ItemListPage.jsx             ← Refactored Day 32
│       │   ├── TransferListPage.jsx         ← Refactored Day 32 (role-aware)
│       │   ├── TransferCreatePage.jsx       ← Refactored Day 32
│       │   ├── BlockchainPage.jsx           ← Refactored Day 32
│       │   ├── AlertListPage.jsx            ← Refactored Day 32
│       │   └── LoginPage.jsx                ← Not yet refactored (Day 33)
│       ├── api/client.js                    ← All API calls, token management
│       └── styles/global.css               ← 1350+ lines; sidebar CSS appended Day 32
├── .env.example                             ← Added Day 32
├── .dockerignore                            ← Added Day 32
└── package.json                             ← Updated Day 32 scripts
```

---

## Day 33 Plan

**Priority 1 — Form CSS** (blocking visual quality)
- Define all missing form CSS classes: `.form-card`, `.form-group`, `.form-label`, `.form-select`, `.form-input`, `.form-textarea`, `.form-actions`, `.form-readonly`, `.field-error`, `.form-error-banner`
- Also: `.filter-bar`, `.filter-toggle`, `.status-pill .low`, `.status-pill .ok`, `.item-code-cell`, `.item-name-cell`, `.qty-cell`, `.table-empty`, `.action-cell`, `.feedback-banner`, `.feedback-close`

**Priority 2 — Transfer Reject Modal**
- Rejection reason textarea in a modal overlay (not hardcoded string)
- Reusable `Modal.jsx` component

**Priority 3 — Login Page Polish**
- Centered card layout matching ops-console aesthetic
- Unit code display on successful login
- Remove any stale top-bar references

**Priority 4 — TopBar Cleanup**
- Delete `TopBar.jsx` (no longer imported)
- Confirm `grep -r "TopBar" frontend/src` returns empty

**Priority 5 — Verify-day-33.js**
- Test form CSS classes exist
- Test Modal component
- Test rejection modal workflow (mock API)
- Assert `seedDemoData()` returns correct structure

---

## Strategic Status

- **Day 60 target:** Complete vertical-slice demo — on track
- **Army stakeholder:** Not yet identified — remains #1 strategic risk  
  → Action: Use demo data + Day 32 polished UI to schedule first stakeholder walkthrough
- **LLM Council (Day 21):** Two priorities — secure champion, airtight demo path  
  → Demo path is now visually solid with Sidebar + seed data

---

*Last updated: Day 32 complete — 975/975 tests passing*
