# Day 11: Notification & Alert Service
## SANGAM Supply Chain Management System

---

## Why Notifications Matter in Military Logistics

A platoon's ammunition stock drops below the safety threshold at 0300 hours in a forward post. The platoon JCO sees it on his terminal — but so should the Company Commander, the Battalion's Logistics Officer, and anyone else in the chain of command who can act on it.

A mesh peer goes silent for six hours. Someone needs to know — not just the soldier sitting at that terminal, but the network admin responsible for that sector.

A tamper attempt is detected in the audit log (Day 13). That is not a "check it when convenient" event — it needs to reach a Senior Officer or Auditor **immediately**, and they need to formally acknowledge they've seen it.

SANGAM's Notification Service answers one question for every event in the system:

> **"Who needs to know about this, and how urgently?"**

---

## 1. The Notification Model

Every notification has:

```javascript
{
  id, type, severity, title, message,
  sourceUnitId,     // WHERE this happened
  minRankLevel,     // WHO is senior enough to care
  targetUserId,     // optional: a SPECIFIC person (personal notifications)
  targetRole,       // optional: restrict to a specific role
  resourceType, resourceId,  // WHAT this is about
  requiresAck,      // must the recipient formally acknowledge?
  createdAt, expiresAt
}
```

### Two Delivery Models

**1. Personal** (`targetUserId` set)
"Your transfer request was approved." Only that one user sees it — no rank or scope check needed.

**2. Scoped Broadcast** (`sourceUnitId` + `minRankLevel`)
"Low stock at Platoon X." Visible to anyone whose rank meets `minRankLevel` **and** whose unit commands (or is) the source unit.

---

## 2. Reusing Day 13's Command Scope — The Escalation Pattern

This is the key design decision of Day 11: **notification visibility reuses `RBACService.isInCommandScope()` directly.**

```
LOW_STOCK alert at "1 Platoon, Alpha Company" (unit 103)
minRankLevel = 5 (JCO and above)

┌─────────────────────────────┬──────────┬─────────────────┬─────────┐
│ Viewer                       │ Rank ≥ 5?│ Commands unit 103?│ Visible?│
├─────────────────────────────┼──────────┼─────────────────┼─────────┤
│ Soldier, 1 Platoon (same unit)│ No (1)  │ —                │ ❌      │
│ JCO, 1 Platoon (same unit)    │ Yes (5) │ Yes (self)       │ ✅      │
│ Captain, Alpha Company        │ Yes (7) │ Yes (commands 1Pl)│ ✅      │
│ Captain, Bravo Company (sibling)│ Yes (7)│ No (different branch)│ ❌  │
│ Lt Col, Battalion              │ Yes (8)│ Yes (commands all)│ ✅      │
└─────────────────────────────┴──────────┴─────────────────┴─────────┘
```

This is **escalation visibility**: an issue at a low unit becomes visible to everyone in its chain of command, but never "leaks sideways" to sibling units. A single `isInCommandScope()` call — already built and tested on Day 13 — does both the rank gate's complementary job and the unit-isolation job in one line.

> **Scope note:** This handles "subordinate issue → commander sees it." The reverse — "HQ broadcast → all subordinates see it" — is a Day 12+ enhancement. For now, `SYSTEM_ANNOUNCEMENT` defaults to Army-wide (no unit scoping), and transfer decisions go directly to the requesting user (personal model).

---

## 3. Severity & Rank Defaults

| Type | Default Severity | Min Rank | Rationale |
|------|------------------|----------|-----------|
| `LOW_STOCK` | MEDIUM | 5 (JCO) | Company-level supply decision |
| `TRANSFER_PENDING` | MEDIUM | 6 (Logistics Officer) | Matches `supply:approve` permission |
| `TRANSFER_APPROVED` | LOW | — (personal) | Direct to requester |
| `TRANSFER_REJECTED` | MEDIUM | — (personal) | Direct to requester |
| `MESH_PEER_OFFLINE` | HIGH | 6 | Network health is a logistics concern |
| `MESH_PEER_ONLINE` | LOW | 6 | Recovery — informational |
| `SYNC_CONFLICT` | HIGH | 6 | Needs manual resolution |
| `SECURITY_ALERT` | HIGH | 8 (Senior Officer) | Matches `audit:read` permission |
| `BLOCKCHAIN_TAMPER` | CRITICAL | 8 | Highest-priority integrity event |
| `SYSTEM_ANNOUNCEMENT` | LOW | 1 (everyone) | General information |

