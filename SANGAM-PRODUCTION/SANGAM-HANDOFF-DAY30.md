# SANGAM — Developer Handoff — Day 30 of 90
## "Pick this up and run — everything you need to continue without asking"

---

## READ THIS FIRST

This document tells you exactly what to do next, in what order, and why. The
context document (`SANGAM-PROJECT-CONTEXT-DAY30.md`) covers the full
architecture. This document is about **what to build** from Day 31 onwards.

The project is at a natural milestone. The backend API surface is complete
(16 routes, 17 services, 935 tests passing). The frontend has two screens
(Dashboard overview + Supply item list). The LLM Council mandated a
**vertical-slice demo** for Days 31–60. That means: one complete Army workflow,
end-to-end in the UI, compelling enough for a 10-minute stakeholder demo.

---

## IMMEDIATE NEXT STEPS (Day 31)

### Step 1 — Wire the alert poller (30 minutes)

`AlertEscalationService.scan()` is built and tested. It's never called
automatically. Add this to `backend/src/server.js`:

```js
// After the server starts listening, start the alert scan interval
const { services } = app.locals;
if (services.supply && services.inventory && services.movement) {
  const SCAN_INTERVAL_MS = 30 * 1000; // 30 seconds
  const rbac = services.rbac;
  const AlertEscalationService = require('./services/alert-escalation.service');
  const alertSvc = new AlertEscalationService({
    supply:    services.supply,
    inventory: services.inventory,
    movement:  services.movement,
    auditLog:  services.audit
  });
  app.locals.services.alerts = alertSvc;

  setInterval(async () => {
    try {
      // Scan all units in the system (get all known unit IDs)
      const allUnitIds = [...(services.units?._units?.keys() || [])];
      if (allUnitIds.length > 0) {
        await alertSvc.scan(allUnitIds);
      }
    } catch (err) {
      // Non-fatal — log silently
    }
  }, SCAN_INTERVAL_MS);
}
```

Then wire `alertSvc` into the alert routes:
```js
app.use('/api/alerts', createAlertRoutes(db, audit, {
  supply, inventory, movement, notifications,
  alertService: alertSvc  // pass the singleton
}));
```

And update `createAlertRoutes` to accept an injected `alertService` instance
instead of creating a new one each time (same pattern as all other routes).

**Verify:** `POST /api/alerts/scan` followed by `GET /api/alerts/active` should
now return real alerts based on your seeded data.

### Step 2 — Add alerts to the dashboard (45 minutes)

The `DashboardService.getSummary()` already has a `_stocktakeSection` and
`_movementSection`, but no `_alertsSection`. Add one:

```js
async _alertsSection(scopeIds) {
  if (!this.alerts) return { available: false };
  const active = this.alerts.getActiveAlerts(scopeIds);
  return {
    available:   true,
    totalActive: active.length,
    critical:    active.filter(a => a.severity === 'CRITICAL').length,
    escalated:   active.filter(a => a.status  === 'ESCALATED').length,
    byType:      active.reduce((acc, a) => { acc[a.type] = (acc[a.type]||0)+1; return acc; }, {})
  };
}
```

Then add an ALT widget to the React dashboard for alerts (clicking it navigates
to an `AlertListPage` — the next drill-down screen to build).

---

## THE VERTICAL SLICE TO BUILD (Days 31–45)

The most compelling demo flow is the **transfer approval workflow**. It shows:
1. A JCO requests a supply transfer (creates a ledger entry)
2. An officer approves it (ledger updated, blockchain block created)
3. The officer sees the blockchain integrity verified in real-time
4. If stock drops below threshold, an alert fires

This is the complete SANGAM value proposition in one 5-minute demo.

### Screens to build (in order):

**Screen 3 — Transfer List** (`/api/supply/transfers`)
- List pending + recent transfers in scope
- Each row shows: item, from→to unit, quantity, status, age
- Action button: "APPROVE" or "REJECT" (for PENDING transfers)
- Wire to existing `POST /api/supply/transfers/:id/approve`

**Screen 4 — Transfer Create Form**
- Simple form: select item (from item list), set quantity, select destination unit
- Wire to `POST /api/supply/transfers`
- On success: redirect to Transfer List showing new PENDING entry

**Screen 5 — Blockchain Viewer** (`/api/supply/blockchain`)
- Show last N blocks with blockIndex, hash (truncated), timestamp, item+quantity
- The "VERIFIED" seal from the dashboard expanded into a full block list
- Wire to `GET /api/supply/blockchain`
- Wire to `POST /api/supply/blockchain/verify` — big "VERIFY CHAIN" button

**Screen 6 — Alert List** (`/api/alerts`)
- Table of active alerts: severity badge, type, title, age, status
- "Acknowledge" and "Resolve" buttons
- Wire to `POST /api/alerts/:id/acknowledge` and `POST /api/alerts/:id/resolve`

### Router (add this in Day 31)

Install `react-router-dom@6`:
```bash
cd frontend && npm install react-router-dom
```

