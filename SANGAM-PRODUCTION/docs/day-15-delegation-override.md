# Day 15: Delegation & Override
## SANGAM Supply Chain Management System

---

## Two Problems RBAC Alone Can't Solve

Day 13's RBAC is static: a role has a fixed permission set, a user has a
fixed role. Two real Army situations break that model:

1. **Planned absence.** Major Sharma (OFFICER, `supply:approve`) goes on
   leave for 72 hours. Transfers still need approving. Either someone
   waits three days, or Major Sharma permanently hands his JCO a role
   change he'll forget to revert.

2. **Emergency exception.** A Havildar at a forward post needs to
   transfer ammunition to a unit *outside* his command scope — the
   correct unit is temporarily unreachable and casualties are mounting.
   Day 13's `requireCommandScope()` correctly blocks this. But "correctly
   blocked" and "the right call in this moment" aren't the same thing.

Day 15 adds two narrow, fully-audited escape valves — **delegation**
(planned, scoped, time-boxed) and **override** (emergency, justified,
reviewed after the fact) — without weakening RBAC's defaults for anyone
else.

---

## 1. Delegation: Temporary, Scoped, Self-Expiring

```javascript
await delegation.create({
  delegatorUserId: majorSharma.userId,      // must already HAVE the permission
  delegateUserId:  jcoPatel.userId,
  permission:      'supply:approve',
  unitId:          101,                      // scoped to Company A only
  durationHours:   72,
  reason:          'On leave 15–18 June, JCO Patel covering approvals'
});
```

A delegation grants **one permission**, **scoped to one unit's command
tree** (reusing Day 13's `getCommandScope`), for **a bounded duration**.
It cannot be used to delegate a permission the delegator doesn't hold —
checked against Day 13's `RBACService.hasPermission()` at creation time.

### Effective Permission Check

```
hasEffectivePermission(user, permission, unitId) =
     RBACService.hasPermission(user.role, permission)        // static (Day 13)
  OR DelegationService.hasActiveDelegation(user, permission, unitId)  // dynamic (Day 15)
```

`AuthMiddleware.requirePermission()` is extended to check both. Everything
built on Day 11–14 — notifications, reports, audit — continues to work
unchanged, because the *effective* check is a strict superset of the
*static* one.

### Auto-Expiry

```
expiresAt = createdAt + durationHours
```

No cron job needed: `isActive()` checks `expiresAt > now` at query time.
A background sweep (`expireOverdue()`) periodically marks expired rows so
reports don't have to repeatedly filter live — but correctness never
depends on the sweep having run.

### Revocation

A delegation can be revoked early by the delegator, by anyone with
`users:write` in the delegator's command scope, or auto-revoked if the
delegator's account gets locked (Day 14) — you can't effectively delegate
authority from a compromised account.

---

## 2. Emergency Override: Justified, Then Reviewed

```javascript
await override.create({
  userId:        havildarKumar.userId,
  permission:    'supply:transfer',
  attemptedUnitId: 105,                       // outside Havildar's scope
  justification: 'Unit 105 isolated, casualties pending, no comms with HQ-102',
  durationMinutes: 30
});
```

An override is **single-use within a short window** (default 30 minutes)
and requires a **non-empty written justification** — there is no "override,
no reason" path. Creating an override:

1. Logs an `OVERRIDE_ISSUED` audit entry, severity `SECURITY`, immediately
   — *before* the override is ever used. The act of requesting one is
   itself notable.
2. Grants exactly the one `(permission, unitId)` pair for the window.
3. On first successful use, marks itself consumed (`usedAt` set) —
   further requests need a new override.

### The Review Queue

```
GET /delegation/overrides/pending-review
```

Every override appears here until a `SENIOR_OFFICER`+ marks it reviewed
(`POST /delegation/overrides/:id/review`). This is the human-in-the-loop:
the system *allows* the emergency action immediately (the casualty can't
wait), but a senior officer *must* look at every justification afterward.
Unreviewed overrides older than 24 hours escalate via Day 11's
notification system as `SECURITY_ALERT`, `requiresAck = true`.

---

## 3. Why This Doesn't Weaken Day 13

| Property | Static RBAC (Day 13) | Delegation | Override |
|---|---|---|---|
| Who can grant | N/A (fixed) | Only someone who *already has* the permission | Self-issued, but pre-logged + post-reviewed |
| Scope | Role-wide | One unit's command tree | One unit, one permission |
| Duration | Permanent | Bounded (hours), auto-expires | Single-use, short window (minutes) |
| Audit | Per-action | Grant + every use logged | Issued (immediately) + used + reviewed |
| Reversible | Admin edits role | Revoke anytime | Expires/consumes automatically |

Nothing here lets a role exceed its own ceiling — `hasActiveDelegation`
checks the delegator *had* the permission, and overrides are logged before
they're even useful. The static permission matrix from Day 13 remains the
source of truth for "what a role can ever possess"; Day 15 only governs
*temporary redistribution* of permissions that already exist.

---

## 4. Integration With Days 11–14

- **Delegation granted/revoked** → `NotificationService.create()`,
  personal delivery to the delegate (`TRANSFER_APPROVED`-style "you now
  have X until Y").
- **Override issued** → audit `SECURITY` entry → Day 11 `SECURITY_ALERT`
  → Day 12 `pendingAcknowledgments` until reviewed.
- **Override review** → audit `AUDIT_LOG_ACCESS`-style entry, clears the
  pending-review count.
- **Account lockout (Day 14)** → any active delegations *from* that
  account are auto-revoked as part of `_lockAccount`.

---

## What's Next

**Day 16: Audit Hardening** — encryption-at-rest for `details` JSONB
columns containing sensitive justification text, and a scheduled
`verifyIntegrity()` sweep with alerting if the Day 13 hash chain ever
shows a break.
