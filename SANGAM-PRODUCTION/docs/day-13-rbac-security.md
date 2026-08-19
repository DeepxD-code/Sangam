# Day 13: Role-Based Access Control & Command Hierarchy Security
## SANGAM Supply Chain Management System

---

## Why Security is Non-Negotiable in Military Logistics

A soldier in a forward post should not be able to approve his own ammunition transfer request. A platoon commander should not be able to view supply data from a rival brigade. A compromised terminal in the field must not expose the entire corps's inventory.

These are not edge cases. They are the baseline requirements for any system the Indian Army will trust with its supply chain.

SANGAM Day 13 implements a **three-layer security architecture**:

```
Layer 1: Authentication  →  Who are you? (JWT)
Layer 2: Authorization   →  What can you do? (RBAC)
Layer 3: Scope           →  What data can you touch? (Command Hierarchy)
```

All three layers are **logged in a tamper-evident audit trail** that makes every access decision accountable.

---

## 1. Role-Based Access Control (RBAC)

### The Core Idea

Instead of assigning permissions to individual users (which becomes unmanageable at scale), RBAC assigns permissions to **roles**, and users are assigned roles. This maps naturally to the Army, where rank determines authority.

```
USER → ROLE → PERMISSIONS
```

A `havildar` at SANGAM terminal in Leh has exactly the same permissions as a `havildar` at Tezpur — their role defines their access, not their name.

### Army Role Structure in SANGAM

| Role | Army Equivalent | Rank Level | Key Capability |
|------|----------------|-----------|----------------|
| `SOLDIER` | Sepoy/Constable | 1 | Read inventory only |
| `NCO` | Naik/Havildar | 3 | Record transactions |
| `JCO` | Naib Sub/Subedar | 5 | Manage company supply |
| `LOGISTICS_OFFICER` | Quartermaster | 6 | Full supply chain ops |
| `OFFICER` | Lieutenant–Captain | 7 | Command + approval |
| `SENIOR_OFFICER` | Lt Col/Colonel | 8 | Battalion oversight |
| `COMMANDER` | Brigadier–General | 9 | Formation-level access |
| `AUDITOR` | Inspector/Auditor | 4 | Read-only, all data |
| `SYSTEM_ADMIN` | Technical Staff | 10 | Full system access |

### Permission Design

Permissions follow a `resource:action` format:

```
supply:read      → View inventory
supply:write     → Create/update items  
supply:delete    → Remove items (soft delete)
supply:transfer  → Initiate transfers between units
supply:approve   → Approve transfer requests

blockchain:read      → View blocks and chain
blockchain:write     → Add transactions
blockchain:verify    → Run chain integrity checks

mesh:read   → View network topology
mesh:write  → Configure mesh
mesh:admin  → Full mesh administration

reports:read     → Standard reports
reports:export   → CSV/PDF export
reports:advanced → Advanced analytics

users:read    → View user profiles
users:write   → Create/update users
users:delete  → Deactivate accounts

audit:read    → View audit logs
audit:export  → Export audit logs

system:config → Change system settings
system:admin  → Full administration
```

### The Permission Matrix (Key Columns)

| Permission | SOLDIER | NCO | JCO | LOGISTICS | OFFICER | SR OFFICER | COMMANDER |
|-----------|---------|-----|-----|-----------|---------|------------|-----------|
| supply:read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| supply:write | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| supply:delete | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| supply:approve | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| blockchain:verify | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| audit:read | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| users:write | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| system:admin | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Notable design decisions:
- **No role has supply:delete + no blockchain:write simultaneously** without also having supply:approve — prevents phantom deletions
- **AUDITOR deliberately has no write permissions** to any resource
- **OFFICER does not have supply:delete** — only logistics specialists and seniors
- **system:admin is SYSTEM_ADMIN only** — no operational role can touch system config

---

## 2. Command Hierarchy (Attribute-Based Scoping)

RBAC tells you *what* you can do. Command hierarchy tells you *whose data* you can access.

### The Problem

Major Sharma commands Alpha Company, 11 Rajputana Rifles. He has the OFFICER role, so he can `supply:read`. But should he be able to read Beta Company's inventory? Or 12 Mechanised Infantry's?

**No.** Each officer can only see data within their command scope.

### How the Hierarchy Works

The Indian Army uses a nested command structure:

```
21 Corps (CORPS)
  └── 9 Infantry Division (DIVISION)
        └── 26 Infantry Brigade (BRIGADE)
              ├── 11 Rajputana Rifles (BATTALION)
              │     ├── Alpha Company (COMPANY)
              │     │     ├── 1 Platoon (PLATOON)
              │     │     │     ├── 1 Section (SECTION)
              │     │     │     └── 2 Section (SECTION)
              │     │     └── 2 Platoon
              │     └── Beta Company
              └── 12 Mechanised Infantry (BATTALION)
```

**Rule:** A user can access data for their unit **and all subordinate units**. They cannot access data for sibling units or parent units (unless they are a COMMANDER with corps-level scope).

### Command Scope Query (Recursive CTE)

```sql
WITH RECURSIVE unit_tree AS (
  -- Start with user's own unit
  SELECT id, unit_name, parent_unit_id
  FROM command_units
  WHERE id = :user_unit_id

  UNION ALL

  -- Add all subordinate units recursively
  SELECT cu.id, cu.unit_name, cu.parent_unit_id
  FROM command_units cu
  INNER JOIN unit_tree ut ON cu.parent_unit_id = ut.id
)
SELECT id FROM unit_tree;
```

