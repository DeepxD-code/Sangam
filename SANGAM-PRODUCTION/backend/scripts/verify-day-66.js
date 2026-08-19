'use strict';

/**
 * Day 66 Verification — Hierarchical Command Scope in Offline Mode
 *
 * Background: RBACService.getCommandScope() previously collapsed to
 * self-only scope whenever `db` was null — this project's default,
 * "non-negotiable" offline-first runtime mode. Every one of the
 * 1,920 assertions passing through Day 65 exercises that exact
 * db=null path, so this was never caught: a Commander's scope never
 * actually included their subordinate units' data in the mode this
 * system is built and demoed in.
 *
 * The fix: UnitManagementService.getDescendantScope() computes real
 * hierarchy from the in-memory unit tree, and RBACService consults it
 * via a module-level registration point (RBACService.setSharedUnitService,
 * called once by createApp()) whenever no `db` is available.
 *
 * This script verifies, in order:
 *   A. getDescendantScope() directly — multi-level expansion, leaf
 *      units, unknown units, active-only filtering, codes array.
 *   B. RBACService registration mechanics — unregistered (old
 *      behavior preserved byte-for-byte), registered (real
 *      expansion), defensive fallback for a malformed registration.
 *   C. Full HTTP integration — a real multi-level hierarchy with
 *      supply items at every level, verified through /api/units and
 *      /api/supply/items exactly as a browser would hit them.
 *   D. A legitimately-reachable deactivation edge case (a leaf
 *      dropping out of its parent's scope) — see the note in Group D
 *      on why the "inactive parent, active child" case is NOT tested:
 *      it is provably unreachable through the real service API given
 *      deactivateUnit's and reactivateUnit's existing guards.
 */

