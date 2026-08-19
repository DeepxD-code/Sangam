# Day 14 Completion Summary
## Auth Login Flow & Account Security

**Date:** Day 14 of 90
**Status:** ✅ Complete — 48/48 tests passing (220/220 across Days 11–14 this session)

---

## Delivered Today

### Files Created (6 files)

| File | Lines | Purpose |
|------|-------|---------|
| `services/auth.service.js`           | 365 | Login, refresh rotation, lockout, password mgmt |
| `services/rate-limiter.service.js`   | 115 | In-memory sliding-window rate limiter |
| `routes/auth.routes.js`               | 210 | 7 REST endpoints |
| `migrations/day-14-auth-schema.sql`   | 50  | `locked_until` column, indexes, locked-accounts view |
| `scripts/verify-day-14.js`            | 590 | 48-test verification suite |
| `docs/day-14-auth-login.md`           | 175 | Teaching document |

**Day 14 total: ~1,505 lines**

---

## What Was Built

**Password security:** bcrypt (12 rounds) + server-side pepper
(`PASSWORD_PEPPER` env var). Strength validation: ≥8 chars, upper, lower,
digit. Verified that a hash produced under one pepper fails to verify
under a different pepper — confirms the pepper is actually load-bearing.

**Account lockout state machine:** 5 consecutive failures → `account_locked
= true`, `locked_until = now + 15min`, audited as `USER_LOCK`
(severity `SECURITY`). Next login attempt after the window auto-unlocks
(resets counter, re-evaluates the password). A still-locked attempt does
**zero** extra queries — fails fast on the lockout check alone (verified:
exactly 1 DB call).

**Refresh token rotation + theft detection:** every `/auth/refresh` revokes
the presented token and issues a new pair (single-use). If a *revoked*
token is presented again — the signature of a stolen-then-used token — the
service logs a `SECURITY_ALERT` and revokes **every** refresh token for that
user, forcing full re-authentication everywhere.

**Rate limiting:** new `RateLimiter` class, in-memory sliding window, no
external cache dependency (offline-first). `/auth/login` is limited to
10 attempts / 5 minutes per IP — independent of account-level lockout, so
it also blocks distributed username-guessing.

---

## The Headline Test: The Loop Closes

Section 18 runs **5 real failed logins** through `AuthService` (backed by
a stateful mock users-table), wired to a **real** `AuditLogService` and a
**real** `NotificationService` — no mocks for these two.

Result, with zero extra glue code written today:

```
5× wrong password
  → users.failed_login_count reaches 5
  → account_locked = true, locked_until = +15min
  → audit_logs: USER_LOCK, severity=SECURITY        (Day 13)
  → NotificationService: SECURITY_ALERT created      (Day 11)
      requiresAck = true, minRankLevel = 8 (Senior Officer+)
```

This is the cross-day integration promised in Day 12's summary, and it
worked on the first wiring attempt — the only bug found all session was a
**test** assertion (`captured.role` vs the service's actual `roleName`
field), not a service defect.

---

## API Endpoints Added

```
POST /auth/login           → rate-limited 10/5min/IP
POST /auth/refresh         → rotation + reuse detection
POST /auth/logout          → revoke one session
POST /auth/logout-all      → revoke all sessions      [authenticated]
POST /auth/change-password → forces logout-all         [authenticated]
POST /auth/unlock/:userId  → admin override            [users:write]
GET  /auth/me              → current identity          [authenticated]
```

---

## Cumulative Sprint Metrics (this session: Days 11–14)

| Metric | Count |
|--------|-------|
| Production services added this session | 6 (RBAC, Audit, Notification, Reporting, Auth, RateLimiter) |
| New tests this session | 220 (73+61+38+48) |
| New tables/views this session | 13 |
| New API endpoints this session | 36 |

**11/12 gap closed, security layer (13–14) complete and cross-wired.**

---

## Day 15 Preview

**Delegation & Override** — an Officer going on leave delegates
`supply:approve` to a JCO for a fixed 72-hour window (auto-expiring,
fully audited); a Senior Officer can issue a documented emergency override
for a scope/permission denial, with mandatory written justification stored
alongside the `SCOPE_VIOLATION` it overrides. Both delegation grants and
override usage will themselves generate Day 11 notifications and appear in
Day 12's security posture report — continuing the same integration pattern.
