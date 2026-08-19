'use strict';

/**
 * Day 30 Verification — Alert Escalation Engine
 * Groups:
 *   A: Low-stock alerts (INFO → CRITICAL based on pct)
 *   B: Stale transfer alerts
 *   C: Blockchain tamper alerts
 *   D: Stocktake overdue alerts
 *   E: Movement delayed + emergency order alerts
 *   F: Alert lifecycle (acknowledge, resolve, suppress)
 *   G: Auto-resolution when violation clears
 *   H: Escalation when alert unacknowledged
 *   I: Edge cases + routes module
 */

const assert = require('assert');
const AlertEscalationService = require('../src/services/alert-escalation.service');
const SupplyChainService     = require('../src/services/supply-chain.service');
const InventoryLedgerService = require('../src/services/inventory-ledger.service');
const MovementOrderService   = require('../src/services/movement-order.service');
const AuditLogService        = require('../src/services/audit-log.service');

class StubRBAC  { async getCommandScope(u) { return { ids:[u,u+1], codes:[] }; } }
class StubNotif {
  constructor() { this.calls = []; }
  async notifyLowStock(p)        { this.calls.push({ m:'notifyLowStock', ...p }); }
  async notifyTransferPending()  {}
  async notifyTransferDecision() {}
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise)
      return r.then(() => { console.log(`  ✅ ${name}`); passed++; })
              .catch(e  => { console.error(`  ❌ ${name}: ${e.message}`); failed++; });
    console.log(`  ✅ ${name}`); passed++;
  } catch(e) { console.error(`  ❌ ${name}: ${e.message}`); failed++; }
  return Promise.resolve();
}

// Build a fully populated test environment
async function buildEnv(opts = {}) {
  const audit  = new AuditLogService(null);
  const notif  = new StubNotif();
  const rbac   = new StubRBAC();
  const supply = new SupplyChainService(null, rbac, notif, audit);
  const inv    = new InventoryLedgerService(null, supply, audit, notif);
  const mov    = new MovementOrderService(null, audit, notif);

  const alertSvc = new AlertEscalationService(
    { supply, inventory: inv, movement: mov, auditLog: audit },
    opts,
    notif
  );

  return { audit, notif, rbac, supply, inv, mov, alertSvc };
}