const jwt       = require('jsonwebtoken');
const http      = require('http');
const createApp = require('../src/app');
const RBACService          = require('../src/services/rbac.service');
const UnitManagementService = require('../src/services/unit-management.service');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 9666, username: 'test.d66', role: 'COMMANDER',
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

  // ── Group A: getDescendantScope() direct tests ───────────────────
  console.log('\n🌳 Group A: UnitManagementService.getDescendantScope()');
  const units = new UnitManagementService(null, null, null);
  let corps, brigadeA, battalionA1, battalionA2;
  {
    corps       = (await units.createUnit({ unitName: 'D66 Test Corps',    unitType: 'CORPS',     unitCode: 'D66-CORPS' })).unit;
    brigadeA    = (await units.createUnit({ unitName: 'D66 Brigade A',     unitType: 'BRIGADE',    unitCode: 'D66-BDE-A', parentUnitId: corps.id })).unit;
    battalionA1 = (await units.createUnit({ unitName: 'D66 Battalion A1',  unitType: 'BATTALION',  unitCode: 'D66-BN-A1', parentUnitId: brigadeA.id })).unit;
    battalionA2 = (await units.createUnit({ unitName: 'D66 Battalion A2',  unitType: 'BATTALION',  unitCode: 'D66-BN-A2', parentUnitId: brigadeA.id })).unit;

    const scope = units.getDescendantScope(corps.id);
    check('A-01 root scope includes self', scope.ids.includes(corps.id));
    check('A-02 root scope includes mid-level child', scope.ids.includes(brigadeA.id));
    check('A-03 root scope includes both grandchildren', scope.ids.includes(battalionA1.id) && scope.ids.includes(battalionA2.id));
    check('A-04 root scope has exactly 4 units (self + 1 + 2)', scope.ids.length === 4, `got ${scope.ids.length}: ${scope.ids}`);
    check('A-05 codes array contains all unit codes', ['D66-CORPS','D66-BDE-A','D66-BN-A1','D66-BN-A2'].every(c => scope.codes.includes(c)));
  }
  {
    const leafScope = units.getDescendantScope(battalionA1.id);
    check('A-06 leaf unit scope is self-only', leafScope.ids.length === 1 && leafScope.ids[0] === battalionA1.id);
  }
  {
    const midScope = units.getDescendantScope(brigadeA.id);
    check('A-07 mid-level scope excludes ancestor (corps), includes self + children', !midScope.ids.includes(corps.id) && midScope.ids.length === 3);
  }
  {
    const unknown = units.getDescendantScope(999999);
    check('A-08 unknown unit → self-only fallback using original id', unknown.ids.length === 1 && unknown.ids[0] === 999999);
    check('A-09 unknown unit → empty codes', unknown.codes.length === 0);
  }
  {
    // String unitId (as JWTs/query params sometimes carry) should behave
    // the same as a numeric one for a real, known unit.
    const scopeFromString = units.getDescendantScope(String(corps.id));
    check('A-10 string unitId resolves same as numeric', scopeFromString.ids.length === 4);
  }

  // ── Group B: RBACService registration mechanics ──────────────────
  console.log('\n🔌 Group B: RBACService shared-unit-service registration');
  {
    RBACService._resetSharedUnitService();
    const rbac = new RBACService(null);
    const scope = await rbac.getCommandScope(corps.id, null);
    check('B-01 unregistered → self-only (pre-Day-66 behavior preserved)', scope.ids.length === 1 && scope.ids[0] === corps.id);
  }
  {
    RBACService.setSharedUnitService(units);
    const rbac = new RBACService(null);
    const scope = await rbac.getCommandScope(corps.id, null);
    check('B-02 registered → real hierarchical expansion', scope.ids.length === 4);
    check('B-03 getSharedUnitService returns the registered instance', RBACService.getSharedUnitService() === units);
  }
  {
    RBACService.setSharedUnitService({ notAUnitService: true });
    const rbac = new RBACService(null);
    const scope = await rbac.getCommandScope(corps.id, null);
    check('B-04 malformed registration (no getDescendantScope method) → graceful self-only fallback, no crash', scope.ids.length === 1 && scope.ids[0] === corps.id);
  }
  {
    // Restore proper registration for Group C/D, which rely on createApp()
    // re-registering its own `units` instance anyway — but confirm the
    // registry recovers cleanly first.
    RBACService.setSharedUnitService(units);
    const rbac = new RBACService(null);
    const scope = await rbac.getCommandScope(brigadeA.id, null);
    check('B-05 registry recovers after a bad registration', scope.ids.length === 3);
  }

  // ── Group C: full HTTP integration ────────────────────────────────
  console.log('\n🌐 Group C: end-to-end over real HTTP (/api/units, /api/supply/items)');
  const app    = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const svcUnits  = app.locals.services.units;
    const svcSupply = app.locals.services.supply;

    const hq   = (await svcUnits.createUnit({ unitName: 'D66C HQ',   unitType: 'CORPS',    unitCode: 'D66C-HQ' })).unit;
    const bde  = (await svcUnits.createUnit({ unitName: 'D66C Bde',  unitType: 'BRIGADE',  unitCode: 'D66C-BDE', parentUnitId: hq.id })).unit;
    const bn   = (await svcUnits.createUnit({ unitName: 'D66C Bn',   unitType: 'BATTALION',unitCode: 'D66C-BN', parentUnitId: bde.id })).unit;
    const bn2  = (await svcUnits.createUnit({ unitName: 'D66C Bn2',  unitType: 'BATTALION',unitCode: 'D66C-BN2', parentUnitId: bde.id })).unit;

    await svcSupply.createItem({ itemCode: 'D66C-I-HQ', itemName: 'HQ Item',  category: 'EQUIPMENT', unitId: hq.id,  quantity: 1 });
    await svcSupply.createItem({ itemCode: 'D66C-I-BDE', itemName: 'Bde Item', category: 'EQUIPMENT', unitId: bde.id, quantity: 1 });
    await svcSupply.createItem({ itemCode: 'D66C-I-BN',  itemName: 'Bn Item',  category: 'EQUIPMENT', unitId: bn.id,  quantity: 1 });
    await svcSupply.createItem({ itemCode: 'D66C-I-BN2', itemName: 'Bn2 Item', category: 'EQUIPMENT', unitId: bn2.id, quantity: 1 });

    const commanderAtHQ = makeToken({ userId: 9667, unitId: hq.id, unitCode: hq.unitCode });
    const commanderAtBn = makeToken({ userId: 9668, unitId: bn.id, unitCode: bn.unitCode });

    {
      const r = await request(port, 'GET', '/api/units', commanderAtHQ);
      check('C-01 HQ commander → 200', r.status === 200);
      check('C-02 HQ commander sees all 4 units in hierarchy', r.json?.total === 4, `got total=${r.json?.total}`);
      const codes = (r.json?.units || []).map(u => u.unitCode);
      check('C-03 HQ commander\'s unit list includes the leaf battalions', codes.includes('D66C-BN') && codes.includes('D66C-BN2'));
    }
    {
      const r = await request(port, 'GET', '/api/supply/items', commanderAtHQ);
      check('C-04 HQ commander → 200 on items', r.status === 200);
      const codes = (r.json?.data?.items || r.json?.items || []).map(i => i.itemCode);
      check('C-05 HQ commander sees items from every level of the hierarchy', ['D66C-I-HQ','D66C-I-BDE','D66C-I-BN','D66C-I-BN2'].every(c => codes.includes(c)), `got ${JSON.stringify(codes)}`);
    }
    {
      const r = await request(port, 'GET', '/api/units', commanderAtBn);
      check('C-06 battalion-level commander → 200', r.status === 200);
      check('C-07 battalion-level commander sees only their own unit (leaf, no children)', r.json?.total === 1, `got total=${r.json?.total}`);
    }
    {
      const r = await request(port, 'GET', '/api/supply/items', commanderAtBn);
      const codes = (r.json?.data?.items || r.json?.items || []).map(i => i.itemCode);
      check('C-08 battalion-level commander does NOT see sibling battalion\'s items', !codes.includes('D66C-I-BN2'));
      check('C-09 battalion-level commander does NOT see HQ/brigade items (no upward leakage)', !codes.includes('D66C-I-HQ') && !codes.includes('D66C-I-BDE'));
      check('C-10 battalion-level commander DOES see their own item', codes.includes('D66C-I-BN'));
    }

    // ── Group D: legitimate deactivation edge case ──────────────────
    console.log('\n🚫 Group D: deactivation (leaf unit dropping out of parent scope)');
    // NOTE ON SCOPE: the "inactive parent with an active child" case is
    // NOT tested here because it is provably unreachable through the
    // real service API: deactivateUnit() refuses to deactivate a unit
    // with active children (HAS_ACTIVE_CHILDREN), and reactivateUnit()
    // refuses to reactivate a unit whose parent is inactive
    // (PARENT_INACTIVE). Together these guarantee any active unit's
    // full ancestor chain is active, so getDescendantScope's per-level
    // active check — while implemented for correctness and SQL-CTE
    // parity — cannot currently be exercised in that direction through
    // legitimate use. Testing it via direct state manipulation would
    // check a state the system cannot actually reach, which would be
    // misleading rather than informative.
    {
      const deactivateResult = await svcUnits.deactivateUnit(bn2.id);
      check('D-01 deactivating a leaf unit (no children) succeeds', deactivateResult.success === true);

      const r = await request(port, 'GET', '/api/units', commanderAtHQ);
      const codes = (r.json?.units || []).map(u => u.unitCode);
      check('D-02 HQ commander scope no longer includes the deactivated leaf', !codes.includes('D66C-BN2'));
      check('D-03 HQ commander scope still includes the active sibling leaf', codes.includes('D66C-BN'));
      check('D-04 HQ commander total drops from 4 to 3', r.json?.total === 3, `got ${r.json?.total}`);
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 66 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
