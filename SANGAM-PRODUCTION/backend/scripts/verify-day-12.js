'use strict';

/**
 * SANGAM Day 12 — Verification Suite
 * Tests: command-scope aggregation, 6 report types (stock, transfers,
 * blockchain, mesh, security, roster), dashboard caching, CSV export.
 *
 * No real database required — DB-dependent methods are tested against
 * a lightweight mock that records calls and returns queued rows.
 *
 * Run: node backend/scripts/verify-day-12.js
 */

const path = require('path');

const RBACService        = require(path.join(__dirname, '../src/services/rbac.service'));
const NotificationService = require(path.join(__dirname, '../src/services/notification.service'));
const ReportingService    = require(path.join(__dirname, '../src/services/reporting.service'));

// ============================================================
// Minimal test framework
// ============================================================
let passed = 0;
let failed = 0;
const failures = [];

async function test(label, fn) {
  try {
    await fn();
    process.stdout.write(`  ✅  ${label}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  ❌  ${label}\n       → ${err.message}\n`);
    failed++;
    failures.push({ label, error: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function section(name) {
  console.log(`\n📋  ${name}`);
}

// ============================================================
// FIXTURES — same unit tree as Day 11
//
//   100 Battalion
//     ├─ 101 Company A
//     │    ├─ 103 Platoon 1 (A)
//     │    └─ 104 Platoon 2 (A)
//     └─ 102 Company B
//          └─ 105 Platoon 1 (B)
// ============================================================
function buildRBAC() {
  const rbac = new RBACService(null);
  rbac._hierarchyCache.set('scope_100', { ids: [100, 101, 102, 103, 104, 105], codes: [] });
  rbac._hierarchyCache.set('scope_101', { ids: [101, 103, 104], codes: [] });
  rbac._hierarchyCache.set('scope_102', { ids: [102, 105], codes: [] });
  rbac._hierarchyCache.set('scope_103', { ids: [103], codes: [] });
  rbac._hierarchyCache.set('scope_104', { ids: [104], codes: [] });
  rbac._hierarchyCache.set('scope_105', { ids: [105], codes: [] });
  return rbac;
}

function makeUser(rbac, { id, username, role, unitId, unitCode }) {
  return rbac.buildUserContext({
    id, username, display_name: username, role, unit_id: unitId, unit_code: unitCode
  });
}

/** Lightweight DB mock — records calls, returns queued responses (FIFO). */
function makeMockDb(responses = []) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const next = queue.shift();
      return next !== undefined ? next : { rows: [] };
    }
  };
}

/** DB mock whose query always throws — for graceful-degradation tests. */
function makeThrowingDb() {
  return { calls: [], query: async () => { throw new Error('connection refused'); } };
}

// ============================================================
// TEST SUITES
// ============================================================
async function run() {
  console.log('\n📊  SANGAM Day 12 — Reporting & Analytics Verification');
  console.log('═'.repeat(58));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const rbac = buildRBAC();

  const battalionCO   = makeUser(rbac, { id: 5, username: 'bn_co',      role: 'SENIOR_OFFICER', unitId: 100, unitCode: 'BN-HQ' });
  const coyACommander = makeUser(rbac, { id: 3, username: 'coy_a_cmdr', role: 'OFFICER',        unitId: 101, unitCode: 'COY-A' });

  // ──────────────────────────────────────────────────────────
  section('1 · Constants & Construction');
  // ──────────────────────────────────────────────────────────

  await test('DASHBOARD_TTL_MS is 5 minutes', () => {
    assert(ReportingService.DASHBOARD_TTL_MS === 5 * 60 * 1000);
  });

  await test('DEFAULT_TRANSFER_WINDOW_MS is 30 days', () => {
    assert(ReportingService.DEFAULT_TRANSFER_WINDOW_MS === 30 * 24 * 60 * 60 * 1000);
  });

  await test('Constructs with no db/rbac/notifications/audit (all optional)', () => {
    const svc = new ReportingService(null);
    assert(svc.rbac instanceof RBACService);
    assert(svc.db === null);
  });

  // ──────────────────────────────────────────────────────────
  section('2 · getReportScope — Aggregation Direction');
  // ──────────────────────────────────────────────────────────

  await test('getReportScope returns self + all descendants (Battalion)', async () => {
    const svc = new ReportingService(null, rbac);
    const scope = await svc.getReportScope(battalionCO);
    assert(scope.ids.length === 6, `Expected 6 units, got ${scope.ids.length}`);
    [100, 101, 102, 103, 104, 105].forEach(id => assert(scope.ids.includes(id), `missing ${id}`));
  });

  await test('getReportScope returns only own branch (Company A)', async () => {
    const svc = new ReportingService(null, rbac);
    const scope = await svc.getReportScope(coyACommander);
    assert(scope.ids.length === 3);
    [101, 103, 104].forEach(id => assert(scope.ids.includes(id), `missing ${id}`));
    assert(!scope.ids.includes(105), 'Company A scope must not include Company B platoon');
  });

  // ──────────────────────────────────────────────────────────
  section('3 · Stock Level Report');
  // ──────────────────────────────────────────────────────────

  await test('No DB → available:false, scopeSize still populated', async () => {
    const svc = new ReportingService(null, rbac);
    const r = await svc.getStockLevelReport(coyACommander);
    assert(r.available === false);
    assert(r.scopeSize === 3);
    assert(Array.isArray(r.lowStockItems) && r.lowStockItems.length === 0);
  });

  await test('Aggregates totals across multiple unit/category rows', async () => {
    const db = makeMockDb([
      { rows: [
        { unit_id: 103, unit_code: 'PL-1-A', unit_name: 'Platoon 1A', category: 'AMMO',    total_quantity: 340, item_count: 2, low_stock_count: 1 },
        { unit_id: 104, unit_code: 'PL-2-A', unit_name: 'Platoon 2A', category: 'RATIONS', total_quantity: 900, item_count: 3, low_stock_count: 0 }
      ]},
      { rows: [
        { id: 8821, item_name: '7.62mm Ball', category: 'AMMO', unit_id: 103, unit_code: 'PL-1-A', quantity: 340, low_stock_threshold: 500 }
      ]}
    ]);
    const svc = new ReportingService(db, rbac);
    const r = await svc.getStockLevelReport(coyACommander);

    assert(r.available === true);
    assert(r.totals.totalQuantity === 1240, `Expected 1240, got ${r.totals.totalQuantity}`);
    assert(r.totals.itemCount === 5);
    assert(r.totals.lowStockCount === 1);
    assert(r.lowStockItems.length === 1 && r.lowStockItems[0].item_name === '7.62mm Ball');
  });

  await test('category filter adds a parameter and is reflected in SQL', async () => {
    const db = makeMockDb([{ rows: [] }, { rows: [] }]);
    const svc = new ReportingService(db, rbac);
    await svc.getStockLevelReport(coyACommander, { category: 'AMMO' });

    const firstCall = db.calls[0];
    assert(firstCall.sql.includes('si.category = $2'), 'SQL should reference category param');
    assert(firstCall.params.length === 2 && firstCall.params[1] === 'AMMO');
  });

  // ──────────────────────────────────────────────────────────
  section('4 · Transfer Activity Report');
  // ──────────────────────────────────────────────────────────

  await test('No DB → available:false with computed period', async () => {
    const svc = new ReportingService(null, rbac);
    const r = await svc.getTransferReport(coyACommander);
    assert(r.available === false);
    assert(r.period.startDate && r.period.endDate);
  });

  await test('Default period spans ~30 days', async () => {
    const svc = new ReportingService(null, rbac);
    const r = await svc.getTransferReport(coyACommander);
    const spanMs = new Date(r.period.endDate) - new Date(r.period.startDate);
    const expected = 30 * 24 * 60 * 60 * 1000;
    assert(Math.abs(spanMs - expected) < 5000, `Span ${spanMs}ms not ~30 days`);
  });

  await test('byStatus totals aggregate count and quantity correctly', async () => {
    const db = makeMockDb([
      { rows: [
        { status: 'PENDING',   count: 3,  total_qty: 150 },
        { status: 'COMPLETED', count: 10, total_qty: 500 }
      ]},
      { rows: [
        { id: 1, item_id: 8821, from_unit_id: 101, to_unit_id: 103, quantity: 50, status: 'PENDING', created_at: '2026-06-01T00:00:00Z' }
      ]}
    ]);
    const svc = new ReportingService(db, rbac);
    const r = await svc.getTransferReport(coyACommander);

    assert(r.byStatus.PENDING.count === 3);
    assert(r.byStatus.COMPLETED.totalQuantity === 500);
    assert(r.totals.totalTransfers === 13);
    assert(r.totals.totalQuantity === 650);
    assert(r.pending.length === 1 && r.pending[0].status === 'PENDING');
  });

  await test('Custom date range is passed through to query params', async () => {
    const db = makeMockDb([{ rows: [] }, { rows: [] }]);
    const svc = new ReportingService(db, rbac);
    const r = await svc.getTransferReport(coyACommander, {
      startDate: '2026-01-01T00:00:00Z', endDate: '2026-02-01T00:00:00Z'
    });
    assert(r.period.startDate === '2026-01-01T00:00:00Z');
    assert(r.period.endDate   === '2026-02-01T00:00:00Z');
    assert(db.calls[0].params[1] === '2026-01-01T00:00:00Z');
    assert(db.calls[0].params[2] === '2026-02-01T00:00:00Z');
  });

  await test('Scope IDs are passed as the unit-filter parameter', async () => {
    const db = makeMockDb([{ rows: [] }, { rows: [] }]);
    const svc = new ReportingService(db, rbac);
    await svc.getTransferReport(coyACommander);
    assert(Array.isArray(db.calls[0].params[0]));
    [101, 103, 104].forEach(id => assert(db.calls[0].params[0].includes(id)));
  });

  // ──────────────────────────────────────────────────────────
  section('5 · Blockchain Health Report');
  // ──────────────────────────────────────────────────────────

  await test('No DB → available:false', async () => {
    const svc = new ReportingService(null, rbac);
    const r = await svc.getBlockchainHealthReport();
    assert(r.available === false);
  });

  await test('Empty chain → chainEmpty:true, latestBlock:null', async () => {
    const db = makeMockDb([{ rows: [{ block_count: 0 }] }, { rows: [] }]);
    const svc = new ReportingService(db, rbac);
    const r = await svc.getBlockchainHealthReport();
    assert(r.available === true);
    assert(r.blockCount === 0);
    assert(r.chainEmpty === true);
    assert(r.latestBlock === null);
  });

  await test('Non-empty chain → chainEmpty:false, latestBlock populated', async () => {
    const db = makeMockDb([
      { rows: [{ block_count: 5 }] },
      { rows: [{ block_index: 5, block_hash: 'a'.repeat(64), transaction_count: 3, created_at: '2026-06-01T00:00:00Z' }] }
    ]);
    const svc = new ReportingService(db, rbac);
    const r = await svc.getBlockchainHealthReport();
    assert(r.blockCount === 5);
    assert(r.chainEmpty === false);
    assert(r.latestBlock.block_index === 5);
  });

  // ──────────────────────────────────────────────────────────
  section('6 · Mesh Network Health (derived from Day 11)');
  // ──────────────────────────────────────────────────────────

  await test('No NotificationService → available:false', async () => {
    const svc = new ReportingService(null, rbac);
    const r = await svc.getMeshHealthReport(coyACommander);
    assert(r.available === false);
  });

  await test('Latest status per peer wins (ONLINE overrides earlier OFFLINE)', async () => {
    const notif = new NotificationService(null, rbac);
    await notif.notifyMeshPeerStatus({ peerId: 'NODE-7', peerName: 'Forward Post', unitId: 103, online: false });
    await notif.notifyMeshPeerStatus({ peerId: 'NODE-7', peerName: 'Forward Post', unitId: 103, online: true });

    const svc = new ReportingService(null, rbac, notif);
    const r = await svc.getMeshHealthReport(coyACommander);

    assert(r.totalPeers === 1);
    assert(r.onlineCount === 1);
    assert(r.offlineCount === 0);
    assert(r.peers[0].peerId === 'NODE-7' && r.peers[0].online === true);
  });

  await test('Scope isolation: Company A commander does not see Company B peers', async () => {
    const notif = new NotificationService(null, rbac);
    await notif.notifyMeshPeerStatus({ peerId: 'NODE-A', peerName: 'A-side', unitId: 103, online: true });  // in scope
    await notif.notifyMeshPeerStatus({ peerId: 'NODE-B', peerName: 'B-side', unitId: 105, online: true });  // out of scope

    const svc = new ReportingService(null, rbac, notif);
    const r = await svc.getMeshHealthReport(coyACommander);

    const peerIds = r.peers.map(p => p.peerId);
    assert(peerIds.includes('NODE-A'), 'should include in-scope peer');
    assert(!peerIds.includes('NODE-B'), 'should NOT include out-of-scope peer');
  });

  await test('Battalion CO sees peers from both companies', async () => {
    const notif = new NotificationService(null, rbac);
    await notif.notifyMeshPeerStatus({ peerId: 'NODE-A', peerName: 'A-side', unitId: 103, online: true });
    await notif.notifyMeshPeerStatus({ peerId: 'NODE-B', peerName: 'B-side', unitId: 105, online: false });

    const svc = new ReportingService(null, rbac, notif);
    const r = await svc.getMeshHealthReport(battalionCO);

    assert(r.totalPeers === 2);
    assert(r.onlineCount === 1 && r.offlineCount === 1);
  });

  // ──────────────────────────────────────────────────────────
  section('7 · Security Posture Report');
  // ──────────────────────────────────────────────────────────

  await test('No DB, no notifications → safe zeroed result', async () => {
    const svc = new ReportingService(null, rbac);
    const r = await svc.getSecurityPostureReport(battalionCO);
    assert(r.auditAvailable === false);
    assert(r.securityEventCount === 0);
    assert(r.pendingAcknowledgments === 0);
  });

  await test('DB rows populate security/critical counts', async () => {
    const db = makeMockDb([
      { rows: [{ severity: 'SECURITY', c: 5 }, { severity: 'CRITICAL', c: 2 }] }
    ]);
    const svc = new ReportingService(db, rbac);
    const r = await svc.getSecurityPostureReport(battalionCO);
    assert(r.auditAvailable === true);
    assert(r.securityEventCount === 5);
    assert(r.criticalEventCount === 2);
  });

  await test('DB error degrades to auditAvailable:false without throwing', async () => {
    const db = makeThrowingDb();
    const svc = new ReportingService(db, rbac);
    const r = await svc.getSecurityPostureReport(battalionCO);
    assert(r.auditAvailable === false);
  });

  await test('pendingAcknowledgments reflects unacknowledged requires-ack notifications', async () => {
    const notif = new NotificationService(null, rbac);
    await notif.create({ type: 'BLOCKCHAIN_TAMPER', title: 'tamper', message: 'm' }); // CRITICAL, requiresAck, Army-wide

    const svc = new ReportingService(null, rbac, notif);
    const r = await svc.getSecurityPostureReport(battalionCO);
    assert(r.pendingAcknowledgments >= 1);
  });

  await test('Acknowledging the alert reduces pendingAcknowledgments', async () => {
    const notif = new NotificationService(null, rbac);
    const n = await notif.create({ type: 'BLOCKCHAIN_TAMPER', title: 'tamper2', message: 'm' });

    const svc = new ReportingService(null, rbac, notif);
    const before = await svc.getSecurityPostureReport(battalionCO);

    notif.acknowledge(n.id, battalionCO.userId);
    const after = await svc.getSecurityPostureReport(battalionCO);

    assert(after.pendingAcknowledgments === before.pendingAcknowledgments - 1);
  });

  await test('Custom hours window is reflected in result', async () => {
    const svc = new ReportingService(null, rbac);
    const r = await svc.getSecurityPostureReport(battalionCO, 6);
    assert(r.windowHours === 6);
  });

  // ──────────────────────────────────────────────────────────
  section('8 · Unit Roster Report');
  // ──────────────────────────────────────────────────────────

  await test('No DB → available:false, scopeSize populated', async () => {
    const svc = new ReportingService(null, rbac);
    const r = await svc.getUnitRosterReport(coyACommander);
    assert(r.available === false);
    assert(r.scopeSize === 3);
  });

  await test('Returns units for scope, scopeSize matches', async () => {
    const db = makeMockDb([
      { rows: [
        { id: 101, unit_name: 'Alpha Company, 11 RR', unit_type: 'COMPANY', unit_code: 'COY-A-11RR', parent_unit_id: 4 },
        { id: 103, unit_name: '1 Platoon, Alpha Company', unit_type: 'PLATOON', unit_code: 'PL-1-A-11RR', parent_unit_id: 101 },
        { id: 104, unit_name: '2 Platoon, Alpha Company', unit_type: 'PLATOON', unit_code: 'PL-2-A-11RR', parent_unit_id: 101 }
      ]}
    ]);
    const svc = new ReportingService(db, rbac);
    const r = await svc.getUnitRosterReport(coyACommander);
    assert(r.available === true);
    assert(r.scopeSize === 3);
    assert(r.units.length === 3);
    assert(db.calls[0].params[0].length === 3);
  });

  // ──────────────────────────────────────────────────────────
  section('9 · Dashboard Summary — Aggregation & Caching');
  // ──────────────────────────────────────────────────────────

  await test('Dashboard aggregates all 6 report sections', async () => {
    const db = makeMockDb([]); // all queries default to { rows: [] }
    const svc = new ReportingService(db, rbac);
    const d = await svc.getDashboardSummary(coyACommander);

    ['stock','transfers','blockchain','mesh','security','roster'].forEach(key =>
      assert(d[key] !== undefined, `Missing dashboard section: ${key}`)
    );
    assert(d.generatedAt);
    assert(d.unitScope === 3, `Expected scope 3, got ${d.unitScope}`);
  });

  await test('Second call within TTL is served from cache (no new DB calls)', async () => {
    const db = makeMockDb([]);
    const svc = new ReportingService(db, rbac);

    await svc.getDashboardSummary(coyACommander);
    const callsAfterFirst = db.calls.length;

    await svc.getDashboardSummary(coyACommander);
    assert(db.calls.length === callsAfterFirst, 'Cache hit should not issue new queries');
    assert(callsAfterFirst === 8, `Expected 8 queries (stock 2 + transfer 2 + blockchain 2 + security 1 + roster 1), got ${callsAfterFirst}`);
  });

  await test('forceRefresh bypasses the cache', async () => {
    const db = makeMockDb([]);
    const svc = new ReportingService(db, rbac);

    await svc.getDashboardSummary(coyACommander);
    const after1 = db.calls.length;

    await svc.getDashboardSummary(coyACommander, { forceRefresh: true });
    assert(db.calls.length === after1 * 2, 'forceRefresh should re-run all queries');
  });

  await test('clearDashboardCache invalidates for a specific user', async () => {
    const db = makeMockDb([]);
    const svc = new ReportingService(db, rbac);

    await svc.getDashboardSummary(coyACommander);
    const after1 = db.calls.length;

    svc.clearDashboardCache(coyACommander.userId);
    await svc.getDashboardSummary(coyACommander);

    assert(db.calls.length === after1 * 2, 'Cleared cache should re-run all queries');
  });

  await test('Different users get independent cache entries', async () => {
    const db = makeMockDb([]);
    const svc = new ReportingService(db, rbac);

    await svc.getDashboardSummary(coyACommander); // 8 calls
    await svc.getDashboardSummary(battalionCO);    // +8 calls (different cache key)

    assert(db.calls.length === 16);
  });

  await test('Per-section failure does not crash the whole dashboard', async () => {
    const db = makeThrowingDb();
    const svc = new ReportingService(db, rbac);
    const d = await svc.getDashboardSummary(coyACommander);

    assert(d.stock.available === false);
    assert(d.transfers.available === false);
    assert(d.blockchain.available === false);
  });

  // ──────────────────────────────────────────────────────────
  section('10 · CSV Export');
  // ──────────────────────────────────────────────────────────

  await test('Empty array → empty string', () => {
    const svc = new ReportingService(null, rbac);
    assert(svc.exportReportToCSV([]) === '');
    assert(svc.exportReportToCSV(null) === '');
  });

  await test('Headers derived from first row keys', () => {
    const svc = new ReportingService(null, rbac);
    const csv = svc.exportReportToCSV([{ unit_code: 'COY-A', total_quantity: 1240 }]);
    const lines = csv.split('\n');
    assert(lines[0] === '"unit_code","total_quantity"');
    assert(lines[1] === '"COY-A","1240"');
  });

  await test('Commas and quotes are escaped per CSV rules', () => {
    const svc = new ReportingService(null, rbac);
    const csv = svc.exportReportToCSV([{ a: 'hello, world', b: 'say "hi"' }]);
    const lines = csv.split('\n');
    assert(lines[1] === '"hello, world","say ""hi"""', lines[1]);
  });

  await test('Null/undefined values render as empty quoted strings', () => {
    const svc = new ReportingService(null, rbac);
    const csv = svc.exportReportToCSV([{ a: null, b: undefined, c: 0 }]);
    const lines = csv.split('\n');
    assert(lines[1] === '"","","0"', lines[1]);
  });

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(58));
  console.log(`📊  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed === 0) {
    console.log('\n📈  ALL TESTS PASSED — Day 12 reporting layer verified!\n');
    console.log('Capabilities delivered:');
    console.log('  🏛️   Command-scope aggregation (descendants), dual of Day 11 escalation');
    console.log('  📦  Stock-level report with low-stock flagging');
    console.log('  🔄  Transfer activity report by status + pending queue');
    console.log('  ⛓️   Blockchain health (block count, latest block)');
    console.log('  📡  Mesh health derived from Day 11 notifications — zero new tables');
    console.log('  🔐  Security posture combining Day 13 audit + Day 11 pending-acks');
    console.log('  🗺️   Unit roster scoped to command');
    console.log('  ⚡  5-minute dashboard cache, per-user, with forceRefresh');
    console.log('  📤  Generic CSV export for any tabular report');
  } else {
    console.log(`\n⚠️   ${failed} test(s) failed:\n`);
    failures.forEach(f => console.log(`  • ${f.label}\n    ${f.error}`));
    process.exitCode = 1;
  }
  console.log('');
}

run().catch(err => {
  console.error('Suite crashed:', err);
  process.exit(1);
});
