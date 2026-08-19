# Day 16 Completion Summary
## Audit Hardening — Encryption-at-Rest + Scheduled Integrity Sweep

**Date:** Day 16 of 90
**Status:** ✅ Complete — 47/47 tests passing (319/319 Days 11–16, zero regressions)

---

## Delivered Today

### Files Created (4 files)

| File | Lines | Purpose |
|------|-------|---------|
| `services/audit-hardening.service.js` | 430 | AES-256-GCM + scheduled integrity sweep |
| `migrations/day-16-audit-hardening-schema.sql` | 65 | `encryption_version` columns, indexes, view |
| `scripts/verify-day-16.js` | 490 | 47-test verification suite |
| `docs/day-16-audit-hardening.md` | 170 | Teaching document |

**Day 16 total: ~1,155 lines**

---

## What Was Built

### AES-256-GCM Encryption-at-Rest

```
Encrypt:  plaintext → IV(16B random) → AES-256-GCM cipher → IV:ciphertext:authTag
Decrypt:  IV:ciphertext:authTag → decipher with authTag verification → plaintext
          (throws on auth-tag failure — GCM tamper detection)
```

Fields encrypted:
- `audit_logs.details` (JSONB/TEXT) — may contain field names, movement
  patterns, incident descriptions
- `permission_overrides.justification` (TEXT, Day 15) — may contain
  operational intelligence cited as emergency justification

Fields left plaintext (query-required): `action`, `resource`, `user_id`,
`severity`, `created_at`, `success` — everything the reporting and
audit-query APIs filter on.

**Key design decisions verified by tests:**
- Random 16-byte IV per encrypt call → identical plaintexts produce
  different ciphertexts (frequency analysis blocked)
- GCM auth tag → bit-flip of ciphertext OR tag throws on decrypt
- Wrong key → auth tag failure (not a silent wrong answer)
- `isEncrypted()` check → legacy plaintext rows pass through
  `decryptRow()` unchanged (zero migration step required)
- `prepareForWrite()` / `decryptRow()` return *new objects* — originals
  never mutated

### Scheduled Integrity Sweep

```
startIntegritySweep(intervalMs = 1h)
  → setInterval → _runSweep()
      1. verifyIntegrity(null, 500) — Day 13 hash-chain check
      2. SELECT last log_hash FROM DB
         compare with auditLog._lastHash (in-memory)
         → divergence = rows written outside the application
      3. If either fails → _onTamperDetected()
           → log AUDIT_INTEGRITY_CHECK CRITICAL (Day 13 → Day 11 listener picks up)
           → notifications.create BLOCKCHAIN_TAMPER (CRITICAL, requiresAck)
      4. Concurrency guard: if sweep already running → { skipped: true }
```

The sweep intentionally checks only the last 500 entries (not the whole
table) because: (a) a chain break is detectable from *any* point of
divergence — you don't need to re-prove history every hour; (b) this
keeps the sweep cost O(1) regardless of table size.

---

## Integration Map

```
Day 16 AuditHardeningService
  ├─ consumes  → AuditLogService.verifyIntegrity()  (Day 13)
  ├─ consumes  → NotificationService.create()       (Day 11)
  │              produces BLOCKCHAIN_TAMPER (CRITICAL, requiresAck)
  │              which Day 12 counts in securityPostureReport.pendingAcknowledgments
  └─ produces  → audit_logs (AUDIT_INTEGRITY_CHECK CRITICAL on break)
                 which Day 11's security-alert listener also picks up
```

---

## Cumulative Sprint Metrics (Days 11–16 this session)

| Metric | Count |
|--------|-------|
| Services | 8 (RBAC, Audit, Notification, Reporting, Auth, RateLimiter, Delegation, AuditHardening) |
| Total tests this session | 319 |
| New tables/views | 16 |
| New API endpoints | 44 |
| Total service lines | 3,587 |

---

## Day 17 Preview

**Docker Deployment** — `Dockerfile`, `docker-compose.yml` (app +
PostgreSQL + optional Redis-stub), `healthcheck` endpoint, migration
runner that applies all 16 days' SQL files in order on first boot,
and an `.env.example` documenting every required environment variable
(`JWT_SECRET`, `PASSWORD_PEPPER`, `AUDIT_ENCRYPTION_KEY`, etc.). The
entire SANGAM demo should be `docker-compose up` from a fresh machine.