This query runs in O(depth) time and returns the complete set of unit IDs the user can access. Results are cached for 5 minutes.

### Scope Check in Practice

```
Request: GET /api/supply/items?unitId=9

User: Maj Sharma (unit_id=5, which is Alpha Company)
Unit 9 = Beta Company (sibling unit, not subordinate)

Result: 403 OUTSIDE_COMMAND_SCOPE
```

```
Request: GET /api/supply/items?unitId=6

User: Maj Sharma (unit_id=5, which is Alpha Company)
Unit 6 = 1 Platoon (subordinate to Alpha Company)

Result: 200 OK
```

---

## 3. JWT Authentication

### Why JWT for Army Systems

The Army often operates in environments with intermittent connectivity. Unlike session-based auth (which requires a DB lookup on every request), **JWT tokens are self-contained** — a node can validate a token without contacting a central auth server.

This is essential for mesh network operation where a field node might be offline from HQ for hours but still needs to authenticate local users.

### Token Structure

```json
{
  "header": { "alg": "HS256", "typ": "JWT" },
  "payload": {
    "userId": 42,
    "username": "major_sharma",
    "displayName": "Major A.K. Sharma",
    "role": "OFFICER",
    "unitId": 5,
    "unitCode": "COY-A-11RR",
    "iat": 1718000000,
    "exp": 1718028800
  },
  "signature": "..."
}
```

### Token Lifecycle

```
Login → Access Token (8h) + Refresh Token (30d)
                │
                ▼
         API Requests (Bearer token in header)
                │
                ▼
         Token expires → Use refresh token to get new access token
                │
                ▼
         Refresh token expires or revoked → Re-login required
```

### Special: Operation Tokens

For sensitive operations (approving a large transfer, deleting items), SANGAM issues **short-lived operation tokens** (15 minutes) that are scoped to a single operation type. This prevents replay attacks on critical operations.

```javascript
// Generate before showing approval dialog
const opToken = AuthMiddleware.generateOperationToken(userId, 'TRANSFER_APPROVE');

// Verify when approval is submitted  
const valid = AuthMiddleware.verifyOperationToken(token, 'TRANSFER_APPROVE');
```

---

## 4. Tamper-Evident Audit Logging

### The Hash Chain

Every audit log entry contains:
1. A hash of the **previous entry's hash** (the chain link)
2. A hash of **this entry's content** (the content fingerprint)

```
Entry #1: previousHash="000...000"  logHash="abc123..."
Entry #2: previousHash="abc123..."  logHash="def456..."
Entry #3: previousHash="def456..."  logHash="ghi789..."
```

If someone modifies Entry #2 (changes `success: false` to `success: true`), its hash changes. But Entry #3's `previousHash` still points to the old hash of Entry #2. **The chain is broken — the tampering is detected.**

This is the same principle used in Bitcoin's blockchain, applied to audit logs.

### What Gets Logged

```
AUTHENTICATION     → Every login attempt (success or failure)
AUTHORIZATION      → Every permission check that fails
SCOPE_VIOLATION    → Every attempt to access outside command scope
SUPPLY_*           → Every supply chain operation (create, transfer, approve)
BLOCKCHAIN_*       → Blockchain writes and verification runs
USER_*             → User creation, role changes, deactivation
SYSTEM_*           → Configuration changes
AUDIT_*            → Who accessed the audit logs (meta-logging)
```

### Severity Levels

| Severity | When Used |
|----------|-----------|
| `INFO` | Normal operations (reads, successful auth) |
| `WARNING` | Failed non-security operations |
| `SECURITY` | Auth failures, permission denials, scope violations |
| `CRITICAL` | Tamper detection, system integrity failures |

### Offline Audit Buffering

When the database is unavailable (field deployment, network partition), audit entries are buffered in memory and written to DB when connectivity is restored. The hash chain continues uninterrupted — the hash is computed at event time, not write time.

---

## 5. Middleware Stack

Route protection uses composable middleware:

```javascript
router.post('/supply/transfer/approve/:id',
  auth.authenticate(),                    // Layer 1: Valid JWT?
  auth.requirePermission('supply:approve'), // Layer 2: Has permission?
  auth.requireCommandScope('unitId'),       // Layer 3: In command scope?
  auth.auditRequest('SUPPLY_APPROVE', 'transfers'), // Log everything
  handler
);
```

This gives clean separation of concerns:
- `authenticate()` → JWT validation only
- `requirePermission()` → RBAC check only
- `requireCommandScope()` → Hierarchy check only
- `auditRequest()` → Logging only

Each middleware is independently testable and reusable.

---

## 6. Security Threat Model

| Threat | Mitigation |
|--------|-----------|
| Stolen credentials | Short JWT lifetime (8h), refresh token rotation |
| Replay attack on critical ops | Operation tokens (15min, single-use) |
| Privilege escalation | Role permissions hardcoded in service, not DB |
| Horizontal access (another unit's data) | Command scope enforcement |
| Log tampering | Hash chain — modification detected on verification |
| Brute force auth | Audit-based detection (5+ failures → alert) |
| Insider threat | Audit trail + command scope limits blast radius |
| Offline node compromise | Scoped tokens, mesh peer validation |

---

## What's Next

Day 14 will build on this security foundation with:
- **Login endpoint** with account lockout
- **Refresh token rotation**
- **Suspicious activity detection** running on the audit log
- **Rate limiting middleware** for API endpoints

The RBAC + audit system delivered today is the security backbone that every subsequent feature will plug into.
