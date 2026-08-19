# Day 26 — Live Command Dashboard
## SANGAM Supply Chain Management System

---

## Why This Day Exists

An LLM Council review at Day 21 delivered a unanimous verdict: **SANGAM has no UI**, and that is the single highest-priority gap before any Army demo. Twenty-seven (now far more) REST endpoints are invisible to a non-technical evaluator. The fix path agreed:

1. Finish the remaining critical APIs (Days 22–25 — done)
2. **Build a single live-data dashboard endpoint** (today)
3. Spike a React screen consuming it (Day 27)
4. Build the full vertical-slice demo around that screen (Days 28–60)

## The Integration Gap This Closes

Day 12 built `ReportingService` — but it queries PostgreSQL directly (`db.query(...)`). Days 19–25 built five new services (`SupplyChainService`, `UnitManagementService`, `UserManagementService`, `InventoryLedgerService`, `MovementOrderService`) that are **offline-first in-memory stores**. They do not write through Day 12's SQL tables in real time.

Practically: if the Army demo runs offline (the core architectural promise of SANGAM), Day 12's dashboard would show **empty data** even while the system is fully operational. Day 26 fixes this by building a dashboard that reads directly from the live in-memory services — the same services the React UI will call through the REST layer.

## What `DashboardService` Aggregates

A single Army Commander viewing one screen needs to answer, in under five seconds:

| Question | Data Source |
|---|---|
| How many units do I command? | `UnitManagementService.getUnitsInScope()` |
| How many soldiers/officers under me? | `UserManagementService.getUserStats()` |
| What's our supply position? | `SupplyChainService.getItemsInScope()` |
| What needs urgent attention? | Low-stock items, pending transfers, NOT_COUNTED stock-take items |
| Is anything moving right now? | `MovementOrderService.getActiveOrdersForUnit()` |
| Is the ledger trustworthy? | `SupplyChainService.verifyChain()` |
| What just happened? | Recent audit log entries (last N) |

## Design Principles

- **Single call, single response.** The React dashboard makes ONE API call (`GET /dashboard/summary`) and gets everything needed for a first render. Drill-down screens use the existing Day 19–25 endpoints.
- **Short-lived cache (30s).** Live enough to feel real-time, cheap enough not to recompute on every keystroke.
- **Graceful partial degradation.** If one sub-service is unavailable, that section reports `{ available: false }` rather than failing the whole response.
- **No new state.** This service holds no data of its own — it is a pure read-aggregator over the services constructed in `app.js`.

## Response Shape (Stable Contract for the Frontend)

```json
{
  "success": true,
  "generatedAt": "...",
  "scope": { "unitId": 10, "unitName": "...", "scopeSize": 4 },
  "units":     { "total": 4, "active": 4, "byType": {...} },
  "personnel": { "total": 38, "active": 36, "byRole": {...} },
  "supply":    { "totalItems": 142, "lowStockCount": 6, "byCategory": {...} },
  "transfers": { "pending": 3, "completedToday": 8, "approvalRate": "94%" },
  "movement":  { "activeOrders": 2, "inTransit": 1, "emergencyCount": 0 },
  "blockchain":{ "verified": true, "blockCount": 211 },
  "stocktake": { "activeSessions": 1, "openDiscrepancies": 2 },
  "recentActivity": [ {...}, {...} ]
}
```

This shape is the contract the React dashboard (Day 27) will be built against — designed to render without further client-side computation.
