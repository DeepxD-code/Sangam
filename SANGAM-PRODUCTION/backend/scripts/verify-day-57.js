'use strict';

/**
 * Day 57 Verification — DelegationPage HTTP Contract
 *
 * DelegationService (Day 15) has its own established test coverage from
 * Day 15 — this script does NOT re-test its internal logic. It verifies
 * the exact HTTP contract DelegationPage.jsx depends on: delegation
 * create/list/revoke, override issue/review, the audit:read boundary
 * gating the review queue (AUDITOR, SENIOR_OFFICER, COMMANDER,
 * SYSTEM_ADMIN — not JCO, LOGISTICS_OFFICER, or OFFICER despite each
 * outranking AUDITOR), and that a delegator cannot delegate a permission
 * they don't hold.
 *
 * Note: audit:read (used here) and audit:export (used by Day 56's
 * CompliancePage Audit Export tab) are NOT the same role set — a
 * transcription error caught during Day 60's systematic RBAC sweep.
 * audit:export excludes SENIOR_OFFICER (only AUDITOR, COMMANDER,
 * SYSTEM_ADMIN hold it); audit:read includes SENIOR_OFFICER. Neither
 * Day 56 nor Day 57's tests happened to exercise SENIOR_OFFICER against
 * either permission specifically, so the error went undetected until
 * Day 60 computed the full permission matrix programmatically —
 * verify-rbac-contract.js now tests this distinction directly.
 */

