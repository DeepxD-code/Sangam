# Day 12: Reporting & Analytics Service
## SANGAM Supply Chain Management System

---

## One Dashboard, Not Six Logins

A Brigade Commander does not want to log into three battalion systems and
manually add up ammunition counts. They want **one number**: "how much
7.62mm ammunition does my Brigade currently hold, broken down by
battalion, with anything below threshold flagged."

Day 12 builds the **Reporting & Analytics Service** — the dashboard layer
that sits on top of every service built so far.

---

## The Same Tool, Used in Reverse

Day 11 used `RBACService.isInCommandScope(viewerUnit, sourceUnit)` for
**escalation visibility**: "does my unit command the unit this alert came
from?"

Day 12 uses the underlying primitive — `RBACService.getCommandScope(unitId)`,
which returns *self + every descendant unit* — for **aggregation**:

```
Brigade Commander (unit 26)
  getCommandScope(26) → { ids: [26, 11, 12, 101, 102, 103, 104, 105, ...] }
                              │
                              ▼
        SELECT ... WHERE unit_id = ANY(scope.ids)
                              │
                              ▼
        One query returns Brigade-wide totals, no per-unit looping
```

Same building block, opposite direction. Day 11 asks "who is above me?" —
Day 12 asks "what's below me?" Both collapse to one `getCommandScope` call
plus a `WHERE unit_id = ANY($1)`.

---

## Six Reports, One Service

| Report | Source | Gate |
|--------|--------|------|
| **Stock Levels** | `supply_items` × command scope | `reports:read` |
| **Transfer Activity** | `transfers` × command scope, time window | `reports:read` |
| **Blockchain Health** | `blockchain_blocks` | `reports:read` |
| **Mesh Network Health** | Day 11 notification history (no new table!) | `reports:read` |
| **Security Posture** | Day 13 audit log + Day 11 pending-acks | `reports:advanced` |
| **Unit Roster** | `command_units` × command scope | `reports:read` |

`getDashboardSummary()` runs all six in parallel and returns one payload —
the command-center landing page.

---

## Free Lunch: Mesh Health From Notifications

Rather than stand up a new `mesh_peers` table and a polling job, Day 12
derives network health from data that **already exists**: every time Day
10's mesh layer fires a peer-status change, Day 11 logged a
`MESH_PEER_ONLINE` / `MESH_PEER_OFFLINE` notification.

```javascript
const { notifications } = await notificationService.getForUser(userContext, { limit: 500 });

const meshEvents = notifications.filter(n =>
  n.type === 'MESH_PEER_ONLINE' || n.type === 'MESH_PEER_OFFLINE'
);

// Most recent event per peer = current status
const latestByPeer = new Map();
for (const n of meshEvents) {
  if (!latestByPeer.has(n.resourceId)) latestByPeer.set(n.resourceId, n);
}
```

Because `getForUser()` already applies Day 11's command-scope visibility,
**a Company Commander automatically only sees their own platoons' peers** —
zero extra filtering code. This is the same "same tool, opposite direction"
story: Day 11's *escalation* filter, reused unchanged, happens to *also*
produce the right *aggregation* set for this one report.

---

## Security Posture = Day 13 + Day 11, Combined

```javascript
{
  windowHours: 24,
  securityEventCount: 7,    // from AuditLogService.query() — SECURITY+CRITICAL rows
  criticalEventCount: 1,    // BLOCKCHAIN_TAMPER_DETECTED etc.
  pendingAcknowledgments: 2 // from NotificationService — requiresAck && !acknowledged
}
```

Neither number required new infrastructure. The audit hash chain (Day 13)
and the notification acknowledgment tracker (Day 11) were both built to
answer exactly this question — Day 12 just asks it.

---

## Defensive Schema: Tables This Service Depends On

Stock, transfer, and blockchain reports assume `supply_items`, `transfers`,
and `blockchain_blocks` tables (built in earlier sprint days). Day 12's
migration adds `CREATE TABLE IF NOT EXISTS` definitions for these — **not**
to redefine them, but as a safety net so this service's queries don't fail
on a fresh database, and so the demo environment is self-contained.

Every report method checks `if (!this.db) return { available: false, ... }`
— the same graceful-degradation pattern as `RBACService.getCommandScope()`
and `AuditLogService`. A report section being unavailable never crashes the
dashboard; it just shows as empty.

---

## Caching: 5-Minute Dashboard TTL

`getDashboardSummary()` runs six aggregation queries. For a busy command
terminal refreshing every few seconds, that's wasteful. Results are cached
per `(userId, unitId)` for 5 minutes:

```
First call  → runs all 6 reports, caches result
Next calls  → instant cache hit (within 5 min)
{ forceRefresh: true } → bypasses cache (e.g., "Refresh" button)
```

Cache key includes `unitId` because the same user's scope could change if
their unit assignment changes — though in practice this is rare mid-session.

---

## Generic CSV Export

Rather than a bespoke exporter per report type (as Day 13 did for the fixed
audit-log schema), Day 12's `exportReportToCSV()` is generic: given any
array of row objects, it derives headers from the first row's keys. Any
report — stock levels, transfers, unit roster — can be piped straight to
CSV with one function.

---

## What's Next

With Days 11–13 closing the gap and adding the security layer, **Day 14**
returns to the original roadmap: the **Auth Login Flow** — `POST
/auth/login` with account lockout, refresh token rotation, and brute-force
detection that feeds directly into Day 13's audit log and Day 11's
`SECURITY_ALERT` notifications.
