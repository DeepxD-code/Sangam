'use strict';

/**
 * Day 26 Verification — Live Command Dashboard Service
 * Groups:
 *   A: getSummary basic shape & caching
 *   B: _unitsSection
 *   C: _personnelSection
 *   D: _supplySection
 *   E: _transfersSection
 *   F: _movementSection
 *   G: _blockchainSection
 *   H: _stocktakeSection
 *   I: _recentActivity
 *   J: Graceful degradation & routes module
 */
const assert = require('assert');

const DashboardService       = require('../src/services/dashboard.service');
const SupplyChainService     = require('../src/services/supply-chain.service');
const UnitManagementService  = require('../src/services/unit-management.service');
const UserManagementService  = require('../src/services/user-management.service');
const InventoryLedgerService = require('../src/services/inventory-ledger.service');
const MovementOrderService   = require('../src/services/movement-order.service');
const AuditLogService        = require('../src/services/audit-log.service');

class StubRBAC { async getCommandScope(u) { return { ids: [u, u + 1], codes: [] }; } }
class StubNotif {
  async notifyLowStock(){}; async notifyTransferPending(){}; async notifyTransferDecision(){}
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise)
      return r.then(() => { console.log(`  ✅ ${name}`); passed++; })
              .catch(e => { console.error(`  ❌ ${name}: ${e.message}`); failed++; });
    console.log(`  ✅ ${name}`); passed++;
  } catch(e) { console.error(`  ❌ ${name}: ${e.message}`); failed++; }
  return Promise.resolve();
}

async function buildEnv() {
  const audit  = new AuditLogService(null);
  const rbac   = new StubRBAC();
  const notif  = new StubNotif();
  const supply = new SupplyChainService(null, rbac, notif, audit);
  const units  = new UnitManagementService(null, audit, rbac);
  const users  = new UserManagementService(null, audit, rbac);
  const inventory = new InventoryLedgerService(null, supply, audit, notif);
  const movement  = new MovementOrderService(null, audit, notif);

  // Seed a unit (id=1), then create personnel/items pointed at unit 1
  const u1 = (await units.createUnit({ unitName: 'A Coy', unitType: 'COMPANY', unitCode: 'A-1' })).unit;

  await users.createUser({ username: 'sep.a', displayName: 'Sep A', role: 'SOLDIER', unitId: u1.id });
  await users.createUser({ username: 'sep.b', displayName: 'Sep B', role: 'NCO',     unitId: u1.id });
  await users.createUser({ username: 'sep.c', displayName: 'Sep C', role: 'SOLDIER', unitId: u1.id });

  const i1 = (await supply.createItem({
    itemCode: 'A-001', itemName: 'Rifle', category: 'EQUIPMENT',
    unitId: u1.id, quantity: 4, lowStockThreshold: 10
  })).item;
  const i2 = (await supply.createItem({
    itemCode: 'A-002', itemName: 'Ammo', category: 'AMMO',
    unitId: u1.id, quantity: 5000, lowStockThreshold: 500
  })).item;

  // Transfer: PENDING + COMPLETED
  const t1 = (await supply.initiateTransfer({
    itemId: i2.id, fromUnitId: u1.id, toUnitId: u1.id + 1, quantity: 100
  })).transfer;
  await supply.approveTransfer(t1.id, 9);

  const t2 = (await supply.initiateTransfer({
    itemId: i2.id, fromUnitId: u1.id, toUnitId: u1.id + 1, quantity: 50
  })).transfer; // left PENDING

  // Movement order
  await movement.createOrder({
    fromUnitId: u1.id, toUnitId: u1.id + 1,
    items: [{ itemId: i2.id, itemCode: 'A-002', quantity: 100 }],
    priority: 'PRIORITY'
  });

  await new Promise(r => setTimeout(r, 30));
  const dashboard = new DashboardService({ supply, units, users, inventory, movement, auditLog: audit });
  return { dashboard, supply, units, users, inventory, movement, audit, u1, i1, i2 };
}