const jwt       = require('jsonwebtoken');
const http      = require('http');
const createApp = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 9001, username: 'test.actor', role: 'SYSTEM_ADMIN',
    unitId: 1, unitCode: 'TST', ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      port, path: urlPath, method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  process.env.JWT_SECRET = JWT_SECRET;
  const app    = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const unitA = (await app.locals.services.units.createUnit({
      unitName: 'D57 Alpha Company', unitType: 'COMPANY', unitCode: 'D57-A'
    })).unit;

    // LOGISTICS_OFFICER has reports:advanced + supply:transfer, but NOT system:admin or audit:read
    const delegator = makeToken({ userId: 9101, unitId: unitA.id, unitCode: unitA.unitCode, role: 'LOGISTICS_OFFICER' });
    const delegate   = makeToken({ userId: 9102, unitId: unitA.id, unitCode: unitA.unitCode, role: 'SOLDIER' });

    // ── Group A: Create delegation — validation ──────────────────
    console.log('\n📝 Group A: Create Delegation — validation');
    {
      const r = await request(port, 'POST', '/api/delegation', delegator, {
        delegateUserId: 9102, permission: 'system:admin', unitId: unitA.id, durationHours: 24, reason: 'test'
      });
      check('A-01 delegating a permission the delegator lacks → 400 DELEGATOR_LACKS_PERMISSION',
        r.status === 400 && r.json?.error === 'DELEGATOR_LACKS_PERMISSION', `got ${r.status}: ${JSON.stringify(r.json)}`);
    }
    {
      const r = await request(port, 'POST', '/api/delegation', delegator, {
        delegateUserId: 9102, permission: 'reports:advanced', unitId: unitA.id, durationHours: -5, reason: 'test reason'
      });
      // durationHours:0 is falsy in JS and gets caught by the route's earlier
      // "required fields" check (INVALID_REQUEST) before ever reaching this
      // service-level range check — -5 is truthy, so it correctly exercises it.
      check('A-02 durationHours=-5 → 400 INVALID_DURATION', r.status === 400 && r.json?.error === 'INVALID_DURATION', `got ${r.status}: ${JSON.stringify(r.json)}`);
    }
    {
      const r = await request(port, 'POST', '/api/delegation', delegator, {
        delegateUserId: 9102, permission: 'reports:advanced', unitId: unitA.id, durationHours: 200, reason: 'test reason'
      });
      check('A-03 durationHours=200 (>168 max) → 400 INVALID_DURATION', r.status === 400 && r.json?.error === 'INVALID_DURATION');
    }
    {
      const r = await request(port, 'POST', '/api/delegation', delegator, {
        delegateUserId: 9102, permission: 'reports:advanced', unitId: unitA.id, durationHours: 24, reason: 'hi'
      });
      check('A-04 reason under 5 chars → 400 REASON_REQUIRED', r.status === 400 && r.json?.error === 'REASON_REQUIRED');
    }
    {
      const r = await request(port, 'POST', '/api/delegation', delegator, {
        delegateUserId: 9101, permission: 'reports:advanced', unitId: unitA.id, durationHours: 24, reason: 'test reason'
      });
      check('A-05 delegate === delegator → 400 CANNOT_DELEGATE_TO_SELF', r.status === 400 && r.json?.error === 'CANNOT_DELEGATE_TO_SELF');
    }
    {
      const r = await request(port, 'POST', '/api/delegation', delegator, {
        delegateUserId: 9102, permission: 'not:a:real:permission', unitId: unitA.id, durationHours: 24, reason: 'test reason'
      });
      check('A-06 unrecognised permission string → 400 UNKNOWN_PERMISSION', r.status === 400 && r.json?.error === 'UNKNOWN_PERMISSION');
    }

    // ── Group B: Create delegation — happy path + lifecycle ──────
    console.log('\n✅ Group B: Create → mine/granted → revoke lifecycle');
    let delegationId;
    {
      const r = await request(port, 'POST', '/api/delegation', delegator, {
        delegateUserId: 9102, permission: 'reports:advanced', unitId: unitA.id,
        durationHours: 24, reason: 'D57 test delegation'
      });
      check('B-01 201 + success:true', r.status === 201 && r.json?.success === true, JSON.stringify(r.json));
      check('B-02 delegation echoes correct fields', r.json?.delegation?.permission === 'reports:advanced' &&
        r.json?.delegation?.delegateUserId === 9102 && r.json?.delegation?.revokedAt === null);
      delegationId = r.json.delegation.id;
    }
    {
      const r = await request(port, 'GET', '/api/delegation/mine', delegate);
      check('B-03 delegate sees it in /mine', r.status === 200 && r.json?.delegations?.some(d => d.id === delegationId));
    }
    {
      const r = await request(port, 'GET', '/api/delegation/granted', delegator);
      check('B-04 delegator sees it in /granted', r.status === 200 && r.json?.delegations?.some(d => d.id === delegationId));
    }
    {
      // SOLDIER delegate (not the delegator, lacks users:write) tries to revoke → 403
      const r = await request(port, 'POST', `/api/delegation/${delegationId}/revoke`, delegate, {});
      check('B-05 non-owner without users:write → 403 INSUFFICIENT_PERMISSIONS',
        r.status === 403 && r.json?.error === 'INSUFFICIENT_PERMISSIONS', `got ${r.status}`);
    }
    {
      const r = await request(port, 'POST', `/api/delegation/${delegationId}/revoke`, delegator, { reason: 'D57 test revoke' });
      check('B-06 delegator revokes own delegation → 200', r.status === 200 && r.json?.success === true);
      check('B-07 revokedAt now set', !!r.json?.delegation?.revokedAt);
    }
    {
      const r = await request(port, 'POST', `/api/delegation/${delegationId}/revoke`, delegator, {});
      check('B-08 revoking again → 400 ALREADY_REVOKED', r.status === 400 && r.json?.error === 'ALREADY_REVOKED');
    }
    {
      const r = await request(port, 'GET', '/api/delegation/mine', delegate);
      check('B-09 revoked delegation no longer active in /mine', !r.json?.delegations?.some(d => d.id === delegationId));
    }
    {
      const r = await request(port, 'GET', '/api/delegation/granted', delegator);
      const found = r.json?.delegations?.find(d => d.id === delegationId);
      check('B-10 still visible in /granted (all statuses), now REVOKED', !!found && !!found.revokedAt);
    }

    // ── Group C: Emergency Override — validation + lifecycle ─────
    console.log('\n🚨 Group C: Emergency Override');
    {
      const r = await request(port, 'POST', '/api/delegation/overrides', delegate, {
        permission: 'supply:approve', justification: 'short'
      });
      check('C-01 justification under 10 chars → 400 JUSTIFICATION_REQUIRED', r.status === 400 && r.json?.error === 'JUSTIFICATION_REQUIRED');
    }
    {
      const r = await request(port, 'POST', '/api/delegation/overrides', delegate, {
        permission: 'supply:approve', justification: 'a valid justification here', durationMinutes: 500
      });
      check('C-02 durationMinutes=500 (>120 max) → 400 INVALID_DURATION', r.status === 400 && r.json?.error === 'INVALID_DURATION');
    }
    let overrideId;
    {
      const r = await request(port, 'POST', '/api/delegation/overrides', delegate, {
        permission: 'supply:approve', attemptedUnitId: unitA.id,
        justification: 'D57 test override — need to approve an urgent transfer'
      });
      check('C-03 201 + success:true', r.status === 201 && r.json?.success === true, JSON.stringify(r.json));
      check('C-04 defaults to 30 minutes when omitted', r.json?.override &&
        (new Date(r.json.override.expiresAt) - new Date(r.json.override.createdAt)) === 30 * 60_000);
      overrideId = r.json.override.id;
    }

    // ── Group D: audit:read boundary on the review queue ─────────
    console.log('\n🔐 Group D: audit:read is a 4-role set, not a rank cutoff');
    {
      // OFFICER outranks AUDITOR but lacks audit:read
      const officer = makeToken({ userId: 9103, unitId: unitA.id, unitCode: unitA.unitCode, role: 'OFFICER' });
      const r = await request(port, 'GET', '/api/delegation/overrides/pending-review', officer);
      check('D-01 OFFICER (rank 7) → 403 on pending-review (lacks audit:read)', r.status === 403, `got ${r.status}`);
    }
    {
      const auditor = makeToken({ userId: 9104, unitId: unitA.id, unitCode: unitA.unitCode, role: 'AUDITOR' });
      const r = await request(port, 'GET', '/api/delegation/overrides/pending-review', auditor);
      check('D-02 AUDITOR (rank 4, lower than OFFICER) → 200 on pending-review', r.status === 200, `got ${r.status}`);
      check('D-03 our override appears in the pending queue', r.json?.overrides?.some(o => o.id === overrideId));
    }
    {
      const officer = makeToken({ userId: 9103, unitId: unitA.id, unitCode: unitA.unitCode, role: 'OFFICER' });
      const r = await request(port, 'POST', `/api/delegation/overrides/${overrideId}/review`, officer);
      check('D-04 OFFICER → 403 on review action too', r.status === 403);
    }

    // ── Group E: Review lifecycle ─────────────────────────────────
    console.log('\n📋 Group E: Review lifecycle');
    const auditor = makeToken({ userId: 9104, unitId: unitA.id, unitCode: unitA.unitCode, role: 'AUDITOR' });
    {
      const r = await request(port, 'POST', `/api/delegation/overrides/${overrideId}/review`, auditor);
      check('E-01 AUDITOR reviews → 200', r.status === 200 && r.json?.success === true);
      check('E-02 reviewedAt + reviewedBy set correctly', !!r.json?.override?.reviewedAt && r.json?.override?.reviewedBy === 9104);
    }
    {
      const r = await request(port, 'POST', `/api/delegation/overrides/${overrideId}/review`, auditor);
      check('E-03 reviewing again → 400 ALREADY_REVIEWED', r.status === 400 && r.json?.error === 'ALREADY_REVIEWED');
    }
    {
      const r = await request(port, 'GET', '/api/delegation/overrides/pending-review', auditor);
      check('E-04 reviewed override no longer in pending queue', !r.json?.overrides?.some(o => o.id === overrideId));
    }

    // ── Group F: Stats ────────────────────────────────────────────
    console.log('\n📊 Group F: Stats');
    {
      const r = await request(port, 'GET', '/api/delegation/stats', delegate);
      check('F-01 200 + success:true (reports:read — every role has it)', r.status === 200 && r.json?.success === true);
      check('F-02 totalDelegations reflects our test', r.json?.totalDelegations >= 1);
      check('F-03 activeDelegations excludes the revoked one', r.json?.activeDelegations === 0);
      check('F-04 totalOverrides reflects our test', r.json?.totalOverrides >= 1);
      check('F-05 pendingReview excludes the reviewed one', r.json?.pendingReview === 0);
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 57 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