Replace the `useState(VIEWS.*)` pattern in `App.jsx` with proper routes:
```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

// Routes:
// /               → DashboardPage
// /supply/items   → ItemListPage (already built Day 29)
// /supply/transfers → TransferListPage (Day 31)
// /supply/blockchain → BlockchainPage (Day 32)
// /alerts         → AlertListPage (Day 32)
```

---

## DEMO SCRIPT (10-minute version for Army stakeholder)

This is what you're building towards. Practice this before any presentation.

**Setup (before demo):**
```bash
docker-compose up
# Navigate to http://localhost:3000
# Login: create a demo user via POST /api/auth/register (or seed script)
```

**The demo flow:**

1. **(30s) Login** — Show the restricted-access login screen. Type credentials.
   Point out: "Access controlled by rank and unit — a Havildar sees only his
   platoon's stores. A Subedar Major sees the whole company."

2. **(60s) Command Overview Dashboard** — Show the 7 SITREP widgets.
   Point out: "This is the live state of my command scope. If anything goes
   wrong — stock drops, a transfer stalls, an order gets delayed — I see it
   here immediately. No phone calls, no radio, no paperwork."

3. **(60s) Supply Items** — Click the SUP widget. Show the item list with search.
   Point out: "Every item, current quantity, status. Filter to LOW STOCK."
   If there are low-stock items, say: "See the alert — the engine flagged this
   automatically."

4. **(90s) Initiate a Transfer** — Click "New Transfer". Select an ammo item,
   quantity 200 rounds, destination: the forward company.
   Point out: "This creates a pending voucher — exactly like a DA-3161 but
   digital, timestamped, and waiting for officer approval."

5. **(60s) Approve the Transfer** — Switch to officer view (or show pending
   transfers). Click "APPROVE".
   Point out: "The approval is permanent. It can't be undone or backdated."

6. **(90s) Blockchain Integrity** — Navigate to the Blockchain Viewer.
   Show the new block: "That transfer just created a cryptographic block.
   Every block's hash is derived from the previous one."
   Click "VERIFY CHAIN": the VERIFIED seal appears.
   Say: "If anyone edits the database directly — changes a quantity, deletes
   a transfer — this verification fails. Immediately. Without waiting for a
   Board of Officers."

7. **(60s) Offline mode** — If possible, disconnect the laptop from wifi.
   Refresh the dashboard. It still loads. Still shows data. Still lets you
   create transfers.
   Say: "This works in the field. Forward Operating Bases, no internet. The
   blockchain ledger and all operational data live on-device."

8. **(60s) Q&A** — Let them ask. Common questions:
   - *"How is this different from AFMIS?"* → AFMIS requires connectivity and
     central DB access. SANGAM works offline and has cryptographic audit.
   - *"What happens when two bases sync?"* → The mesh sync protocol (already
     built, Day 9) merges records with conflict detection.
   - *"Can it be hacked?"* → Show the blockchain tamper detection — modify a
     block manually and re-verify to show it detects immediately.

---

## WHAT'S WIRED vs WHAT STILL NEEDS FRONTEND

| Backend API | Frontend Screen | Status |
|---|---|---|
| `GET /api/dashboard/summary` | Dashboard overview | ✅ Day 26/27 |
| `GET /api/supply/items` | Item list with filters | ✅ Day 29 |
| `GET /api/supply/transfers` | Transfer list | ❌ Day 31 |
| `POST /api/supply/transfers` | Transfer create form | ❌ Day 31 |
| `POST /api/supply/transfers/:id/approve` | Approve button in transfer list | ❌ Day 31 |
| `GET /api/supply/blockchain` | Blockchain viewer | ❌ Day 32 |
| `POST /api/supply/blockchain/verify` | Verify button | ❌ Day 32 |
| `GET /api/alerts` | Alert list | ❌ Day 32 |
| `POST /api/alerts/:id/acknowledge` | Acknowledge button | ❌ Day 32 |
| `GET /api/units` | Unit hierarchy tree | ❌ Day 33+ |
| `GET /api/users` | User roster | ❌ Day 33+ |
| `GET /api/inventory/sessions` | Stock-take history | ❌ Day 34+ |
| `GET /api/movement/orders` | Movement tracker | ❌ Day 35+ |
| `GET /api/compliance/chain-of-custody/:itemId` | Item audit trail | ❌ Day 36+ |

---

## RECURRING BUGS TO WATCH FOR

These bugs have bitten us multiple times. Know the pattern.

### 1. Stub service contract mismatch
**Symptom:** 835 tests pass, but authenticated requests return 500 in real use.  
**Cause:** A stub returns `[10, 11]` (plain array) when the real service returns `{ ids:[10,11], codes:[] }`.  
**Prevention:** After any change to service wiring or a new cross-service consumer, run `node backend/scripts/verify-scope-contract.js`. This boots the real app with a real JWT and hits 16 routes — no stubs, no shortcuts.

