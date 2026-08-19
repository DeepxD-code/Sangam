'use strict';

/**
 * Day 63 Verification — Admin Snapshot Export/Restore
 *
 * Scope: Units + Supply Items only, by deliberate design (see
 * admin.routes.js's header comment for why Users/Transfers/Blockchain
 * are explicitly excluded). This script verifies: a real export/modify/
 * restore round trip preserves exact IDs and data, the ID counter is
 * correctly advanced after restore so new creates don't collide with
 * restored records, permission gating (system:admin, SYSTEM_ADMIN only),
 * and basic input validation.
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
    userId: 9601, username: 'test.admin', role: 'SYSTEM_ADMIN',
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
  const admin = makeToken();

  try {
    // ── Fixtures: a small but real dataset ──────────────────────
    const unitA = (await app.locals.services.units.createUnit({
      unitName: 'D63 Alpha', unitType: 'COMPANY', unitCode: 'D63-A'
    })).unit;
    const itemA = (await app.locals.services.supply.createItem({
      itemCode: 'D63-ITEM', itemName: 'D63 Test Item', category: 'EQUIPMENT',
      unitId: unitA.id, quantity: 42, lowStockThreshold: 5
    })).item;

    // ── Group A: permission gating ───────────────────────────────
    console.log('\n🔐 Group A: system:admin permission gate');
    {
      const commander = makeToken({ userId: 9602, role: 'COMMANDER' });
      const r = await request(port, 'GET', '/api/admin/snapshot', commander);
      check('A-01 COMMANDER → 403 on snapshot export (lacks system:admin)', r.status === 403, `got ${r.status}`);
    }
    {
      const commander = makeToken({ userId: 9602, role: 'COMMANDER' });
      const r = await request(port, 'POST', '/api/admin/restore', commander, { units: [] });
      check('A-02 COMMANDER → 403 on restore', r.status === 403);
    }

    // ── Group B: export ───────────────────────────────────────────
    console.log('\n📦 Group B: snapshot export');
    let snapshot;
    {
      const r = await request(port, 'GET', '/api/admin/snapshot', admin);
      check('B-01 SYSTEM_ADMIN → 200', r.status === 200 && r.json?.success === true);
      check('B-02 includes our unit', r.json?.units?.some(u => u.id === unitA.id && u.unitCode === 'D63-A'));
      check('B-03 includes our item with correct field values', r.json?.items?.some(i => i.id === itemA.id && i.quantity === 42));
      check('B-04 counts match array lengths', r.json?.unitCount === r.json?.units?.length && r.json?.itemCount === r.json?.items?.length);
      snapshot = r.json;
    }

    // ── Group C: the real round trip — mutate, then restore ──────
    console.log('\n🔄 Group C: mutate state, restore from snapshot, verify exact recovery');
    {
      // Mutate: change the item's quantity, create an extra unit.
      await app.locals.services.supply.updateItem(itemA.id, { quantity: 999 }, 9601);
      await app.locals.services.units.createUnit({ unitName: 'D63 Decoy', unitType: 'COMPANY', unitCode: 'D63-DECOY' });

      const beforeRestore = await request(port, 'GET', '/api/admin/snapshot', admin);
      check('C-01 sanity: state really did change before restore', beforeRestore.json?.units?.length === snapshot.units.length + 1);
    }
    {
      const r = await request(port, 'POST', '/api/admin/restore', admin, { units: snapshot.units, items: snapshot.items });
      check('C-02 restore succeeds', r.status === 200 && r.json?.success === true);
      check('C-03 restore reports correct counts', r.json?.unitsRestored === snapshot.units.length && r.json?.itemsRestored === snapshot.items.length);
    }
    {
      const after = await request(port, 'GET', '/api/admin/snapshot', admin);
      check('D-01 unit count back to exactly the original (decoy is gone)', after.json?.units?.length === snapshot.units.length);
      check('D-02 the decoy unit is really gone', !after.json?.units?.some(u => u.unitCode === 'D63-DECOY'));
      const restoredItem = after.json?.items?.find(i => i.id === itemA.id);
      check('D-03 item quantity restored to the original 42 (not the mutated 999)', restoredItem?.quantity === 42, `got ${restoredItem?.quantity}`);
    }

    // ── Group D: ID counter correctly advanced after restore ─────
    console.log('\n🔢 Group D: ID counter after restore');
    {
      const newUnit = await app.locals.services.units.createUnit({ unitName: 'D63 Post-Restore', unitType: 'COMPANY', unitCode: 'D63-POST' });
      check('E-01 a new unit created after restore gets a fresh, non-colliding ID',
        newUnit.success && newUnit.unit.id > unitA.id, `got id=${newUnit?.unit?.id}, expected > ${unitA.id}`);
    }
    {
      const newItem = await app.locals.services.supply.createItem({
        itemCode: 'D63-POST-ITEM', itemName: 'Post restore item', category: 'EQUIPMENT',
        unitId: unitA.id, quantity: 1
      });
      check('E-02 a new item created after restore gets a fresh, non-colliding ID',
        newItem.success && newItem.item.id > itemA.id, `got id=${newItem?.item?.id}, expected > ${itemA.id}`);
    }

    // ── Group E: input validation ──────────────────────────────────
    console.log('\n🧪 Group E: restore input validation');
    {
      const r = await request(port, 'POST', '/api/admin/restore', admin, { notARealField: true });
      check('F-01 body with neither units nor items array → 400 INVALID_SNAPSHOT', r.status === 400 && r.json?.error === 'INVALID_SNAPSHOT');
    }
    {
      const r = await request(port, 'POST', '/api/admin/restore', admin, { units: [{ id: 1, unitName: 'partial' }] });
      check('F-02 a partial restore (units only) succeeds without requiring items', r.status === 200 && r.json?.unitsRestored === 1 && r.json?.itemsRestored === undefined);
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 63 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