async function run() {
  const { dashboard, supply, units, users, inventory, movement, audit, u1, i1, i2 } = await buildEnv();
  const scope = [u1.id, u1.id + 1];
  const userContext = { userId: 5, unitId: u1.id, role: 'SENIOR_OFFICER' };

  // ── GROUP A: getSummary basic shape & caching ─────────────────────
  console.log('\n📊 Group A: getSummary');

  let summary1;
  await test('A-01 getSummary returns success with all sections', async () => {
    const r = await dashboard.getSummary(userContext, scope);
    assert.strictEqual(r.success, true);
    assert.ok(r.units); assert.ok(r.personnel); assert.ok(r.supply);
    assert.ok(r.transfers); assert.ok(r.movement); assert.ok(r.blockchain);
    assert.ok(r.stocktake); assert.ok(Array.isArray(r.recentActivity));
    summary1 = r;
  });

  await test('A-02 scope.scopeSize matches scope array length', () => {
    assert.strictEqual(summary1.scope.scopeSize, scope.length);
  });

  await test('A-03 first call not cached', () => {
    assert.strictEqual(summary1.cached, false);
  });

  await test('A-04 second call within TTL returns cached=true', async () => {
    const r2 = await dashboard.getSummary(userContext, scope);
    assert.strictEqual(r2.cached, true);
  });

  await test('A-05 forceRefresh bypasses cache', async () => {
    const r3 = await dashboard.getSummary(userContext, scope, { forceRefresh: true });
    assert.strictEqual(r3.cached, false);
  });

  await test('A-06 clearCache(userId) removes only that user', async () => {
    await dashboard.getSummary({ userId: 99, unitId: u1.id }, scope); // separate cache key
    dashboard.clearCache(5);
    const r = await dashboard.getSummary(userContext, scope);
    assert.strictEqual(r.cached, false); // user 5's cache was cleared
    const r2 = await dashboard.getSummary({ userId: 99, unitId: u1.id }, scope);
    assert.strictEqual(r2.cached, true); // user 99's cache untouched
  });

  await test('A-07 clearCache() with no args clears everyone', async () => {
    dashboard.clearCache();
    const r = await dashboard.getSummary(userContext, scope);
    assert.strictEqual(r.cached, false);
  });

  await test('A-08 generatedAt is a valid ISO timestamp', () => {
    assert.ok(!isNaN(new Date(summary1.generatedAt)));
  });

  // ── GROUP B: _unitsSection ─────────────────────────────────────────
  console.log('\n🏗️  Group B: _unitsSection');

  await test('B-01 units section reflects seeded unit', () => {
    assert.strictEqual(summary1.units.available, true);
    assert.strictEqual(summary1.units.total, 1);
    assert.strictEqual(summary1.units.active, 1);
  });

  await test('B-02 units byType breakdown correct', () => {
    assert.strictEqual(summary1.units.byType.COMPANY, 1);
  });

  await test('B-03 units section unavailable when service missing', async () => {
    const d2 = new DashboardService({});
    const r  = await d2._unitsSection(scope);
    assert.strictEqual(r.available, false);
  });

  // ── GROUP C: _personnelSection ────────────────────────────────────
  console.log('\n👥 Group C: _personnelSection');

  await test('C-01 personnel total matches seeded users', () => {
    assert.strictEqual(summary1.personnel.available, true);
    assert.strictEqual(summary1.personnel.total, 3);
  });

  await test('C-02 personnel byRole breakdown correct', () => {
    assert.strictEqual(summary1.personnel.byRole.SOLDIER, 2);
    assert.strictEqual(summary1.personnel.byRole.NCO, 1);
  });

  await test('C-03 personnel section unavailable when service missing', async () => {
    const d2 = new DashboardService({});
    const r  = await d2._personnelSection(scope);
    assert.strictEqual(r.available, false);
  });

  // ── GROUP D: _supplySection ────────────────────────────────────────
  console.log('\n📦 Group D: _supplySection');

  await test('D-01 supply totalItems matches seeded items', () => {
    assert.strictEqual(summary1.supply.available, true);
    assert.strictEqual(summary1.supply.totalItems, 2);
  });

  await test('D-02 low-stock detection works', () => {
    assert.strictEqual(summary1.supply.lowStockCount, 1);
    assert.strictEqual(summary1.supply.lowStockItems[0].itemCode, 'A-001');
  });

  await test('D-03 byCategory breakdown correct', () => {
    assert.strictEqual(summary1.supply.byCategory.EQUIPMENT, 1);
    assert.strictEqual(summary1.supply.byCategory.AMMO, 1);
  });

  await test('D-04 lowStockItems capped at 5', async () => {
    const supply2 = new SupplyChainService(null, new StubRBAC(), new StubNotif());
    for (let i = 0; i < 10; i++) {
      await supply2.createItem({
        itemCode: `LS-${i}`, itemName: `Item ${i}`, category: 'GENERAL',
        unitId: 50, quantity: 1, lowStockThreshold: 100
      });
    }
    const d2 = new DashboardService({ supply: supply2 });
    const r  = await d2._supplySection([50]);
    assert.strictEqual(r.lowStockCount, 10);
    assert.strictEqual(r.lowStockItems.length, 5);
  });

  // ── GROUP E: _transfersSection ────────────────────────────────────
  console.log('\n🔀 Group E: _transfersSection');

  await test('E-01 transfers total reflects seeded transfers', () => {
    assert.strictEqual(summary1.transfers.available, true);
    assert.strictEqual(summary1.transfers.total, 2);
  });

  await test('E-02 pending/completed counts correct', () => {
    assert.strictEqual(summary1.transfers.pending, 1);
    assert.strictEqual(summary1.transfers.completed, 1);
  });

  await test('E-03 approvalRate is a percentage string', () => {
    assert.ok(summary1.transfers.approvalRate.endsWith('%'));
  });

  await test('E-04 no transfers → approvalRate 100%', async () => {
    const supply2 = new SupplyChainService(null, new StubRBAC(), new StubNotif());
    const d2 = new DashboardService({ supply: supply2 });
    const r  = await d2._transfersSection([1]);
    assert.strictEqual(r.approvalRate, '100%');
  });

  // ── GROUP F: _movementSection ─────────────────────────────────────
  console.log('\n🚛 Group F: _movementSection');

  await test('F-01 movement activeOrders reflects seeded order', () => {
    assert.strictEqual(summary1.movement.available, true);
    assert.strictEqual(summary1.movement.activeOrders, 1);
    assert.strictEqual(summary1.movement.planned, 1);
  });

  await test('F-02 emergencyCount excludes non-emergency orders', () => {
    assert.strictEqual(summary1.movement.emergencyCount, 0);
  });

  await test('F-03 movement section unavailable when service missing', async () => {
    const d2 = new DashboardService({});
    const r  = await d2._movementSection(scope);
    assert.strictEqual(r.available, false);
  });

  // ── GROUP G: _blockchainSection ───────────────────────────────────
  console.log('\n⛓️  Group G: _blockchainSection');

  await test('G-01 blockchain reflects verified chain', () => {
    assert.strictEqual(summary1.blockchain.available, true);
    assert.strictEqual(summary1.blockchain.verified, true);
    assert.ok(summary1.blockchain.blockCount >= 1); // 1 approved transfer = 1 block
  });

  await test('G-02 blockchain section unavailable when service missing', async () => {
    const d2 = new DashboardService({});
    const r  = await d2._blockchainSection();
    assert.strictEqual(r.available, false);
  });

  // ── GROUP H: _stocktakeSection ────────────────────────────────────
  console.log('\n📋 Group H: _stocktakeSection');

  await test('H-01 stocktake section with no sessions', () => {
    assert.strictEqual(summary1.stocktake.available, true);
    assert.strictEqual(summary1.stocktake.activeSessions, 0);
  });

  await test('H-02 stocktake reflects active session', async () => {
    await inventory.createSession({ unitId: u1.id });
    const r = await dashboard._stocktakeSection(scope);
    assert.strictEqual(r.activeSessions, 1);
  });

  await test('H-03 stocktake section unavailable when service missing', async () => {
    const d2 = new DashboardService({});
    const r  = await d2._stocktakeSection(scope);
    assert.strictEqual(r.available, false);
  });

  // ── GROUP I: _recentActivity ──────────────────────────────────────
  console.log('\n📜 Group I: _recentActivity');

  await test('I-01 recentActivity returns array of entries', () => {
    assert.ok(Array.isArray(summary1.recentActivity));
    assert.ok(summary1.recentActivity.length > 0);
  });

  await test('I-02 recentActivity entries have required fields', () => {
    const e = summary1.recentActivity[0];
    assert.ok('timestamp' in e); assert.ok('action' in e);
    assert.ok('resource' in e);  assert.ok('severity' in e);
  });

  await test('I-03 recentActivity sorted newest-first', () => {
    const acts = summary1.recentActivity;
    for (let i = 1; i < acts.length; i++) {
      assert.ok(new Date(acts[i].timestamp) <= new Date(acts[i-1].timestamp));
    }
  });

  await test('I-04 recentActivity respects limit param', () => {
    const r = dashboard._recentActivity(scope, 2);
    assert.ok(r.length <= 2);
  });

  await test('I-05 recentActivity returns empty array without audit log', () => {
    const d2 = new DashboardService({});
    assert.deepStrictEqual(d2._recentActivity(scope), []);
  });

  // ── GROUP J: Graceful Degradation & Routes ────────────────────────
  console.log('\n🛡️  Group J: Graceful Degradation & Routes');

  await test('J-01 getSummary works with zero services configured', async () => {
    const d2 = new DashboardService({});
    const r  = await d2.getSummary({ userId: 1, unitId: 1 }, [1]);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.units.available, false);
    assert.strictEqual(r.personnel.available, false);
  });

  await test('J-02 routes module loads without error', () => {
    const f = require('../src/routes/dashboard.routes');
    assert.strictEqual(typeof f, 'function');
  });

  await test('J-03 CACHE_TTL_MS static is 30000', () => {
    assert.strictEqual(DashboardService.CACHE_TTL_MS, 30000);
  });

  await test('J-04 dashboard does not mutate underlying service state', async () => {
    const before = supply.getStats().itemsCreated;
    await dashboard.getSummary(userContext, scope, { forceRefresh: true });
    const after = supply.getStats().itemsCreated;
    assert.strictEqual(before, after);
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 26 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