async function run() {
  // ── GROUP A: Low-Stock Alerts ─────────────────────────────────
  console.log('\n📉 Group A: Low-Stock Alerts');

  await test('A-01 scan raises stock alert when qty < threshold', async () => {
    const { supply, alertSvc } = await buildEnv();
    await supply.createItem({ itemCode:'LO-01', itemName:'Low Item', category:'AMMO', unitId:10, quantity:5, lowStockThreshold:100 });
    const r = await alertSvc.scan([10]);
    assert.ok(r.raised >= 1);
    const alerts = alertSvc.getActiveAlerts([10]);
    // qty=5 is 5% of threshold=100 → triggers CRITICAL_STOCK (< 20%), not LOW_STOCK
    assert.ok(alerts.some(a => a.type === 'LOW_STOCK' || a.type === 'CRITICAL_STOCK'));
  });

  await test('A-02 LOW_STOCK alert has correct meta fields', async () => {
    const { supply, alertSvc } = await buildEnv();
    await supply.createItem({ itemCode:'LO-02', itemName:'Low B', category:'AMMO', unitId:10, quantity:30, lowStockThreshold:100 });
    await alertSvc.scan([10]);
    const a = alertSvc.getActiveAlerts([10]).find(x => x.type === 'LOW_STOCK');
    assert.ok(a.meta.itemId);
    assert.ok(a.meta.quantity === 30);
    assert.ok(a.meta.threshold === 100);
    assert.strictEqual(a.severity, 'WARNING');
  });

  await test('A-03 CRITICAL_STOCK raised when qty < 20% of threshold', async () => {
    const { supply, alertSvc } = await buildEnv({ criticalStockPct: 0.2 });
    await supply.createItem({ itemCode:'CR-01', itemName:'Crit', category:'FUEL', unitId:10, quantity:10, lowStockThreshold:100 });
    await alertSvc.scan([10]);
    const a = alertSvc.getActiveAlerts([10]).find(x => x.type === 'CRITICAL_STOCK');
    assert.ok(a, 'CRITICAL_STOCK alert missing');
    assert.strictEqual(a.severity, 'CRITICAL');
  });

  await test('A-04 no alert when qty >= threshold', async () => {
    const { supply, alertSvc } = await buildEnv();
    await supply.createItem({ itemCode:'OK-01', itemName:'OK', category:'GENERAL', unitId:10, quantity:200, lowStockThreshold:100 });
    await alertSvc.scan([10]);
    const alerts = alertSvc.getActiveAlerts([10]);
    assert.strictEqual(alerts.length, 0);
  });

  await test('A-05 items with no threshold do not trigger alerts', async () => {
    const { supply, alertSvc } = await buildEnv();
    await supply.createItem({ itemCode:'NT-01', itemName:'No Thresh', category:'GENERAL', unitId:10, quantity:1, lowStockThreshold:0 });
    await alertSvc.scan([10]);
    assert.strictEqual(alertSvc.getActiveAlerts([10]).length, 0);
  });

  await test('A-06 scan dedups: second scan for same item does not raise new alert', async () => {
    const { supply, alertSvc } = await buildEnv();
    await supply.createItem({ itemCode:'DD-01', itemName:'Dedup', category:'AMMO', unitId:10, quantity:5, lowStockThreshold:100 });
    await alertSvc.scan([10]);
    const after1 = alertSvc.getStats().alertsRaised;
    await alertSvc.scan([10]);
    const after2 = alertSvc.getStats().alertsRaised;
    assert.strictEqual(after1, after2, 'Duplicate alert raised on second scan');
  });

  await test('A-07 LOW_STOCK triggers notifyLowStock notification', async () => {
    const { supply, alertSvc, notif } = await buildEnv();
    // qty=30 is 30% of threshold=100 → LOW_STOCK (> 20% so not CRITICAL_STOCK)
    await supply.createItem({ itemCode:'NF-01', itemName:'Notif', category:'AMMO', unitId:10, quantity:30, lowStockThreshold:100 });
    await alertSvc.scan([10]);
    await new Promise(r => setTimeout(r, 20));
    assert.ok(notif.calls.some(c => c.m === 'notifyLowStock'), 'notifyLowStock not called');
  });

  // ── GROUP B: Stale Transfer Alerts ────────────────────────────
  console.log('\n🔄 Group B: Stale Transfer Alerts');

  await test('B-01 stale PENDING transfer raises STALE_TRANSFER alert', async () => {
    const { supply, alertSvc } = await buildEnv({ staleTransferMins: 0 }); // 0 = everything is stale
    await supply.createItem({ itemCode:'TR-01', itemName:'Item', category:'AMMO', unitId:10, quantity:100 });
    const items = supply.getItemsInScope([10]).items;
    await supply.initiateTransfer({ itemId: items[0].id, fromUnitId:10, toUnitId:11, quantity:10 });
    await alertSvc.scan([10,11]);
    const alerts = alertSvc.getActiveAlerts([10,11]);
    assert.ok(alerts.some(a => a.type === 'STALE_TRANSFER'), 'STALE_TRANSFER alert missing');
  });

  await test('B-02 fresh transfer does not alert', async () => {
    const { supply, alertSvc } = await buildEnv({ staleTransferMins: 60 }); // 60 min threshold
    await supply.createItem({ itemCode:'FR-01', itemName:'Fresh', category:'AMMO', unitId:10, quantity:100 });
    const items = supply.getItemsInScope([10]).items;
    await supply.initiateTransfer({ itemId: items[0].id, fromUnitId:10, toUnitId:11, quantity:10 });
    await alertSvc.scan([10,11]);
    assert.strictEqual(alertSvc.getActiveAlerts([10,11]).filter(a => a.type === 'STALE_TRANSFER').length, 0);
  });

  await test('B-03 STALE_TRANSFER alert includes transfer meta', async () => {
    const { supply, alertSvc } = await buildEnv({ staleTransferMins: 0 });
    await supply.createItem({ itemCode:'MT-01', itemName:'Meta', category:'AMMO', unitId:10, quantity:100 });
    const items = supply.getItemsInScope([10]).items;
    const t = (await supply.initiateTransfer({ itemId: items[0].id, fromUnitId:10, toUnitId:11, quantity:10 })).transfer;
    await alertSvc.scan([10,11]);
    const a = alertSvc.getActiveAlerts([10,11]).find(x => x.type === 'STALE_TRANSFER');
    assert.strictEqual(a.meta.transferId, t.id);
    assert.ok('ageMins' in a.meta);
  });

  // ── GROUP C: Blockchain Tamper ────────────────────────────────
  console.log('\n⛓️  Group C: Blockchain Tamper Alerts');

  await test('C-01 clean chain produces no BLOCKCHAIN_TAMPER alert', async () => {
    const { supply, alertSvc } = await buildEnv();
    await supply.createItem({ itemCode:'BC-01', itemName:'BC Item', category:'AMMO', unitId:10, quantity:100 });
    const items = supply.getItemsInScope([10]).items;
    const t = (await supply.initiateTransfer({ itemId:items[0].id, fromUnitId:10, toUnitId:11, quantity:10 })).transfer;
    await supply.approveTransfer(t.id, 5);
    await alertSvc.scan([10,11]);
    assert.strictEqual(alertSvc.getActiveAlerts([10,11]).filter(a => a.type === 'BLOCKCHAIN_TAMPER').length, 0);
  });

  await test('C-02 tampered block raises CRITICAL BLOCKCHAIN_TAMPER alert', async () => {
    const { supply, alertSvc } = await buildEnv();
    await supply.createItem({ itemCode:'TM-01', itemName:'Tamper', category:'AMMO', unitId:10, quantity:100 });
    const items = supply.getItemsInScope([10]).items;
    // Need 2 blocks: block[1].previousHash references block[0].blockHash
    // Tamper block[0] → block[1].previousHash mismatch → verifyChain detects it
    const t1 = (await supply.initiateTransfer({ itemId:items[0].id, fromUnitId:10, toUnitId:11, quantity:10 })).transfer;
    await supply.approveTransfer(t1.id, 5);
    const t2 = (await supply.initiateTransfer({ itemId:items[0].id, fromUnitId:10, toUnitId:11, quantity:10 })).transfer;
    await supply.approveTransfer(t2.id, 5);

    assert.ok(supply._blocks.size >= 2, `Need 2+ blocks, got ${supply._blocks.size}`);
    const blocks = [...supply._blocks.values()].sort((a,b) => a.blockIndex - b.blockIndex);
    blocks[0].blockHash = 'deadbeef'.repeat(8); // tamper first block hash

    await alertSvc.scan([10,11]);
    const a = alertSvc.getActiveAlerts([10,11]).find(x => x.type === 'BLOCKCHAIN_TAMPER');
    assert.ok(a, 'BLOCKCHAIN_TAMPER alert not raised');
    assert.strictEqual(a.severity, 'CRITICAL');
  });

  // ── GROUP D: Stocktake Overdue ────────────────────────────────
  console.log('\n📋 Group D: Stocktake Overdue Alerts');

  await test('D-01 overdue PENDING_APPROVAL session raises alert', async () => {
    const { supply, inv, alertSvc } = await buildEnv({ stocktakeOverdueMins: 0 });
    await supply.createItem({ itemCode:'ST-01', itemName:'ST Item', category:'GENERAL', unitId:10, quantity:50 });
    const sess = (await inv.createSession({ unitId:10 })).session;
    const items = supply.getItemsInScope([10]).items;
    await inv.recordCount(sess.id, items[0].id, 50, 1);
    await inv.finalizeSession(sess.id, 1);
    await alertSvc.scan([10,11]);
    assert.ok(alertSvc.getActiveAlerts([10,11]).some(a => a.type === 'STOCKTAKE_OVERDUE'));
  });

  await test('D-02 fresh PENDING_APPROVAL session does not alert', async () => {
    const { supply, inv, alertSvc } = await buildEnv({ stocktakeOverdueMins: 60 });
    await supply.createItem({ itemCode:'FS-01', itemName:'Fresh ST', category:'GENERAL', unitId:10, quantity:50 });
    const sess = (await inv.createSession({ unitId:10 })).session;
    const items = supply.getItemsInScope([10]).items;
    await inv.recordCount(sess.id, items[0].id, 50, 1);
    await inv.finalizeSession(sess.id, 1);
    await alertSvc.scan([10,11]);
    assert.strictEqual(alertSvc.getActiveAlerts([10,11]).filter(a => a.type === 'STOCKTAKE_OVERDUE').length, 0);
  });

  // ── GROUP E: Movement Alerts ──────────────────────────────────
  console.log('\n🚛 Group E: Movement Delayed + Emergency Alerts');

  await test('E-01 EMERGENCY order raises EMERGENCY_ORDER alert immediately', async () => {
    const { mov, alertSvc } = await buildEnv();
    await mov.createOrder({ fromUnitId:10, toUnitId:11, priority:'EMERGENCY', items:[{ itemId:1, itemCode:'X', quantity:10 }] });
    await alertSvc.scan([10,11]);
    const a = alertSvc.getActiveAlerts([10,11]).find(x => x.type === 'EMERGENCY_ORDER');
    assert.ok(a, 'EMERGENCY_ORDER alert missing');
    assert.strictEqual(a.severity, 'CRITICAL');
  });

  await test('E-02 ROUTINE order does not raise EMERGENCY alert', async () => {
    const { mov, alertSvc } = await buildEnv();
    await mov.createOrder({ fromUnitId:10, toUnitId:11, priority:'ROUTINE', items:[{ itemId:2, itemCode:'Y', quantity:5 }] });
    await alertSvc.scan([10,11]);
    assert.strictEqual(alertSvc.getActiveAlerts([10,11]).filter(a => a.type === 'EMERGENCY_ORDER').length, 0);
  });

  await test('E-03 delayed DISPATCHED order raises MOVEMENT_DELAYED alert', async () => {
    const { mov, alertSvc } = await buildEnv({ movementDelayedMins: 0 });
    const o = (await mov.createOrder({ fromUnitId:10, toUnitId:11, priority:'ROUTINE', items:[{ itemId:3, itemCode:'Z', quantity:5 }] })).order;
    await mov.dispatch(o.id, 1);
    await alertSvc.scan([10,11]);
    assert.ok(alertSvc.getActiveAlerts([10,11]).some(a => a.type === 'MOVEMENT_DELAYED'));
  });

  await test('E-04 DELIVERED order does not alert for delay', async () => {
    const { mov, alertSvc } = await buildEnv({ movementDelayedMins: 0 });
    const o = (await mov.createOrder({ fromUnitId:10, toUnitId:11, priority:'ROUTINE', items:[{ itemId:4, itemCode:'W', quantity:5 }] })).order;
    await mov.dispatch(o.id, 1);
    await mov.recordDelivery(o.id, 5, 1);
    await alertSvc.scan([10,11]);
    assert.strictEqual(alertSvc.getActiveAlerts([10,11]).filter(a => a.type === 'MOVEMENT_DELAYED').length, 0);
  });

  // ── GROUP F: Alert Lifecycle ──────────────────────────────────
  console.log('\n🔁 Group F: Alert Lifecycle');

  const { supply: supF, alertSvc: aF } = await buildEnv();
  await supF.createItem({ itemCode:'LF-01', itemName:'Lifecycle', category:'AMMO', unitId:10, quantity:5, lowStockThreshold:100 });
  await aF.scan([10]);
  const activeF = aF.getActiveAlerts([10]);
  const alertF  = activeF[0];

  await test('F-01 acknowledge sets acknowledgedAt and acknowledgedBy', () => {
    const r = aF.acknowledge(alertF.id, 99);
    assert.strictEqual(r.success, true);
    assert.ok(r.alert.acknowledgedAt);
    assert.strictEqual(r.alert.acknowledgedBy, 99);
  });

  await test('F-02 acknowledge non-existent → ALERT_NOT_FOUND', () => {
    const r = aF.acknowledge(9999, 1);
    assert.strictEqual(r.error, 'ALERT_NOT_FOUND');
  });

  await test('F-03 resolve sets status=RESOLVED + meta', () => {
    const r = aF.resolve(alertF.id, 42, 'Restocked');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.alert.status, 'RESOLVED');
    assert.strictEqual(r.alert.resolution, 'Restocked');
    assert.strictEqual(r.alert.resolvedBy, 42);
    assert.ok(r.alert.resolvedAt);
  });

  await test('F-04 resolve already-resolved → ALREADY_RESOLVED', () => {
    const r = aF.resolve(alertF.id, 42);
    assert.strictEqual(r.error, 'ALREADY_RESOLVED');
  });

  await test('F-05 suppress sets status=SUPPRESSED', async () => {
    const { supply: supS, alertSvc: aS } = await buildEnv();
    await supS.createItem({ itemCode:'SP-01', itemName:'Suppress', category:'AMMO', unitId:10, quantity:5, lowStockThreshold:100 });
    await aS.scan([10]);
    const a = aS.getActiveAlerts([10])[0];
    const r = aS.suppress(a.id, 55, 'Known issue');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.alert.status, 'SUPPRESSED');
    assert.strictEqual(r.alert.suppression, 'Known issue');
  });

  await test('F-06 getAlert returns single alert by id', () => {
    const a = aF.getAlert(alertF.id);
    assert.ok(a);
    assert.strictEqual(a.id, alertF.id);
  });

  await test('F-07 getAlert non-existent returns null', () => {
    assert.strictEqual(aF.getAlert(9999), null);
  });

  // ── GROUP G: Auto-Resolution ──────────────────────────────────
  console.log('\n✅ Group G: Auto-Resolution');

  await test('G-01 alert auto-resolves when violation clears', async () => {
    const { supply: supG, alertSvc: aG } = await buildEnv();
    const item = (await supG.createItem({ itemCode:'AR-01', itemName:'AutoResolve', category:'AMMO', unitId:10, quantity:5, lowStockThreshold:100 })).item;
    await aG.scan([10]);
    // qty=5 → 5% of threshold → CRITICAL_STOCK alert raised
    assert.ok(aG.getActiveAlerts([10]).some(a => a.type === 'LOW_STOCK' || a.type === 'CRITICAL_STOCK'));

    // Fix the violation: raise quantity above threshold
    await supG.updateItem(item.id, { quantity: 200 });
    await aG.scan([10]);

    const active = aG.getActiveAlerts([10]).filter(a => a.key === `stock:${item.id}`);
    assert.strictEqual(active.length, 0, 'Alert should be auto-resolved after violation cleared');
  });

  // ── GROUP H: Escalation ────────────────────────────────────────
  console.log('\n🔺 Group H: Escalation');

  await test('H-01 OPEN alert escalated when escalationMins=0', async () => {
    const { supply: supH, alertSvc: aH } = await buildEnv({ escalationMins: 0 });
    await supH.createItem({ itemCode:'ES-01', itemName:'Escalate', category:'AMMO', unitId:10, quantity:5, lowStockThreshold:100 });
    // With escalationMins=0, the alert is raised AND escalated in scan 1
    // (age=0ms >= threshold=0ms). Scan 2 won't escalate again (already ESCALATED).
    const r1 = await aH.scan([10]);
    // Either escalation happened in scan 1 (most likely) or scan 2
    await aH.scan([10]);
    const totalEscalated = aH.getStats().alertsEscalated;
    assert.ok(totalEscalated >= 1, `Expected >=1 escalated total, got ${totalEscalated}`);
    assert.ok(r1.escalated >= 1 || aH.getAllAlerts({ status:'ESCALATED' }).length >= 1,
      'No escalated alerts found');
  });

  await test('H-02 escalated alert has escalatedAt timestamp', async () => {
    const { supply: supH2, alertSvc: aH2 } = await buildEnv({ escalationMins: 0 });
    await supH2.createItem({ itemCode:'ES-02', itemName:'Esc2', category:'AMMO', unitId:10, quantity:5, lowStockThreshold:100 });
    await aH2.scan([10]);
    await aH2.scan([10]);
    const a = aH2.getAllAlerts({ status:'ESCALATED' })[0];
    assert.ok(a.escalatedAt, 'escalatedAt missing');
  });

  await test('H-03 stats.alertsEscalated incremented', async () => {
    const { supply: supH3, alertSvc: aH3 } = await buildEnv({ escalationMins: 0 });
    await supH3.createItem({ itemCode:'ES-03', itemName:'Esc3', category:'AMMO', unitId:10, quantity:5, lowStockThreshold:100 });
    await aH3.scan([10]);
    await aH3.scan([10]);
    assert.ok(aH3.getStats().alertsEscalated >= 1);
  });

  // ── GROUP I: Edge Cases + Routes ─────────────────────────────
  console.log('\n🛡️  Group I: Edge Cases & Routes');

  await test('I-01 scan with no services returns empty result', async () => {
    const a = new AlertEscalationService({}, {});
    const r = await a.scan([10]);
    assert.strictEqual(r.raised, 0);
    assert.strictEqual(r.active, 0);
  });

  await test('I-02 getAllAlerts type filter works', async () => {
    const { supply: supI, alertSvc: aI } = await buildEnv({ staleTransferMins:0 });
    await supI.createItem({ itemCode:'TF-01', itemName:'TF', category:'AMMO', unitId:10, quantity:5, lowStockThreshold:100 });
    const items = supI.getItemsInScope([10]).items;
    await supI.initiateTransfer({ itemId:items[0].id, fromUnitId:10, toUnitId:11, quantity:1 });
    await aI.scan([10,11]);
    const stockAlerts    = aI.getAllAlerts({ type:'LOW_STOCK' });
    const transferAlerts = aI.getAllAlerts({ type:'STALE_TRANSFER' });
    assert.ok(stockAlerts.every(a => a.type === 'LOW_STOCK'));
    assert.ok(transferAlerts.every(a => a.type === 'STALE_TRANSFER'));
  });

  await test('I-03 getActiveAlerts scoped to specified unitIds', async () => {
    const { supply: supI2, alertSvc: aI2 } = await buildEnv();
    await supI2.createItem({ itemCode:'SC-01', itemName:'Scope1', category:'AMMO', unitId:20, quantity:1, lowStockThreshold:100 });
    await supI2.createItem({ itemCode:'SC-02', itemName:'Scope2', category:'AMMO', unitId:30, quantity:1, lowStockThreshold:100 });
    await aI2.scan([20,30]);
    const forUnit20 = aI2.getActiveAlerts([20]);
    const forUnit30 = aI2.getActiveAlerts([30]);
    assert.ok(forUnit20.every(a => a.unitId === 20));
    assert.ok(forUnit30.every(a => a.unitId === 30));
  });

  await test('I-04 ALERT_TYPES static has 7 types', () => {
    assert.strictEqual(Object.keys(AlertEscalationService.ALERT_TYPES).length, 7);
  });

  await test('I-05 STATUS static has 4 statuses', () => {
    assert.strictEqual(Object.keys(AlertEscalationService.STATUS).length, 4);
  });

  await test('I-06 getStats returns all counter fields', () => {
    const a = new AlertEscalationService({});
    const s = a.getStats();
    for (const f of ['alertsRaised','alertsEscalated','alertsResolved','alertsSuppressed','totalAlerts','activeAlerts']) {
      assert.ok(f in s, `missing ${f}`);
    }
  });

  await test('I-07 routes module loads without error', () => {
    const f = require('../src/routes/alert.routes');
    assert.strictEqual(typeof f, 'function');
  });

  await test('I-08 scan result includes raised/resolved/escalated/active', async () => {
    const a = new AlertEscalationService({});
    const r = await a.scan([10]);
    assert.ok('raised'    in r);
    assert.ok('resolved'  in r);
    assert.ok('escalated' in r);
    assert.ok('active'    in r);
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 30 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