### 2. Missing shared singleton
**Symptom:** Data created via one route is invisible to another route or the dashboard.  
**Cause:** A new service was added to routes with the fallback `|| new Service()` but was never wired as a singleton in `app.js`.  
**Prevention:** Whenever you add a new service, immediately add it to `app.locals.services` in `app.js` and pass it explicitly to every route that needs it.

### 3. Backend response field name mismatch
**Symptom:** Frontend silently gets `undefined` where it expects a value (e.g. `result.token` instead of `result.accessToken`).  
**Cause:** Assuming field names from naming conventions rather than checking the actual backend source.  
**Prevention:** For every new frontend API call, open the actual route handler and service, trace the exact return object, and match field names character-for-character before writing client code.

### 4. `ARMS` as a supply category
**Symptom:** Item creation silently fails with `INVALID_CATEGORY`.  
**Cause:** `ARMS` is not a valid category. Valid ones are `AMMO, RATIONS, FUEL, MEDICAL, EQUIPMENT, COMMS, VEHICLE_PARTS, CLOTHING, ENGINEERING, GENERAL`.  
**Prevention:** Use `GET /api/supply/categories` in the frontend to populate category dropdowns — never hardcode.

### 5. `createApp` argument order
**Signature:** `createApp(db, services = {}, options = {})`  
Pass services as the **second** arg: `createApp(null, { supply, units }, { logLevel: false })`.  
Not: `createApp(null, {}, { logLevel: false }, { supply })` — the 4th arg is silently ignored.

---

## FILES ADDED THIS SESSION (Day 19–30)

### Backend services (new)
- `supply-chain.service.js`
- `compliance.service.js`
- `bulk-operations.service.js`
- `unit-management.service.js`
- `user-management.service.js`
- `inventory-ledger.service.js`
- `movement-order.service.js`
- `dashboard.service.js`
- `alert-escalation.service.js`

### Backend routes (new)
- `supply.routes.js`, `compliance.routes.js`, `bulk.routes.js`
- `unit.routes.js`, `user.routes.js`, `inventory.routes.js`
- `movement.routes.js`, `dashboard.routes.js`, `alert.routes.js`

### Backend verify scripts (new)
- `verify-day-19.js` through `verify-day-26.js`
- `verify-day-28.js`, `verify-day-30.js`
- `verify-scope-contract.js` (permanent HTTP integration guard)

### Frontend (entirely new — Day 27+)
- `frontend/` — React 18 + Vite 5 app
- `frontend/src/api/client.js` — typed API client
- `frontend/src/App.jsx` — session restore + view routing
- `frontend/src/pages/LoginPage.jsx`
- `frontend/src/pages/DashboardPage.jsx`
- `frontend/src/pages/ItemListPage.jsx` (Day 29 drill-down)
- `frontend/src/components/` — Widget, BlockchainSeal, ActivityFeed, TopBar
- `frontend/src/styles/global.css` — full design token system
- `frontend/scripts/verify-day-27.cjs`, `verify-day-29.cjs`

### Docs (new)
- `docs/day-20-compliance-reporting.md`
- `docs/day-26-live-dashboard.md`
- `docs/day-27-react-dashboard-spike.md`
- `docs/day-28-production-static-serving.md`

### Modified files
- `backend/src/app.js` — wired 9 new routers + shared singletons + static serving
- `backend/src/services/rbac.service.js` — added `units:*` permissions to matrix
- 7 route files — fixed `scopeFor()` to unwrap `{ids,codes}`
- `Dockerfile` — added frontend build stage
- `.dockerignore` — added `dist/`
- `package.json` — extended test scripts

---

## RUNNING THE TESTS

```bash
# Backend: all days
npm run test:all

# Backend: single day
node backend/scripts/verify-day-30.js

# HTTP integration (real Express + real JWT — catches stub-masking bugs)
node backend/scripts/verify-scope-contract.js

# Frontend: Day 27 component SSR tests
cd frontend && node scripts/verify-day-27.cjs

# Frontend: Day 29 interactive widget + real backend tests
cd frontend && node scripts/verify-day-29.cjs

# Frontend: production build (catches JSX/import errors)
cd frontend && npm run build
```

Expected output: **935 tests, 0 failures**.

---

## STRATEGIC REMINDERS FROM THE LLM COUNCIL

1. **Find a named Army stakeholder.** A demo without someone to receive it is wasted work. This is the highest-priority non-technical task.
2. **IP review before sharing externally.** The council flagged this. Don't send the codebase to anyone outside the project before reviewing for classification exposure.
3. **Demo before Day 60.** The council's deadline for the vertical-slice demo is Day 60. At the current pace (9 backend APIs + frontend + tests per session), this is achievable if the next session focuses on the transfer workflow UI (Days 31–36) and then polishes the demo script (Days 37–45) rather than adding more backend APIs.
4. **One thing at a time.** The backend is feature-complete for the demo. The bottleneck is now UI. Every future session should close the gap in the table under "WHAT'S WIRED vs WHAT STILL NEEDS FRONTEND" above, starting from the top.

---

*Last updated: End of Day 30 session. Next session begins at Day 31.*
