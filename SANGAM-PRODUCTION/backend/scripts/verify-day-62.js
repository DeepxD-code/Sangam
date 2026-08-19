'use strict';

/**
 * Day 62 Verification — Real Pagination for Items & Transfers
 *
 * Transfers already had working limit/offset at both route and service
 * layer; only the frontend needed wiring (flat limit:100 → real PREV/NEXT
 * pages). Items had NONE at any layer — getItemsInScope() returned the
 * complete, unbounded filtered array unconditionally, and 6 internal
 * callers (AlertEscalationService's low-stock scan, ComplianceService's
 * discrepancy report + summary, InventoryLedgerService's stocktake setup
 * ×2, DashboardService's summary widget) depend on that completeness and
 * never pass a limit.
 *
 * The critical risk this script guards against: naively mirroring
 * getTransfersInScope's "default to 50 if unspecified" pattern onto
 * items would have silently truncated every one of those 6 callers to
 * the first 50 items in any unit with more than that — a low-stock scan
 * that silently only checks 50 of 80 items is a much worse bug than the
 * one this day is fixing. getItemsInScope() was instead made strictly
 * opt-in: pagination only applies when filters.limit is explicitly
 * passed. Group B proves this holds with 60 real items in one unit.
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
    userId: 9901, username: 'test.actor', role: 'SYSTEM_ADMIN',
    unitId: 1, unitCode: 'TST', ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: urlPath, method,
      headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
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
      unitName: 'D62 Alpha Company', unitType: 'COMPANY', unitCode: 'D62-A'
    })).unit;
    const admin = makeToken({ unitId: unitA.id, unitCode: unitA.unitCode });

    // Seed 60 items directly via the service (fast — no need for 60 HTTP
    // round-trips for fixture setup, unlike the actual behaviors under test).
    const supply = app.locals.services.supply;
    for (let i = 1; i <= 60; i++) {
      await supply.createItem({
        itemCode: `D62-${String(i).padStart(3, '0')}`, itemName: `D62 Test Item ${i}`,
        category: 'EQUIPMENT', unitId: unitA.id, quantity: 10, lowStockThreshold: 2,
        createdByUserId: 9901
      });
    }

    // ── Group A: HTTP pagination contract for items ──────────────
    console.log('\n📄 Group A: GET /supply/items pagination');
    {
      const r = await request(port, 'GET', '/api/supply/items', admin);
      check('A-01 default page size is 50', r.json?.items?.length === 50, `got ${r.json?.items?.length}`);
      check('A-02 total reflects the full 60, not just this page', r.json?.total === 60, `got ${r.json?.total}`);
      check('A-03 response echoes limit/offset', r.json?.limit === 50 && r.json?.offset === 0);
    }
    {
      const r = await request(port, 'GET', '/api/supply/items?offset=50', admin);
      check('A-04 second page returns the remaining 10', r.json?.items?.length === 10, `got ${r.json?.items?.length}`);
    }
    {
      const r = await request(port, 'GET', '/api/supply/items?limit=200', admin);
      check('A-05 an explicit larger limit returns all 60', r.json?.items?.length === 60);
    }
    {
      const r = await request(port, 'GET', '/api/supply/items?limit=1000', admin);
      check('A-06 limit is capped at 500 server-side (mirrors transfers\' cap)', r.json?.limit === 500);
    }

    // ── Group B: THE critical regression — internal callers unaffected ──
    console.log('\n🛡️  Group B: internal callers still get the COMPLETE set (the real risk this day guards against)');
    {
      const { items, total } = supply.getItemsInScope([unitA.id]); // no limit — exactly how every internal caller invokes this
      check('B-01 getItemsInScope() with no limit returns all 60 items, not 50', items.length === 60, `got ${items.length}`);
      check('B-02 total also reflects 60', total === 60);
    }
    {
      // The exact call shape AlertEscalationService's low-stock scan uses.
      const { items } = app.locals.services.supply.getItemsInScope([unitA.id]);
      check('B-03 a scan across all 60 items would see every one (none silently dropped past item 50)',
        items.length === 60 && items.every(i => i.itemCode.startsWith('D62-')));
    }
    {
      // The exact call shape ComplianceService's discrepancy report uses.
      const scopeUnitIds = [unitA.id];
      const { items } = app.locals.services.supply.getItemsInScope(scopeUnitIds);
      check('B-04 compliance discrepancy scan sees all 60 items in scope', items.length === 60);
    }

    // ── Group C: Transfers pagination (backend unchanged, still correct) ──
    console.log('\n📄 Group C: Transfers pagination (backend already existed, frontend wired Day 62)');
    const unitB = (await app.locals.services.units.createUnit({
      unitName: 'D62 Bravo Company', unitType: 'COMPANY', unitCode: 'D62-B'
    })).unit;
    const item = (await supply.createItem({
      itemCode: 'D62-XFER', itemName: 'Transfer Test Item', category: 'EQUIPMENT',
      unitId: unitA.id, quantity: 100, lowStockThreshold: 2, createdByUserId: 9901
    })).item;
    for (let i = 0; i < 3; i++) {
      await supply.initiateTransfer({ itemId: item.id, fromUnitId: unitA.id, toUnitId: unitB.id, quantity: 1, requestedByUserId: 9901 });
    }
    {
      const r = await request(port, 'GET', '/api/supply/transfers?limit=2&offset=0', admin);
      check('C-01 transfers respects an explicit small limit', r.json?.transfers?.length === 2);
      check('C-02 total reflects all 3', r.json?.total === 3);
    }
    {
      const r = await request(port, 'GET', '/api/supply/transfers?limit=2&offset=2', admin);
      check('C-03 second page returns the remaining 1', r.json?.transfers?.length === 1);
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 62 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
