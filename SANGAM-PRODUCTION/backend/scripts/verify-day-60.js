'use strict';

/**
 * Day 60 Verification — Demo Readiness: extended golden-path smoke test
 *
 * Extends Day 55's original vertical-slice smoke test (unit → staff →
 * stock → transfer → approve → verify chain → alert lifecycle → CSV
 * report) with everything built since: Compliance (Day 56), Delegation
 * (Day 57), and Notification digest (Day 58) — run as ONE continuous
 * narrative against a single server instance, the same way a real demo
 * walkthrough would touch each feature in sequence. This is the primary
 * evidence behind the demo runbook's suggested flow — every step listed
 * there is a step proven to work here first.
 *
 * This does not replace Day 55's own smoke test (still runs, still
 * passes) — it's additive coverage for the four days built since.
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
    userId: 9601, username: 'demo.commander', role: 'COMMANDER',
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
        try { json = JSON.parse(raw); } catch { /* ignore (CSV etc.) */ }
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
    console.log('\n🎬 Extended golden path — Days 1–59 in one continuous narrative');

    // ── Command structure + staffing + stock (proven since Day 55) ──
    const hq = (await app.locals.services.units.createUnit({
      unitName: 'D60 Demo Brigade HQ', unitType: 'BRIGADE', unitCode: 'D60-HQ'
    })).unit;
    const fwd = (await app.locals.services.units.createUnit({
      unitName: 'D60 Demo Forward Post', unitType: 'COMPANY', unitCode: 'D60-FWD'
    })).unit;
    check('1. stand up two units', !!hq && !!fwd);

    const commander = makeToken({ userId: 9601, unitId: hq.id, unitCode: hq.unitCode, role: 'COMMANDER' });

    const itemRes = await request(port, 'POST', '/api/supply/items', commander, {
      itemCode: 'D60-RIFLE', itemName: 'Demo Rifle', category: 'EQUIPMENT',
      unitId: hq.id, quantity: 50, lowStockThreshold: 5
    });
    check('2. stock a supply item', itemRes.status === 201, `got ${itemRes.status}`);
    const itemId = itemRes.json.item.id;

    const xferRes = await request(port, 'POST', '/api/supply/transfers', commander, {
      itemId, fromUnitId: hq.id, toUnitId: fwd.id, quantity: 15, notes: 'D60 demo transfer'
    });
    check('3. request a transfer', xferRes.status === 201, `got ${xferRes.status}`);
    const transferId = xferRes.json.transfer.id;

    const approveRes = await request(port, 'POST', `/api/supply/transfers/${transferId}/approve`, commander);
    check('4. approve → blockchain block written', approveRes.status === 200 && typeof approveRes.json?.transfer?.blockIndex === 'number');

    const verifyRes = await request(port, 'POST', '/api/supply/blockchain/verify', commander);
    check('5. verify the chain is intact', verifyRes.status === 200 && verifyRes.json?.verified === true);

    // ── NEW since Day 55: Compliance ─────────────────────────────
    const custodyRes = await request(port, 'GET', `/api/compliance/chain-of-custody/${itemId}`, commander);
    check('6. [Day 56] chain of custody shows the create + transfer events',
      custodyRes.status === 200 && custodyRes.json?.events?.length >= 3, `got ${custodyRes.status}`);

    const discrepancyRes = await request(port, 'GET', '/api/compliance/discrepancy-report', commander);
    check('7. [Day 56] discrepancy report is clean after a properly-approved transfer',
      discrepancyRes.status === 200 && !discrepancyRes.json?.discrepancies?.some(d => d.itemId === itemId));

    const summaryRes = await request(port, 'GET', '/api/compliance/summary', commander);
    check('8. [Day 56] compliance summary reflects the approved transfer',
      summaryRes.status === 200 && summaryRes.json?.summary?.transfers?.completed >= 1);

    // ── NEW since Day 55: Delegation ─────────────────────────────
    const delegateRes = await request(port, 'POST', '/api/delegation', commander, {
      delegateUserId: 9602, permission: 'supply:approve', unitId: hq.id,
      durationHours: 24, reason: 'D60 demo — commander on leave next week'
    });
    check('9. [Day 57] commander delegates supply:approve for 24h', delegateRes.status === 201, `got ${delegateRes.status}: ${JSON.stringify(delegateRes.json)}`);

    const delegate = makeToken({ userId: 9602, unitId: hq.id, unitCode: hq.unitCode, role: 'SOLDIER' });
    const mineRes = await request(port, 'GET', '/api/delegation/mine', delegate);
    check('10. [Day 57] the delegate sees the delegated authority', mineRes.status === 200 && mineRes.json?.delegations?.length >= 1);

    // ── NEW since Day 55: Notification digest ────────────────────
    const digestRes = await request(port, 'GET', '/api/notifications/digest', commander);
    check('11. [Day 58] notification digest is reachable and well-shaped',
      digestRes.status === 200 && typeof digestRes.json?.total === 'number');

    // ── Alert lifecycle (proven since Day 55) ────────────────────
    const alert = app.locals.services.alerts._raise({
      key: 'd60-demo-alert', type: 'LOW_STOCK', severity: 'HIGH',
      unitId: hq.id, title: 'D60 demo alert', detail: 'Smoke test alert', meta: { itemId }
    }, Date.now());
    const ackRes = await request(port, 'POST', `/api/alerts/${alert.id}/acknowledge`, commander);
    const resolveRes = await request(port, 'POST', `/api/alerts/${alert.id}/resolve`, commander, { note: 'handled' });
    check('12. alert acknowledge → resolve lifecycle', ackRes.status === 200 && resolveRes.status === 200 && resolveRes.json?.alert?.status === 'RESOLVED');

    // ── Reporting — now with the Day 59 health-aware messaging ───
    const healthRes = await request(port, 'GET', '/health', commander);
    check('13. [Day 59] /health correctly reports db disconnected in this offline test run',
      healthRes.status === 503 && healthRes.json?.db?.connected === false);

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 60 Demo Readiness Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
