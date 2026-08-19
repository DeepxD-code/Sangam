'use strict';

/**
 * HTTP Integration Smoke Test — Actor Attribution Contract Guard
 *
 * Background: Day 46 discovered that `authenticate()` builds `req.user` via
 * RBACService.buildUserContext(), which returns { userId, username, role,
 * unitId, ... } — there is NO `.id` field on req.user, ever. Seven route
 * files (unit, supply, inventory, bulk, user, movement, dashboard — 36
 * call sites total) were written using `req.user.id` instead of
 * `req.user.userId`, so every one of those calls silently passed
 * `undefined` as the acting user. In a compliance/audit-trail system this
 * meant the "who did this" field on nearly every mutating action
 * (unit updates, item updates, transfer approvals, stocktake sessions,
 * bulk operations, user admin actions, movement dispatch) was blank.
 *
 * Unit tests never caught this because their stubbed `req.user`/
 * `userContext` fixtures set BOTH `.id` and `.userId` (or, in one case,
 * verify-day-26.js's dashboard fixture, set only `.id` — matching the bug
 * rather than the real contract). Only a real HTTP request through the
 * real `authenticate()` middleware reproduces the actual shape.
 *
 * This script boots the REAL Express app with the REAL AuthMiddleware and
 * a signed JWT, performs one representative mutating call per previously-
 * broken file, and inspects the REAL AuditLogService event stream (or, for
 * the dashboard cache, the real cache Map) to confirm the actor recorded
 * is never null/undefined and always matches the calling user's real id.
 *
 * Run this after ANY change to req.user handling in route or service files.
 */

