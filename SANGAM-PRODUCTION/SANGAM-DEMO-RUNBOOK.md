# SANGAM — Demo Runbook & Rehearsal Checklist

**Status: Demo-readiness checkpoint, Day 65 (final sprint checkpoint).**
This is preparation for a demo, not a record that one has happened. As
of this writing, no Army stakeholder session has been scheduled or
confirmed — see "Outstanding risk" at the end of this document.
Everything below is rehearsed and verified against the real backend (57
automated scripts, 1,920 assertions, 0 failures, including dedicated
end-to-end smoke tests — `verify-day-60.js` and `verify-day-65.js` — that
run this exact flow), but it has not yet been run in front of a real
audience.

---

## 1. Starting the system for a demo

### Option A — Docker Compose (recommended, matches the documented deployment)

```bash
cp .env.example .env
# edit .env: set real values for JWT_SECRET, JWT_REFRESH_SECRET,
# PASSWORD_PEPPER, AUDIT_ENCRYPTION_KEY (see .env.example for how to
# generate each), and set SEED_DEMO_DATA=true

docker-compose --env-file .env up -d
```

Postgres comes up automatically as a sibling container; `DATABASE_URL`
in docker-compose.yml already points to it.

### Option B — Bare `npm start` (needs a reachable Postgres yourself)

```bash
export DATABASE_URL=postgresql://...   # must be reachable
export JWT_SECRET=...                   # 32+ chars
export PASSWORD_PEPPER=...
export SEED_DEMO_DATA=true
npm start
```

**`SEED_DEMO_DATA=true` is required for the demo to have any data at
all.** Without it the server starts empty. (This flag is new as of Day
59 — see `DAYPROGRESS-SCRATCH.md` for why `npm run seed:demo` alone
does not work: it was never actually connected to a running server's
data, in either startup path.)

### Confirm it worked

```bash
curl http://localhost:3000/health
```

Should return `200` with `"db":{"connected":true,...}`. If you see
`503`/`"connected":false`, Postgres isn't reachable — check
`DATABASE_URL` before doing anything else. The server console will also
print `🌱 Demo data seeded: 20 items, 7 transfers, 4 movement orders.`
on a fresh boot, or `🌱 Demo data already present — skipped re-seed.` if
it was already seeded (safe — see idempotency note below).

### Login credentials (printed by the seeder; repeated here for convenience)

| Username | Password | Role | Scope |
|---|---|---|---|
| `admin` | `Admin@1234` | SYSTEM_ADMIN | Everything |
| `brig.sharma` | `Officer@1234` | COMMANDER | Full brigade |
| `lt.col.verma` | `Officer@1234` | OFFICER | 1 Battalion Alpha |
| `maj.singh` | `Officer@1234` | OFFICER | 2 Battalion Beta |
| `hav.kumar` | `Soldier@1234` | NCO | 1 Battalion Alpha |

**For the demo, log in as `brig.sharma` (COMMANDER)** — full scope, and
sees the widest set of nav links (Compliance, Delegation Review Queue,
etc.) without hitting any 403s.

---

## 2. Suggested demo flow

This exact sequence — units → stock → transfer → approve → blockchain
verify → compliance → delegation → alerts → reports — is proven
end-to-end by `backend/scripts/verify-day-60.js` before every regression
run. It is not a guess at what might work; it's what's actually been
tested working, in this order, against a real (if temporary) server.

1. **Dashboard** — log in as `brig.sharma`. Point out the live widgets
   (units, personnel, supply, ledger, transfers, movement, stock,
   alerts) and the blockchain seal. If this is the first login, the
   tour-prompt banner offers a guided walkthrough — worth taking once
   before the real thing.
2. **Command structure** — Units page → drill into a battalion →
   UnitDetailPage shows chain of command, personnel, supply items,
   movement orders, subordinate units in one aggregated view.
3. **Supply chain** — Item List → show current stock. Create a transfer
   from one unit to another.
4. **Approve it** — Transfer List (or the modal) → approve. This is the
   moment a blockchain block gets written — worth narrating explicitly:
   "this transfer is now cryptographically sealed, not just a database row."
5. **Prove it** — Blockchain page → verify the chain. Then **Compliance
   → Chain of Custody**, look up the item that just moved — the full
   history (create, transfer request, approval) is right there,
   attributed to real actors, real timestamps.
6. **Compliance → Discrepancy Report** — run a scan live. A clean scan
   ("no discrepancies") is itself the point: it demonstrates the system
   is watching for exactly the kind of quiet inventory drift that's hard
   to catch by hand.
7. **Delegation** — this is a good one for a Commander-level audience:
   "what happens when an approving officer goes on leave?" Create a
   delegation live (delegate `supply:approve` to someone for 24 hours),
   or show the Emergency Override flow if the conversation goes toward
   "what about a genuine emergency."
8. **Alerts** — Alert List → show an active low-stock alert,
   acknowledge → resolve it.
9. **Reports** — Reports & Exports → export a CSV. (If running without
   Postgres for some reason, this page will clearly say so now instead
   of silently downloading an empty file — Day 59 fix.)
10. **Notifications** — click the bell → show the Digest view (📊) for
    a rolled-up summary rather than a scrolling list.
11. **A nice closer** — press `?` anywhere to show the keyboard shortcut
    overlay (Day 64). `g` then a letter jumps straight to any page —
    worth a quick mention if the audience is technical.

Total: roughly 10–15 minutes at a comfortable pace, less if rehearsed.

**Since Day 60:** Items and Transfers now paginate properly at 50/page
(Day 62) — won't be visible with the small demo seed dataset, but worth
mentioning if asked about scale. Bulk operations and emergency overrides
are now rate-limited (Day 61) — irrelevant at demo pace, but worth
knowing it exists if asked about abuse protection. A SYSTEM_ADMIN-only
snapshot/restore tool exists for Units + Supply Items (Day 63) — not
part of the suggested flow, but a good answer if asked "what happens if
the server needs to restart mid-pilot."

---

## 3. Rehearsal checklist

Run through this yourself, once, before the real thing.

**Environment**
- [ ] `docker-compose up -d` (or equivalent) completes without errors
- [ ] `curl http://localhost:3000/health` returns `200`, `db.connected: true`
- [ ] Server console shows the seed confirmation line (items/transfers/movement counts)
- [ ] Frontend build is current: `cd frontend && npm run build` succeeds with no errors
- [ ] `npm run test:all` from the project root passes in full (57/57 scripts) immediately before the demo

**Walkthrough**
- [ ] Can log in as `brig.sharma` without errors
- [ ] Every nav link in the sidebar loads without a blank page or console error
- [ ] The transfer → approve → verify sequence works exactly as in step 4–5 above
- [ ] Compliance → Chain of Custody returns real events for the item just transferred
- [ ] Delegation → New Delegation succeeds for a permission `brig.sharma` (COMMANDER) actually holds
- [ ] Notification bell opens, all three views (recent/digest/settings) render without error

**Contingency**
- [ ] Know how to restart cleanly if something in the live demo gets into
      a confusing state (`docker-compose restart app` — in-memory data
      resets, `SEED_DEMO_DATA=true` re-seeds automatically)
- [ ] Have this runbook open on a second screen/tab, not memorized

---

## 4. Outstanding risk (unchanged from the Day 55 handoff)

The single most important open item is **not technical**: no Army
stakeholder has been formally identified or a session confirmed. All of
the above makes SANGAM ready to demo well *whenever* that happens — it
does not create the meeting itself. This is worth stating plainly rather
than around: the code side of this sprint is in good shape; the business
side (a named champion, a scheduled slot) is the actual critical path
from here.
