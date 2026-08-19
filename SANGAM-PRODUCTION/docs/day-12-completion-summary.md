# Day 12 Completion Summary
## Reporting & Analytics Service

**Date:** Day 12 of 90 (built retroactively — closes the 11/12 gap)
**Status:** ✅ Complete — 38/38 tests passing (61 Day-11 + 73 Day-13 regression-checked, no breaks)

---

## Delivered Today

### Files Created (5 files)

| File | Lines | Purpose |
|------|-------|---------|
| `services/reporting.service.js`        | 390 | 6 report types + cached dashboard + CSV export |
| `routes/reporting.routes.js`           | 195 | 8 REST endpoints incl. CSV export |
| `migrations/day-12-reporting-schema.sql` | 95 | Defensive tables for supply_items/transfers/blockchain_blocks + 1 view |
| `scripts/verify-day-12.js`             | 430 | 38-test verification suite (mocked DB) |
| `docs/day-12-reporting-analytics.md`   | 165 | Teaching document |

**Day 12 total: ~1,275 lines**

---

## The Core Pattern: Aggregation = Escalation, Inverted

```
Day 11 (escalation):  isInCommandScope(viewer, source)  → "is source ∈ descendants(viewer)?"
Day 12 (aggregation): getCommandScope(viewer)           → "give me {viewer} ∪ descendants(viewer)"
                       SELECT ... WHERE unit_id = ANY(scope.ids)
```

Same RBAC primitive (Day 13), opposite use. Verified directly: Company A
Commander's scope = `{101,103,104}` (3 units), Battalion CO's scope = all
6 — and every report respects that boundary.

---

## Six Reports Delivered

1. **Stock Levels** — per-unit/category totals + low-stock item list
2. **Transfer Activity** — by-status counts/quantities + pending queue, 30-day default window
3. **Blockchain Health** — block count, latest block, `chainEmpty` flag
4. **Mesh Health** — **zero new tables**: derived live from Day 11's `MESH_PEER_ONLINE/OFFLINE` notification history, latest-per-peer
5. **Security Posture** — Day 13 audit SECURITY/CRITICAL counts + Day 11 `pendingAcknowledgments`
6. **Unit Roster** — command_units filtered to scope

`getDashboardSummary()` runs all six in parallel, cached 5 minutes per `(userId, unitId)`.

---

## Bug Found & Fixed During Testing

`NotificationService.getForUser()`'s sort (`new Date(b.createdAt) -
new Date(a.createdAt)`) ties when two notifications are created in the
same millisecond — a real scenario for rapid-fire mesh peer status flaps.
A stable sort then preserves *insertion* order on ties, so "most recent"
silently became "least recent."

**Fix:** added an `id`-based tiebreaker (`b.id - a.id`) — higher ID is
always more recent regardless of timestamp resolution. Verified no
regression in Day 11 (61/61) or Day 13 (73/73).

---

## API Endpoints Added

```
GET /reports/dashboard           → all 6 sections, cached  [reports:read]
GET /reports/stock-levels        → ?category=             [reports:read]
GET /reports/transfers           → ?startDate&endDate      [reports:read]
GET /reports/blockchain-health                             [reports:read]
GET /reports/mesh-health                                    [reports:read]
GET /reports/security-posture    → ?hours=                [reports:advanced]
GET /reports/unit-roster                                    [reports:read]
GET /reports/export/:type        → CSV (stock-levels|transfers|unit-roster|mesh-health) [reports:export]
```

---

## Cumulative Sprint Metrics (this session: Days 11–13)

| Metric | Count |
|--------|-------|
| Production services added this session | 4 (RBAC, Audit, Notification, Reporting) |
| New tests this session | 172 (73 + 61 + 38) |
| New tables/views this session | 12 |
| New API endpoints this session | 29 |

**Gap closed.** Days 11–13 are now complete and cross-integrated:
Day 13 (RBAC/audit) → Day 11 (notifications consume audit alerts, expose
command-scope visibility) → Day 12 (reporting consumes both, in the
aggregation direction).

---

## Day 14 Preview

**Auth Login Flow + Account Security** — `POST /auth/login` with account
lockout, `POST /auth/refresh` with token rotation, `POST /auth/logout`,
bcrypt password hashing, and brute-force detection that writes to Day 13's
audit log — which Day 11 will then surface as `SECURITY_ALERT`
notifications, which Day 12's security-posture report will count. The full
loop closes.