const jwt  = require('jsonwebtoken');
const http = require('http');
const createApp        = require('../src/app');
const AuditLogService   = require('../src/services/audit-log.service');
const DashboardService  = require('../src/services/dashboard.service');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 1, username: 'test.actor', displayName: 'Test Actor',
    role: 'SYSTEM_ADMIN', unitId: 1, unitCode: 'TST',
    ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      port, path, method,
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
        try { json = JSON.parse(raw); } catch { /* non-JSON body, leave null */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  // ── Shared services: real audit instance so we can observe every
  //    'log' event the same way a real audit dashboard would.
  const audit = new AuditLogService(null);
  const capturedLogs = [];
  audit.on('log', entry => capturedLogs.push(entry));

  // Dashboard service constructed with no deps — sections gracefully
  // degrade to { available:false }; we only care about its cache Map here.
  const dashboard = new DashboardService({});

  const app    = createApp(null, { audit, dashboard }, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const services = app.locals.services; // real units/supply/users/movement/inventory

  try {
    // ── FIXTURES ─────────────────────────────────────────────────────
    console.log('\n🔧 Seeding fixtures');
    const unitA = (await services.units.createUnit({
      unitName: 'Actor-Test Coy A', unitType: 'COMPANY', unitCode: 'ACT-A'
    })).unit;
    const unitB = (await services.units.createUnit({
      unitName: 'Actor-Test Coy B', unitType: 'COMPANY', unitCode: 'ACT-B'
    })).unit;
    const item1 = (await services.supply.createItem({
      itemCode: 'ACT-001', itemName: 'Test Rifle', category: 'EQUIPMENT',
      unitId: unitA.id, quantity: 50, lowStockThreshold: 5
    })).item;
    const userSelf = (await services.users.createUser({
      username: 'self.test', displayName: 'Self Test', role: 'SOLDIER', unitId: unitB.id
    })).user;
    const userOther = (await services.users.createUser({
      username: 'other.test', displayName: 'Other Test', role: 'SOLDIER', unitId: unitB.id
    })).user;
    check('Fixtures created (2 units, 1 item, 2 users)',
      !!(unitA?.id && unitB?.id && item1?.id && userSelf?.id && userOther?.id));

    const ACTOR_ID = 9001; // arbitrary — not tied to any real user record
    const actorToken = makeToken({ userId: ACTOR_ID, unitId: unitA.id, unitCode: unitA.unitCode });
    // Token whose claimed unit (unitA) deliberately does NOT match userSelf's
    // real unit (unitB) — isolates the self-vs-other bypass from scope luck.
    const selfToken = makeToken({ userId: userSelf.id, unitId: unitA.id, unitCode: unitA.unitCode });

    // Helper: run an HTTP call and return only the audit log entries it produced.
    async function logsDuring(fn) {
      const before = capturedLogs.length;
      const res = await fn();
      return { res, newLogs: capturedLogs.slice(before) };
    }
    function assertCleanAttribution(label, newLogs, expectedActorId) {
      check(`${label}: produced at least one audit entry`, newLogs.length > 0);
      check(`${label}: no audit entry has a null/undefined actor`,
        newLogs.every(e => e.userId !== null && e.userId !== undefined),
        `saw userId values: ${JSON.stringify(newLogs.map(e => e.userId))}`);
      check(`${label}: at least one entry attributes the real actor (${expectedActorId})`,
        newLogs.some(e => e.userId === expectedActorId),
        `saw userId values: ${JSON.stringify(newLogs.map(e => e.userId))}`);
    }

    // ── 1. UNIT — PUT /api/units/:id (unit.routes.js) ──────────────────
    console.log('\n📋 Group 1: unit.routes.js — updateUnit');
    {
      const { res, newLogs } = await logsDuring(() =>
        request(port, 'PUT', `/api/units/${unitA.id}`, actorToken, { unitName: 'Actor-Test Coy A (Updated)' }));
      check('updateUnit HTTP 200', res.status === 200, `got ${res.status}: ${JSON.stringify(res.json)}`);
      assertCleanAttribution('updateUnit', newLogs, ACTOR_ID);
    }

    // ── 2. SUPPLY — PUT /api/supply/items/:id (supply.routes.js) ───────
    console.log('\n📦 Group 2: supply.routes.js — updateItem');
    {
      const { res, newLogs } = await logsDuring(() =>
        request(port, 'PUT', `/api/supply/items/${item1.id}`, actorToken, { quantity: 75 }));
      check('updateItem HTTP 200', res.status === 200, `got ${res.status}: ${JSON.stringify(res.json)}`);
      assertCleanAttribution('updateItem', newLogs, ACTOR_ID);
    }

    // ── 2b. SUPPLY — POST /api/supply/items (createItem actor gap) ─────
    console.log('\n📦 Group 2b: supply.routes.js — createItem (actor param was silently dropped)');
    {
      const { res, newLogs } = await logsDuring(() =>
        request(port, 'POST', '/api/supply/items', actorToken, {
          itemCode: 'ACT-002', itemName: 'Test Radio', category: 'COMMS',
          unitId: unitA.id, quantity: 10, lowStockThreshold: 2
        }));
      check('createItem HTTP 201', res.status === 201, `got ${res.status}: ${JSON.stringify(res.json)}`);
      assertCleanAttribution('createItem', newLogs, ACTOR_ID);
    }

    // ── 3. INVENTORY — POST /api/inventory/sessions (inventory.routes.js)
    console.log('\n📊 Group 3: inventory.routes.js — createSession');
    let sessionId;
    {
      const { res, newLogs } = await logsDuring(() =>
        request(port, 'POST', '/api/inventory/sessions', actorToken, { unitId: unitA.id }));
      check('createSession HTTP 201', res.status === 201, `got ${res.status}: ${JSON.stringify(res.json)}`);
      sessionId = res.json?.session?.id;
      assertCleanAttribution('createSession', newLogs, ACTOR_ID);
    }
    if (sessionId) {
      const { res, newLogs } = await logsDuring(() =>
        request(port, 'POST', `/api/inventory/sessions/${sessionId}/cancel`, actorToken, { reason: 'contract test cleanup' }));
      check('cancelSession HTTP 200', res.status === 200, `got ${res.status}: ${JSON.stringify(res.json)}`);
      assertCleanAttribution('cancelSession', newLogs, ACTOR_ID);
    }

    // ── 4. MOVEMENT — POST /api/movement/orders + dispatch ─────────────
    console.log('\n🚚 Group 4: movement.routes.js — createOrder + dispatch');
    let orderId;
    {
      const { res, newLogs } = await logsDuring(() =>
        request(port, 'POST', '/api/movement/orders', actorToken, {
          fromUnitId: unitA.id, toUnitId: unitB.id, items: [{ quantity: 5 }], priority: 'ROUTINE'
        }));
      check('createOrder HTTP 201', res.status === 201, `got ${res.status}: ${JSON.stringify(res.json)}`);
      orderId = res.json?.order?.id;
      assertCleanAttribution('createOrder', newLogs, ACTOR_ID);
    }
    if (orderId) {
      const { res, newLogs } = await logsDuring(() =>
        request(port, 'POST', `/api/movement/orders/${orderId}/dispatch`, actorToken, {}));
      check('dispatch HTTP 200', res.status === 200, `got ${res.status}: ${JSON.stringify(res.json)}`);
      assertCleanAttribution('dispatch', newLogs, ACTOR_ID);
    }

    // ── 5. USER — PUT /api/users/:id + self-vs-other scope bypass ──────
    console.log('\n👤 Group 5: user.routes.js — updateUser + self/other scope guard');
    {
      const { res, newLogs } = await logsDuring(() =>
        request(port, 'PUT', `/api/users/${userOther.id}`, actorToken, { displayName: 'Other Test (Updated)' }));
      check('updateUser HTTP 200', res.status === 200, `got ${res.status}: ${JSON.stringify(res.json)}`);
      assertCleanAttribution('updateUser', newLogs, ACTOR_ID);
    }
    {
      // selfToken's claimed unitId (unitA) does NOT include userSelf's real
      // unit (unitB) in scope — so this only succeeds if the self-bypass
      // (user.id !== req.user.userId) correctly recognizes "this is me".
      const self = await request(port, 'GET', `/api/users/${userSelf.id}`, selfToken);
      check('GET own profile bypasses scope check (self)', self.status === 200,
        `got ${self.status}: ${JSON.stringify(self.json)}`);

      const other = await request(port, 'GET', `/api/users/${userOther.id}`, selfToken);
      check('GET a different out-of-scope user is still rejected (not self)', other.status === 403,
        `got ${other.status}: ${JSON.stringify(other.json)}`);
    }

    // ── 6. BULK — POST /api/bulk/update-quantity (bulk.routes.js) ──────
    console.log('\n📥 Group 6: bulk.routes.js — bulkUpdateQuantity');
    {
      const { res, newLogs } = await logsDuring(() =>
        request(port, 'POST', '/api/bulk/update-quantity', actorToken, {
          updates: [{ itemId: item1.id, quantity: 80 }]
        }));
      check('bulkUpdateQuantity HTTP 207', res.status === 207, `got ${res.status}: ${JSON.stringify(res.json)}`);
      assertCleanAttribution('bulkUpdateQuantity', newLogs, ACTOR_ID);
    }

    // ── 7. DASHBOARD — POST /api/dashboard/refresh scopes cache clear ──
    console.log('\n📈 Group 7: dashboard.routes.js — refresh scopes clearCache per-user');
    {
      const myKey    = `${ACTOR_ID}_${unitA.id}`;
      const otherKey = `8888_${unitA.id}`;
      dashboard._cache.set(myKey,    { at: Date.now(), data: { fake: true } });
      dashboard._cache.set(otherKey, { at: Date.now(), data: { fake: true } });

      const res = await request(port, 'POST', '/api/dashboard/refresh', actorToken, {});
      check('dashboard refresh HTTP 200', res.status === 200, `got ${res.status}`);
      check("refresh only clears the caller's own cache entry, not other users'",
        dashboard._cache.has(otherKey),
        'other user\'s cache entry was wiped — clearCache is not scoped per-user');
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Actor Attribution Contract Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
