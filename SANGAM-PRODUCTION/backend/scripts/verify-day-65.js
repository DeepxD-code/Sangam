'use strict';

/**
 * Day 65 Verification — Final Sprint Smoke Test (Days 61-64)
 *
 * Extends the Day 60 golden-path narrative (itself an extension of Day
 * 55's original) with everything built since: rate limiting (Day 61),
 * items pagination (Day 62), admin snapshot/restore (Day 63). Day 64's
 * accessibility/keyboard work has its own dedicated verify-day-64.js
 * (contrast math + undefined-CSS-variable sweep) since it's not really
 * part of a request-flow narrative — not duplicated here.
 *
 * This is the last new verify script of the 56-65 sprint. Day 65's other
 * work is the final full regression run and the handoff package, not
 * new features.
 */

const jwt        = require('jsonwebtoken');
const http        = require('http');
const createApp    = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 9001, username: 'demo.commander', role: 'COMMANDER',
    unitId: 1, unitCode: 'X', ...overrides
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
        resolve({ status: res.statusCode, json });
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
    console.log('\n🎬 Final sprint narrative — Days 61-64 on top of the proven Day 60 path');

    const hq = (await app.locals.services.units.createUnit({
      unitName: 'D65 Final Brigade', unitType: 'BRIGADE', unitCode: 'D65-HQ'
    })).unit;
    const commander = makeToken({ userId: 9001, unitId: hq.id, unitCode: hq.unitCode, role: 'COMMANDER' });

    // ── [Day 62] Items pagination in a realistic-sized unit ──────
    for (let i = 1; i <= 12; i++) {
      await app.locals.services.supply.createItem({
        itemCode: `D65-${i}`, itemName: `D65 Item ${i}`, category: 'EQUIPMENT',
        unitId: hq.id, quantity: 10, lowStockThreshold: 2, createdByUserId: 9001
      });
    }
    {
      const r = await request(port, 'GET', '/api/supply/items?limit=5&offset=0', commander);
      check('1. [Day 62] items page 1 returns exactly 5, total reflects all 12', r.json?.items?.length === 5 && r.json?.total === 12);
    }
    {
      const r = await request(port, 'GET', '/api/supply/items?limit=5&offset=10', commander);
      check('2. [Day 62] last page returns the remaining 2', r.json?.items?.length === 2);
    }
    {
      // The Day 62 safety property, re-confirmed one more time in the
      // final sprint smoke test: internal callers still see everything.
      const { items } = app.locals.services.supply.getItemsInScope([hq.id]);
      check('3. [Day 62] an internal caller (no limit passed) still sees all 12, not just a page', items.length === 12);
    }

    // ── [Day 61] Rate limiting doesn't interfere with normal use ──
    {
      const r = await request(port, 'POST', '/api/delegation/overrides', commander, {
        permission: 'supply:read', justification: 'D65 final smoke test override'
      });
      check('4. [Day 61] a single override request (well under the 5/hour limit) succeeds normally', r.status === 201);
    }

    // ── [Day 63] Admin snapshot round trip ────────────────────────
    const admin = makeToken({ userId: 9002, role: 'SYSTEM_ADMIN' });
    let snapshot;
    {
      const r = await request(port, 'GET', '/api/admin/snapshot', admin);
      check('5. [Day 63] snapshot export includes the brigade and all 12 items', r.status === 200 &&
        r.json?.units?.some(u => u.id === hq.id) && r.json?.items?.length === 12);
      snapshot = r.json;
    }
    {
      // Mutate, then restore, proving the whole chain still works
      // together at the end of the sprint, not just in isolation.
      await app.locals.services.units.createUnit({ unitName: 'D65 Should Be Reverted', unitType: 'COMPANY', unitCode: 'D65-REVERT' });
      const r = await request(port, 'POST', '/api/admin/restore', admin, { units: snapshot.units, items: snapshot.items });
      check('6. [Day 63] restore succeeds', r.status === 200 && r.json?.success === true);

      const after = await request(port, 'GET', '/api/admin/snapshot', admin);
      check('7. [Day 63] the decoy unit created after the snapshot is gone post-restore',
        !after.json?.units?.some(u => u.unitCode === 'D65-REVERT'));
    }

    // ── Whole-sprint sanity: Days 56-59 features still reachable ──
    console.log('\n🔗 Whole-sprint sanity: earlier days\' features still work alongside the latest');
    {
      const r = await request(port, 'GET', '/api/compliance/summary', commander);
      check('8. [Day 56] Compliance summary still reachable and correctly shaped', r.status === 200 && !!r.json?.summary);
    }
    {
      const r = await request(port, 'GET', '/api/delegation/stats', commander);
      check('9. [Day 57] Delegation stats still reachable', r.status === 200 && typeof r.json?.totalOverrides === 'number');
    }
    {
      const r = await request(port, 'GET', '/api/notifications/digest', commander);
      check('10. [Day 58] Notification digest still reachable', r.status === 200);
    }
    {
      const r = await request(port, 'GET', '/health', commander);
      check('11. [Day 59] Health endpoint still correctly reports offline mode', r.status === 503 && r.json?.db?.connected === false);
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 65 Final Sprint Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
