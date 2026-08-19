# Day 14: Auth Login Flow & Account Security
## SANGAM Supply Chain Management System

---

## The Threat Model for a Field Terminal

A SANGAM terminal at a forward post is physically accessible to anyone who
walks into the room. If credentials leak — written on a sticky note, shared
"just this once," or guessed via a weak password — the blast radius is
everything that user's role and unit allow (Day 13's RBAC limits *what*
they can do, but someone still has to stop them from *getting in* at all).

Day 14 builds the front door: `POST /auth/login`, and everything that makes
it resistant to guessing, automation, and stolen-token replay.

---

## 1. Password Storage: Hash + Pepper

```
plaintext password  →  password + PEPPER  →  bcrypt(12 rounds)  →  stored hash
```

**Hashing** (bcrypt, cost 12) means even a stolen database doesn't reveal
passwords — cracking each one requires real compute time, by design.

**Pepper** is a second secret, held only in the application's environment
(`PASSWORD_PEPPER`), appended before hashing. If the *database* leaks but
the *application config* doesn't, the attacker has hashes of
`password+pepper` — useless without the pepper, even with a rainbow table
built for plain bcrypt.

```javascript
hashPassword(plaintext)  → bcrypt.hash(plaintext + PEPPER, 12)
verifyPassword(plain, hash) → bcrypt.compare(plain + PEPPER, hash)
```

Password strength is validated before hashing: minimum 8 characters, at
least one uppercase, one lowercase, one digit.

---

## 2. Account Lockout State Machine

```
                 ┌─────────────┐
                 │   ACTIVE     │◄──────────────────────┐
                 │ failed = 0   │                        │
                 └──────┬───────┘                        │
                         │ wrong password                │ correct password
                         ▼                                │ (any state)
                 ┌─────────────┐                          │
                 │ failed = N   │──────────────────────────┘
                 │  (1 ≤ N < 5) │
                 └──────┬───────┘
                         │ 5th wrong password
                         ▼
                 ┌──────────────────────┐
                 │      LOCKED           │
                 │ locked_until = +15min │
                 │ → audit USER_LOCK     │
                 │   (severity SECURITY) │
                 └──────┬───────────────┘
                         │ next login attempt
                         ▼
              ┌─────────────────────────┐
              │ locked_until elapsed?    │
              │  yes → auto-unlock,      │
              │        re-check password │
              │  no  → reject            │
              │        ACCOUNT_LOCKED     │
              └─────────────────────────┘
```

Fifteen minutes is long enough to stop a script blasting through a password
list, short enough that a soldier who fat-fingered their password five times
isn't locked out for the rest of their shift. A `SENIOR_OFFICER`+ can also
force-unlock immediately via `users:write` (`POST /auth/unlock/:userId`).

---

## 3. Refresh Token Rotation — and Reuse Detection

Every successful login issues two tokens: a short-lived **access token**
(8h JWT, Day 13) and a long-lived **refresh token** (30d, opaque random
string, stored only as a SHA-256 hash).

```
POST /auth/refresh  { refreshToken: R1 }
   → R1 valid, not revoked, not expired
   → mark R1 revoked
   → issue R2 (new refresh token)
   → return new access token + R2
```

**Rotation** means each refresh token is single-use. **Reuse detection**
catches the theft scenario:

```
Attacker steals R1 (e.g. from a compromised device's storage)
Legitimate user refreshes first → R1 rotated to R2, R1 now revoked
Attacker later tries R1 → R1 is found, but REVOKED
   → this is not "expired", it's "used after rotation" = signal of theft
   → SECURITY audit event logged
   → ALL refresh tokens for this user are revoked (every session logged out)
```

A single stolen-but-rotated token triggers a full session wipe for that
user — the legitimate user simply logs in again, but the attacker's copy is
now worthless everywhere.

---

## 4. Rate Limiting — Per-IP, Before Credentials Are Even Checked

```javascript
router.post('/login',
  rateLimiter.middleware(10, 5 * 60 * 1000, req => req.ip), // 10 attempts / 5 min / IP
  loginHandler
);
```

This stops **distributed credential stuffing** — an attacker trying many
*different* usernames against one IP — which account lockout alone
wouldn't catch (lockout is per-account, not per-source). The in-memory
sliding-window implementation needs no Redis, fitting SANGAM's offline-first
deployment model.

---

## 5. The Loop Closes: Day 14 → 13 → 11 → 12

```
5 wrong passwords
   │
   ▼
AuthService logs USER_LOCK  ───────────────►  Day 13: audit_logs
   (severity: SECURITY)                        hash-chain entry
                                                       │
                                                       │ emits 'security-alert'
                                                       ▼
                                          Day 11: NotificationService
                                          creates SECURITY_ALERT
                                          (requiresAck=true, rank 8+)
                                                       │
                                                       ▼
                                          Day 12: getSecurityPostureReport()
                                          → pendingAcknowledgments += 1
                                          → Senior Officer's dashboard
                                            shows "1 alert awaiting review"
```

No part of this required new wiring — every link already existed. Day 14
just had to *call* `auditLog.log()` with the right severity, and the rest
of the sprint's infrastructure carries it the rest of the way. Verified
end-to-end in this day's test suite.

---

## What's Next

**Day 15: Delegation & Override** — temporary authority transfer (an
Officer going on leave delegates `supply:approve` to a JCO for 72 hours)
and emergency override (a Senior Officer can override a scope/permission
denial in a documented, fully-audited emergency, with mandatory
post-hoc justification).
