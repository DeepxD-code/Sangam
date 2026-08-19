# Day 16: Audit Hardening
## SANGAM Supply Chain Management System

---

## Two Remaining Weaknesses in the Day 13 Audit System

Day 13's audit log is tamper-*evident*: a hash chain that detects modification.
Day 16 closes two gaps that tamper-evidence alone cannot address.

### Gap 1: The DBA Problem

The `details` JSONB column on `audit_logs` and the `justification` text on
`permission_overrides` (Day 15) may contain:

- Names of informants, sources, or field agents referenced in transfer justifications
- Operational unit movements inferred from supply patterns
- Security incident descriptions that themselves contain sensitive intelligence

A PostgreSQL DBA with `SELECT` access to the audit table can read all of
this in plaintext. The hash chain confirms the data hasn't changed — it
doesn't hide it from insiders who have direct DB access.

**Fix:** AES-256-GCM encryption-at-rest for those two specific fields,
keyed with `AUDIT_ENCRYPTION_KEY` from the application environment. The
DBA sees ciphertext; only the application (which holds the key) can
decrypt.

### Gap 2: Chain Breaks Go Undetected Until Someone Looks

`verifyIntegrity()` was built on Day 13. But it only runs when someone
explicitly calls it. A tampered log left undetected for days is worse
than a tamper attempt that's caught immediately.

**Fix:** A scheduled integrity sweep — runs every hour, compares a rolling
window of recent entries against the hash chain, emits a
`BLOCKCHAIN_TAMPER` CRITICAL notification (Day 11) and logs a
`AUDIT_INTEGRITY_CHECK` CRITICAL audit entry if a break is found.
The sweep also catches a subtler failure: if the *last known good hash*
diverges from the DB's latest entry hash (which would indicate rows were
appended outside the application), that's detected too.

---

## AES-256-GCM: Why This Mode

AES-256-GCM provides both **confidentiality** (the ciphertext reveals
nothing about the plaintext) and **authenticity** (the authentication
tag means you can detect bit-flipping of the ciphertext itself — a
second layer of tamper detection, complementing the hash chain).

```
Encrypt:
  IV  = crypto.randomBytes(16)
  cipher = createCipheriv('aes-256-gcm', KEY_32_BYTES, IV)
  ciphertext = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex')
  authTag = cipher.getAuthTag()
  stored = `${IV.hex}:${ciphertext}:${authTag.hex}`

Decrypt:
  [IV, ciphertext, authTag] = stored.split(':')
  decipher = createDecipheriv('aes-256-gcm', KEY_32_BYTES, IV)
  decipher.setAuthTag(authTag)
  plaintext = decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8')
  // Throws if authTag fails → tampering detected
```

A fresh random IV per record means identical plaintexts produce different
ciphertexts — no frequency analysis possible even if an attacker can see
the stored values.

The key itself never touches the database. It lives in the application
process's environment (`AUDIT_ENCRYPTION_KEY`), a 64-char hex string
(32 bytes = 256 bits).

---

## What Gets Encrypted vs. Hashed

```
audit_logs:
  log_hash / previous_hash  → HASHED (tamper-detection chain, Day 13)
  details JSONB              → ENCRYPTED (confidentiality at rest, Day 16)
  action, resource, etc.     → PLAINTEXT (needed for indexed queries)

permission_overrides (Day 15):
  justification TEXT         → ENCRYPTED (may contain intel, Day 16)
  everything else            → PLAINTEXT
```

The *queryable* fields (action, resource, user_id, severity, timestamp)
stay plaintext because PostgreSQL indexes and the reporting service both
need to filter on them. Only the *narrative* fields — the free-text
that an analyst or officer writes — are encrypted.

---

## The Scheduled Sweep

```javascript
class AuditHardeningService {
  startIntegritySweep(intervalMs = 60 * 60 * 1000) {
    this._sweepInterval = setInterval(() => this._runSweep(), intervalMs);
  }

  async _runSweep() {
    // 1. Check last N entries (default 500) for hash chain integrity
    const result = await this.auditLog.verifyIntegrity(null, 500);
    if (!result.verified) {
      // 2. Emit BLOCKCHAIN_TAMPER notification (Day 11 picks it up,
      //    creates requiresAck CRITICAL notification to Senior Officers)
      // 3. Log AUDIT_INTEGRITY_CHECK CRITICAL audit entry
      //    (which Day 11 also picks up as a SECURITY_ALERT)
    }

    // 4. Cross-check: does the DB's latest log_hash match what the
    //    running service remembers as its last hash?
    //    Discrepancy = rows written outside the application.
  }
}
```

The sweep window is intentionally short (last 500 entries) rather than
the full table, because: (a) a full-table scan every hour is expensive
at scale, (b) tampering is most likely to happen to recent entries
(before an investigation sweeps them), and (c) the hash chain means
*any* break in the recent window proves the chain from genesis is
compromised — you don't need to recheck old entries every hour.

---

## Graceful Key Rotation (Design, Not Implemented Yet)

The stored format `IV:ciphertext:authTag` is version-free today but the
key is accessed via a service method, so key rotation would follow:

1. Generate new key, set `AUDIT_ENCRYPTION_KEY_NEXT`
2. Decrypt-and-re-encrypt on next read (lazy rotation)
3. Once all rows are rotated, promote `KEY_NEXT` to `KEY`

This is noted in the service's `TODO` comments — Day 16 stores the
mechanism, key rotation is a post-MVP hardening item.

---

## What's Next

**Day 17: Docker Deployment** — `Dockerfile`, `docker-compose.yml` with
PostgreSQL, `healthcheck`, environment variable management, and a
migration runner that applies all 16 days' SQL files in order on first
boot. The demo system should be a single `docker-compose up` away.
