'use strict';

/**
 * Day 54 Verification — Edge-Case & Input Validation Hardening
 *
 * Reclaimed hardening day. Three real, narrow validation gaps found and
 * fixed while auditing the mutation paths a live demo is most likely to
 * exercise (a presenter typo-ing a quantity, or an accidental blank name):
 *   1. SupplyChainService.createItem() had NO quantity/lowStockThreshold
 *      validation at all — unlike its sibling updateItem, which already
 *      rejects negative/NaN values. A negative quantity at creation was
 *      previously silently clamped to 0 by downstream Math.max(0, ...)
 *      rather than rejected, so the caller got no feedback that their
 *      input was discarded.
 *   2. UnitManagementService.createUnit() rejected an empty unitName
 *      ('') but not a whitespace-only one ('   '), which would create a
 *      unit that looks blank in every list/tree view.
 *   3. UnitManagementService.updateUnit() had no unitName validation at
 *      all beyond "is it present in the updates object".
 * This script proves all three are now rejected with clear errors, and
 * that valid edge values (quantity: 0, a name with internal but not
 * leading/trailing whitespace) still work correctly.
 */

const jwt  = require('jsonwebtoken');
const http = require('http');
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
    const req = http.request({ port, path: urlPath, method,
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      } }, (res) => {
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
  const app = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const token = makeToken();

  try {
    const unit = (await app.locals.services.units.createUnit({
      unitName: 'D54 Test Unit', unitType: 'COMPANY', unitCode: 'D54-A'
    })).unit;

    console.log('\n🩹 Group A: createItem rejects invalid quantity/threshold (new this day)');
    {
      const r = await request(port, 'POST', '/api/supply/items', token, {
        itemCode: 'D54-NEG', itemName: 'Bad Item', category: 'EQUIPMENT',
        unitId: unit.id, quantity: -5, lowStockThreshold: 2
      });
      check('negative quantity → rejected, not silently clamped to 0',
        r.status === 400 && r.json?.error === 'INVALID_QUANTITY', `got ${r.status}: ${JSON.stringify(r.json)}`);
    }
    {
      const r = await request(port, 'POST', '/api/supply/items', token, {
        itemCode: 'D54-NAN', itemName: 'Bad Item 2', category: 'EQUIPMENT',
        unitId: unit.id, quantity: 'not-a-number', lowStockThreshold: 2
      });
      check('non-numeric quantity → rejected', r.status === 400 && r.json?.error === 'INVALID_QUANTITY');
    }
    {
      const r = await request(port, 'POST', '/api/supply/items', token, {
        itemCode: 'D54-NEGTH', itemName: 'Bad Item 3', category: 'EQUIPMENT',
        unitId: unit.id, quantity: 5, lowStockThreshold: -1
      });
      check('negative lowStockThreshold → rejected', r.status === 400 && r.json?.error === 'INVALID_THRESHOLD');
    }
    {
      // Edge value: exactly 0 must still be accepted (a freshly-registered
      // item legitimately starts with zero on hand)
      const r = await request(port, 'POST', '/api/supply/items', token, {
        itemCode: 'D54-ZERO', itemName: 'Zero Stock Item', category: 'EQUIPMENT',
        unitId: unit.id, quantity: 0, lowStockThreshold: 0
      });
      check('quantity: 0 is still a valid, accepted edge case (not treated as falsy/missing)',
        r.status === 201 && r.json?.item?.quantity === 0, `got ${r.status}: ${JSON.stringify(r.json)}`);
    }

    console.log('\n🩹 Group B: unit name whitespace validation (new this day)');
    {
      const r = await request(port, 'POST', '/api/units', token, {
        unitName: '   ', unitType: 'COMPANY', unitCode: 'D54-WS'
      });
      check('whitespace-only unitName → rejected on create', r.status === 400 && r.json?.error === 'MISSING_REQUIRED_FIELDS',
        `got ${r.status}: ${JSON.stringify(r.json)}`);
    }
    {
      const r = await request(port, 'PUT', `/api/units/${unit.id}`, token, { unitName: '   ' });
      check('whitespace-only unitName → rejected on update', r.status === 400 && r.json?.error === 'INVALID_UNIT_NAME',
        `got ${r.status}: ${JSON.stringify(r.json)}`);
    }
    {
      // A name with legitimate internal spacing must still work fine
      const r = await request(port, 'PUT', `/api/units/${unit.id}`, token, { unitName: '2nd Battalion HQ' });
      check('a normal multi-word name still updates successfully', r.status === 200 && r.json?.unit?.unitName === '2nd Battalion HQ');
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 54 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
