# SANGAM — Project Context (Day 40)

## Identity
**SANGAM** — Permissioned blockchain-based supply chain management for Indian Army logistics  
**Sprint:** 90-day solo MVP (Day 1–60 = vertical-slice demo; Day 61–90 = polish)  
**Day:** 40 complete — 20 days to demo deadline  
**Working directory:** `/home/claude/SANGAM-PRODUCTION`

---

## Test Baseline
**1,334 tests — 0 failures** (`npm run test:all`)

---

## Architecture

### Backend (Node.js 22 + Express 5)
- 17 services in `backend/src/services/`
- 16 route files in `backend/src/routes/`
- Offline-first: all services work with `db=null` (in-memory Maps as primary store)
- JWT auth with refresh-token rotation + account lockout
- AES-256-GCM audit log encryption
- 7 alert types + auto-escalation

### Frontend (React 18 + Vite 5)
- 11 pages, 6 components
- Sidebar layout (220px fixed, off-canvas on mobile)
- Design: dark ops-console, IBM Plex Sans/Mono, Oswald, brass-gold `#C9A227`
- 10 routes (see table below)
- Print styles via `@media print`

---

## Route Table

| Path | Page | Access |
|------|------|--------|
| `/` | DashboardPage | All |
| `/supply/items` | ItemListPage | All |
| `/supply/transfers` | TransferListPage | All (approve: OFFICER+) |
| `/supply/transfers/new` | TransferCreatePage | All |
| `/supply/blockchain` | BlockchainPage | All |
| `/alerts` | AlertListPage | All |
| `/movement` | MovementOrderPage | All (actions: OFFICER+) |
| `/inventory` | InventoryPage | All (finalize: NCO+) |
| `/audit` | AuditLogPage | SYSTEM_ADMIN only |
| `/admin/users` | UserManagementPage | SYSTEM_ADMIN only |

---

## Critical Invariants (tests enforce all of these)

1. `RBACService.getCommandScope()` returns `{ids, codes}` — always unwrap `.ids`
2. Actor attribution always `req.user.userId`, never `req.user.id`
3. Valid supply categories: `AMMO, RATIONS, FUEL, MEDICAL, EQUIPMENT, COMMS, VEHICLE_PARTS, CLOTHING, ENGINEERING, GENERAL`
4. `createApp(db, services={}, options={})` — services is 2nd arg
5. `AlertEscalationService.scan()` not `scanAll()`
6. `app.locals.services.alerts` must be the single shared singleton
7. `UnitManagementService.getUnitIds()` — public method; never access `._units` directly
8. `db=null` mode must be fully supported and tested in every service
9. `normalizeUser()` in App.jsx ensures `userId` is always set (login → `id`, /me → `id`)

---

## Demo Data (`npm run seed:demo`)

Creates 5 units → 5 users → 20 items → 7 transfers → 3 alerts.

Credentials:

| Username      | Password      | Role          |
|---------------|---------------|---------------|
| admin         | Admin@1234    | SYSTEM_ADMIN  |
| brig.sharma   | Officer@1234  | COMMANDER     |
| lt.col.verma  | Officer@1234  | OFFICER       |
| maj.singh     | Officer@1234  | OFFICER       |
| hav.kumar     | Soldier@1234  | NCO           |

---

## npm Scripts

```bash
npm run test:all     # Run all 29 verify scripts (1,334 tests)
npm run test:day40   # Day 40 integration suite (126 tests)
npm run seed:demo    # Populate demo dataset
npm run start        # Start production server
npm run migrate      # Apply DB migrations
```

---

## Component Map

```
frontend/src/
├── App.jsx                    ← Root shell: sidebar layout, session, routing
├── api/client.js              ← 35 API methods
├── components/
│   ├── Sidebar.jsx            ← Nav rail: active routes, badges, mobile hamburger
│   ├── Modal.jsx              ← Reusable overlay (Escape + focus trap)
│   ├── DemoBanner.jsx         ← Collapsible demo credential cheat-sheet
│   ├── Widget.jsx             ← Dashboard metric card
│   ├── ActivityFeed.jsx       ← Severity-coded audit event feed
│   └── BlockchainSeal.jsx     ← Blockchain widget card
├── pages/
│   ├── LoginPage.jsx          ← Full ops-console aesthetic
│   ├── DashboardPage.jsx      ← 8-widget overview
│   ├── ItemListPage.jsx       ← Supply item catalogue
│   ├── TransferListPage.jsx   ← Transfer register + reject modal
│   ├── TransferCreatePage.jsx ← New transfer form
│   ├── BlockchainPage.jsx     ← Ledger viewer + verify
│   ├── AlertListPage.jsx      ← Alert monitor + scan
│   ├── MovementOrderPage.jsx  ← Order management (priority cards)
│   ├── InventoryPage.jsx      ← Stock-take sessions
│   ├── AuditLogPage.jsx       ← Admin audit log (SYSTEM_ADMIN only)
│   └── UserManagementPage.jsx ← User CRUD (SYSTEM_ADMIN only)
└── styles/global.css          ← 2,200+ lines; all design tokens + components
```

---

## Days 41–60 Plan (Demo Polish)

**Highest impact for stakeholder demo:**

| Day | Feature |
|-----|---------|
| 41 | Transfer detail modal (timeline + blockchain hash) |
| 42 | Notification bell (live count badge from NotificationService) |
| 43 | Dashboard live MOV + STK widgets (wire seeder to app services) |
| 44 | Password change page |
| 45 | Export to CSV (reporting routes already have endpoint) |
| 46 | Search persistence (sessionStorage per page) |
| 47 | Blockchain block detail panel |
| 48 | Alert detail expand (show full escalation history) |
| 49 | Demo walk-through script + keyboard shortcuts |
| 50 | Performance audit + lazy loading |
| 51–59 | Stakeholder feedback iteration |
| 60 | **DEMO DAY** |

**Army stakeholder engagement** remains the #1 strategic risk.  
Target: NDA, MCEME, or AFMS logistics division contacts.  
Use the Day 40 polished UI + seed demo for the first walkthrough.

---

*Last updated: Day 40 — 1,334/1,334 tests passing*
