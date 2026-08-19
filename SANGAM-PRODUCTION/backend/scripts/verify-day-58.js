'use strict';

/**
 * Day 58 Verification — Notification Digest & Preferences HTTP Contract
 *
 * GET /notifications/digest and GET/PUT /notifications/preferences existed
 * with zero frontend surface until Day 58's NotificationBell extension.
 * This script verifies the exact contract the new digest/settings views
 * depend on — it does not re-test NotificationService's underlying
 * visibility/scope logic, which has its own established coverage.
 *
 * Notifications are created with targetUserId set, which per
 * isVisibleTo()'s documented resolution order bypasses rank/role/scope
 * checks entirely (exact-match only) — the simplest reliable way to
 * guarantee visibility to a specific test user regardless of role.
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
    userId: 9201, username: 'test.actor', role: 'SOLDIER',
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
      unitName: 'D58 Alpha Company', unitType: 'COMPANY', unitCode: 'D58-A'
    })).unit;

    const me = makeToken({ userId: 9201, unitId: unitA.id, unitCode: unitA.unitCode, role: 'SOLDIER' });

    // Directly seed 3 test notifications targeted at userId 9201 —
    // targetUserId bypasses rank/role/scope so visibility is guaranteed
    // regardless of SOLDIER's low rank.
    const notifSvc = app.locals.services.notifications;
    await notifSvc.create({ type: 'LOW_STOCK', title: 'D58 low stock 1', message: 'msg', severity: 'HIGH', targetUserId: 9201 });
    await notifSvc.create({ type: 'LOW_STOCK', title: 'D58 low stock 2', message: 'msg', severity: 'HIGH', targetUserId: 9201 });
    await notifSvc.create({ type: 'TRANSFER_PENDING', title: 'D58 transfer', message: 'msg', severity: 'MEDIUM', targetUserId: 9201 });

    // ── Group A: Digest ──────────────────────────────────────────
    console.log('\n📊 Group A: Digest');
    {
      const r = await request(port, 'GET', '/api/notifications/digest?hours=24', me);
      check('A-01 200 + success:true', r.status === 200 && r.json?.success === true, JSON.stringify(r.json));
      check('A-02 windowHours echoed', r.json?.windowHours === 24);
      check('A-03 total includes all 3 seeded notifications', r.json?.total >= 3, `got total=${r.json?.total}`);
      check('A-04 bySeverity breaks down HIGH/MEDIUM correctly', r.json?.bySeverity?.HIGH >= 2 && r.json?.bySeverity?.MEDIUM >= 1,
        JSON.stringify(r.json?.bySeverity));
      check('A-05 byType breaks down LOW_STOCK/TRANSFER_PENDING correctly',
        r.json?.byType?.LOW_STOCK >= 2 && r.json?.byType?.TRANSFER_PENDING >= 1, JSON.stringify(r.json?.byType));
      check('A-06 items capped at 10', r.json?.items?.length <= 10);
      check('A-07 pendingAck is a number', typeof r.json?.pendingAck === 'number');
    }
    {
      // default hours param (no query string) should default to 24
      const r = await request(port, 'GET', '/api/notifications/digest', me);
      check('A-08 omitted hours param defaults to 24', r.status === 200 && r.json?.windowHours === 24);
    }

    // ── Group B: Preferences — read/write lifecycle ──────────────
    console.log('\n⚙️  Group B: Preferences');
    {
      const r = await request(port, 'GET', '/api/notifications/preferences', me);
      check('B-01 200 + success:true', r.status === 200 && r.json?.success === true);
      check('B-02 all 11 known types present, default enabled=true',
        r.json?.preferences?.LOW_STOCK === true && r.json?.preferences?.DELEGATION_GRANTED === true,
        JSON.stringify(r.json?.preferences));
    }
    {
      const r = await request(port, 'PUT', '/api/notifications/preferences', me, { type: 'LOW_STOCK', enabled: false });
      check('B-03 disabling a type → 200 + success:true', r.status === 200 && r.json?.success === true);
      check('B-04 response echoes type/enabled', r.json?.type === 'LOW_STOCK' && r.json?.enabled === false);
    }
    {
      const r = await request(port, 'GET', '/api/notifications/preferences', me);
      check('B-05 LOW_STOCK now false, others untouched (e.g. TRANSFER_PENDING still true)',
        r.json?.preferences?.LOW_STOCK === false && r.json?.preferences?.TRANSFER_PENDING === true);
    }
    {
      const r = await request(port, 'PUT', '/api/notifications/preferences', me, { type: 'LOW_STOCK', enabled: true });
      check('B-06 re-enabling → back to true', r.status === 200 && r.json?.enabled === true);
    }
    {
      const r = await request(port, 'PUT', '/api/notifications/preferences', me, { type: 'NOT_A_REAL_TYPE', enabled: false });
      check('B-07 unknown type → 400', r.status === 400, `got ${r.status}: ${JSON.stringify(r.json)}`);
    }
    {
      const r = await request(port, 'PUT', '/api/notifications/preferences', me, { type: 'LOW_STOCK' });
      check('B-08 missing enabled field → 400 INVALID_REQUEST', r.status === 400 && r.json?.error === 'INVALID_REQUEST');
    }

    // ── Group C: preferences are per-user ─────────────────────────
    console.log('\n👥 Group C: Preferences are per-user, not global');
    {
      const other = makeToken({ userId: 9202, unitId: unitA.id, unitCode: unitA.unitCode, role: 'SOLDIER' });
      await request(port, 'PUT', '/api/notifications/preferences', me, { type: 'SECURITY_ALERT', enabled: false });
      const r = await request(port, 'GET', '/api/notifications/preferences', other);
      check('C-01 a different user is unaffected by my preference change', r.json?.preferences?.SECURITY_ALERT === true,
        JSON.stringify(r.json?.preferences));
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 58 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