These are **defaults** — `create()` accepts overrides for special cases.

---

## 4. Read vs. Acknowledge — Two Different Promises

| Action | Means | Who needs it |
|--------|-------|--------------|
| **Read** | "I've seen this exists" | Routine notifications |
| **Acknowledge** | "I have reviewed this and am taking responsibility for awareness" | `requiresAck = true` — auto-set for CRITICAL |

A CRITICAL `BLOCKCHAIN_TAMPER` notification sitting unacknowledged is itself useful information — the digest surfaces "2 CRITICAL alerts awaiting acknowledgment" so command knows a tamper event hasn't yet been seen by anyone senior.

**Notifications are never deleted** — only read/acknowledged per-user. This preserves the same immutability philosophy as Day 13's audit log: a CRITICAL alert can't quietly disappear from the system.

---

## 5. Real-Time Delivery: Server-Sent Events (SSE)

```
Client connects → GET /notifications/stream  (long-lived HTTP connection)
                        │
Server holds connection open, subscribes client with their UserContext
                        │
New notification created → service checks isVisibleTo(notification, subscriberContext)
                        │
                  Visible? → res.write(`data: ${JSON.stringify(notification)}\n\n`)
```

SSE was chosen over WebSockets because:
- One-directional (server → client) is all that's needed
- Works over plain HTTP — friendlier to Army network infrastructure / proxies
- Native browser `EventSource` reconnects automatically

**Offline-first compatibility:** if a client is disconnected (no mesh route, no HQ link), notifications simply accumulate server-side. On reconnect, `GET /notifications?unreadOnly=true` catches the client up — no notification is lost to a dropped connection.

---

## 6. Domain Integration Hooks

Other services call these directly — they don't need to know about ranks or scopes:

```javascript
// Supply service, after a stock check:
await notifications.notifyLowStock({
  itemName: '7.62mm Ball Ammunition', currentQty: 340,
  threshold: 500, unitId: 103, itemId: 8821
});

// Transfer service, on creation:
await notifications.notifyTransferPending({
  transferId: 552, itemName: 'MRE Pack (24x)', quantity: 50,
  fromUnitId: 101, toUnitId: 103
});

// Transfer service, on approval/rejection — PERSONAL delivery:
await notifications.notifyTransferDecision({
  transferId: 552, itemName: 'MRE Pack (24x)',
  approved: true, requestedByUserId: 87
});

// Mesh service, on peer status change (Day 10 integration point):
await notifications.notifyMeshPeerStatus({
  peerId: 'NODE-7', peerName: 'Forward Post Charlie',
  unitId: 104, online: false
});
```

---

## 7. Audit Log Integration — Automatic Security Notifications

The Notification Service subscribes to `AuditLogService`'s `security-alert` event (introduced Day 13):

```javascript
auditLog.on('security-alert', (entry) => {
  // Auto-creates SECURITY_ALERT or BLOCKCHAIN_TAMPER notification
  // Targets minRankLevel 8 (Senior Officer / Auditor), requiresAck = true
});
```

This means **no other service needs to remember to notify anyone about security events** — the moment Day 13's audit chain detects tampering or logs a SECURITY-severity entry, this service surfaces it to the people who can act.

---

## 8. Preferences — With a Hard Floor

Users can mute non-critical notification types (`MESH_PEER_ONLINE` spam during a long sync, for example). But:

```
requiresAck === true  →  preference is IGNORED, notification always shown
```

You cannot mute a `BLOCKCHAIN_TAMPER` alert. Preferences control convenience, not accountability.

---

## What's Next

Day 12 will build the **Reporting & Analytics Service** — aggregated dashboards (stock levels by unit, blockchain health, mesh topology, transfer history) that use Day 13's command scope the *other* direction: a Brigade Commander's dashboard automatically aggregates every unit beneath them, with zero extra filtering logic required.
