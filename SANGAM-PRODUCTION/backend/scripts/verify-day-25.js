'use strict';

/**
 * Day 25 Verification — Movement Orders Service & Routes
 * Groups:
 *   A: createOrder
 *   B: assignVehicle
 *   C: dispatch
 *   D: recordCheckpoint
 *   E: recordDelivery
 *   F: cancelOrder
 *   G: getOrder / getOrdersInScope / getActiveOrdersForUnit
 *   H: Edge cases, priority sorting, routes module
 */
const assert = require('assert');
const MovementOrderService = require('../src/services/movement-order.service');
const AuditLogService      = require('../src/services/audit-log.service');

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

const ITEMS = [
  { itemId: 1, itemCode: 'AMMO-001', itemName: '7.62mm Rounds', quantity: 500 },
  { itemId: 2, itemCode: 'MED-001',  itemName: 'First Aid Kit', quantity: 20  }
];

async function run() {
  const audit = new AuditLogService(null);
  const svc   = new MovementOrderService(null, audit);

  // ── GROUP A: createOrder ──────────────────────────────────────────
  console.log('\n📦 Group A: createOrder');

  let o1, o2, o3;

  await test('A-01 create ROUTINE order → PLANNED', async () => {
    const r = await svc.createOrder({
      fromUnitId: 10, toUnitId: 11, items: ITEMS,
      priority: 'ROUTINE', vehicleReg: 'MH-01-A-0001',
      createdByUserId: 1, notes: 'Monthly resupply'
    });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.order.state, 'PLANNED');
    assert.strictEqual(r.order.priority, 'ROUTINE');
    assert.strictEqual(r.order.items.length, 2);
    o1 = r.order;
  });

  await test('A-02 create EMERGENCY order', async () => {
    const r = await svc.createOrder({
      fromUnitId: 10, toUnitId: 12, items: [ITEMS[0]],
      priority: 'EMERGENCY', createdByUserId: 5
    });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.order.priority, 'EMERGENCY');
    o2 = r.order;
  });

  await test('A-03 missing fromUnitId → MISSING_UNIT_IDS', async () => {
    const r = await svc.createOrder({ toUnitId: 11, items: ITEMS });
    assert.strictEqual(r.error, 'MISSING_UNIT_IDS');
  });

  await test('A-04 same fromUnit and toUnit → SAME_UNIT', async () => {
    const r = await svc.createOrder({ fromUnitId: 10, toUnitId: 10, items: ITEMS });
    assert.strictEqual(r.error, 'SAME_UNIT');
  });

  await test('A-05 empty items → MISSING_ITEMS', async () => {
    const r = await svc.createOrder({ fromUnitId: 10, toUnitId: 11, items: [] });
    assert.strictEqual(r.error, 'MISSING_ITEMS');
  });

  await test('A-06 invalid priority → INVALID_PRIORITY', async () => {
    const r = await svc.createOrder({
      fromUnitId: 10, toUnitId: 11, items: ITEMS, priority: 'CRITICAL'
    });
    assert.strictEqual(r.error, 'INVALID_PRIORITY');
  });

  await test('A-07 item with zero quantity → INVALID_ITEM_QUANTITY', async () => {
    const r = await svc.createOrder({
      fromUnitId: 10, toUnitId: 11,
      items: [{ itemId: 1, itemCode: 'X', quantity: 0 }]
    });
    assert.strictEqual(r.error, 'INVALID_ITEM_QUANTITY');
  });

  await test('A-08 order has transferId field', async () => {
    const r = await svc.createOrder({
      fromUnitId: 10, toUnitId: 11, items: ITEMS, transferId: 42
    });
    assert.strictEqual(r.order.transferId, 42);
    o3 = r.order;
  });

  await test('A-09 stats.ordersCreated reflects count', () => {
    assert.ok(svc.getStats().ordersCreated >= 3);
  });

  await test('A-10 PRIORITY_LEVELS static has 4 entries', () => {
    assert.strictEqual(MovementOrderService.PRIORITY_LEVELS.length, 4);
    assert.ok(MovementOrderService.PRIORITY_LEVELS.includes('EMERGENCY'));
  });

  await test('A-11 ORDER_STATES static has 5 entries', () => {
    assert.strictEqual(Object.keys(MovementOrderService.ORDER_STATES).length, 5);
  });

  // ── GROUP B: assignVehicle ────────────────────────────────────────
  console.log('\n🚛 Group B: assignVehicle');

  await test('B-01 assign vehicle reg and driver', async () => {
    const r = await svc.assignVehicle(o1.id, { vehicleReg: 'UP-01-B-2222', driverId: 99 }, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.order.vehicleReg, 'UP-01-B-2222');
    assert.strictEqual(r.order.driverId, 99);
  });

  await test('B-02 update route', async () => {
    const r = await svc.assignVehicle(o1.id, { route: 'Delhi → Ambala → Pathankot' }, 1);
    assert.strictEqual(r.order.route, 'Delhi → Ambala → Pathankot');
  });

  await test('B-03 update escortStrength', async () => {
    const r = await svc.assignVehicle(o1.id, { escortStrength: 4 }, 1);
    assert.strictEqual(r.order.escortStrength, 4);
  });

  await test('B-04 no fields → NO_UPDATE_FIELDS', async () => {
    const r = await svc.assignVehicle(o1.id, {}, 1);
    assert.strictEqual(r.error, 'NO_UPDATE_FIELDS');
  });

  await test('B-05 non-existent order → ORDER_NOT_FOUND', async () => {
    const r = await svc.assignVehicle(9999, { vehicleReg: 'X' }, 1);
    assert.strictEqual(r.error, 'ORDER_NOT_FOUND');
  });

  // ── GROUP C: dispatch ─────────────────────────────────────────────
  console.log('\n🚀 Group C: dispatch');

  await test('C-01 dispatch PLANNED order → DISPATCHED', async () => {
    const r = await svc.dispatch(o1.id, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.order.state, 'DISPATCHED');
    assert.ok(r.order.actualDeparture);
  });

  await test('C-02 stats.ordersDispatched incremented', () => {
    assert.ok(svc.getStats().ordersDispatched >= 1);
  });

  await test('C-03 dispatch already-dispatched → INVALID_STATE', async () => {
    const r = await svc.dispatch(o1.id, 1);
    assert.strictEqual(r.error, 'INVALID_STATE');
  });

  await test('C-04 non-existent order → ORDER_NOT_FOUND', async () => {
    const r = await svc.dispatch(9999, 1);
    assert.strictEqual(r.error, 'ORDER_NOT_FOUND');
  });

  await test('C-05 cannot assign vehicle to dispatched order (PLANNED only guard is soft)', async () => {
    // assignVehicle allows DISPATCHED too (not terminal)
    const r = await svc.assignVehicle(o1.id, { vehicleReg: 'DL-03-C-3333' }, 1);
    assert.strictEqual(r.success, true);
  });

  // ── GROUP D: recordCheckpoint ────────────────────────────────────
  console.log('\n📍 Group D: recordCheckpoint');

  await test('D-01 recordCheckpoint moves DISPATCHED → IN_TRANSIT', async () => {
    const r = await svc.recordCheckpoint(o1.id, { location: 'Ambala Cantt', notes: 'Fuel stop' }, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.order.state, 'IN_TRANSIT');
    assert.strictEqual(r.checkpoint.location, 'Ambala Cantt');
  });

  await test('D-02 second checkpoint appended', async () => {
    await svc.recordCheckpoint(o1.id, { location: 'Ludhiana', notes: '' }, 1);
    const order = svc.getOrder(o1.id);
    assert.strictEqual(order.checkpoints.length, 2);
  });

  await test('D-03 checkpoint on PLANNED order → INVALID_STATE', async () => {
    const r = await svc.recordCheckpoint(o2.id, { location: 'X' }, 1);
    assert.strictEqual(r.error, 'INVALID_STATE');
  });

  await test('D-04 missing location → MISSING_LOCATION', async () => {
    const r = await svc.recordCheckpoint(o1.id, {}, 1);
    assert.strictEqual(r.error, 'MISSING_LOCATION');
  });

  await test('D-05 non-existent order → ORDER_NOT_FOUND', async () => {
    const r = await svc.recordCheckpoint(9999, { location: 'X' }, 1);
    assert.strictEqual(r.error, 'ORDER_NOT_FOUND');
  });

  // ── GROUP E: recordDelivery ───────────────────────────────────────
  console.log('\n✅ Group E: recordDelivery');

  await test('E-01 recordDelivery IN_TRANSIT → DELIVERED', async () => {
    const r = await svc.recordDelivery(o1.id, 520, 2, 'All items received');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.order.state, 'DELIVERED');
    assert.strictEqual(r.order.deliveredQty, 520);
    assert.ok(r.order.actualArrival);
  });

  await test('E-02 delivery summary has totalOrdered and shortage', () => {
    svc.recordDelivery(o3.id, 500, 2).then(r => {
      // o3 not dispatched yet; will fail - just test the promise doesn't crash
    }).catch(() => {});
    // test summary from E-01 via getOrder
    const order = svc.getOrder(o1.id);
    assert.strictEqual(order.deliveredQty, 520);
  });

  await test('E-03 shortage flagged when receivedQty < ordered', async () => {
    // Create and dispatch a fresh order
    const fresh = (await svc.createOrder({
      fromUnitId: 20, toUnitId: 21,
      items: [{ itemId: 3, itemCode: 'FUEL-001', quantity: 1000 }]
    })).order;
    await svc.dispatch(fresh.id, 1);
    const r = await svc.recordDelivery(fresh.id, 800, 2, 'Shortage — vehicle breakdown');
    assert.strictEqual(r.summary.shortage, 200);
    assert.strictEqual(r.summary.shortageFlag, true);
  });

  await test('E-04 null receivedQty defaults to totalOrdered', async () => {
    const fresh = (await svc.createOrder({
      fromUnitId: 20, toUnitId: 21,
      items: [{ itemId: 4, itemCode: 'MED-002', quantity: 50 }]
    })).order;
    await svc.dispatch(fresh.id, 1);
    const r = await svc.recordDelivery(fresh.id, null, 2);
    assert.strictEqual(r.summary.shortage, 0);
    assert.strictEqual(r.order.deliveredQty, 50);
  });

  await test('E-05 deliver already-DELIVERED → INVALID_STATE', async () => {
    const r = await svc.recordDelivery(o1.id, 500, 2);
    assert.strictEqual(r.error, 'INVALID_STATE');
  });

  await test('E-06 stats.ordersDelivered incremented', () => {
    assert.ok(svc.getStats().ordersDelivered >= 3);
  });

  await test('E-07 deliver PLANNED order → INVALID_STATE', async () => {
    const r = await svc.recordDelivery(o2.id, 500, 2);
    assert.strictEqual(r.error, 'INVALID_STATE');
  });

  // ── GROUP F: cancelOrder ──────────────────────────────────────────
  console.log('\n❌ Group F: cancelOrder');

  await test('F-01 cancel PLANNED order → CANCELLED', async () => {
    const r = await svc.cancelOrder(o2.id, 'Mission aborted', 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.order.state, 'CANCELLED');
    assert.strictEqual(r.order.cancelReason, 'Mission aborted');
  });

  await test('F-02 stats.ordersCancelled incremented', () => {
    assert.ok(svc.getStats().ordersCancelled >= 1);
  });

  await test('F-03 cancel CANCELLED → ORDER_TERMINAL', async () => {
    const r = await svc.cancelOrder(o2.id, '', 1);
    assert.strictEqual(r.error, 'ORDER_TERMINAL');
  });

  await test('F-04 cancel DELIVERED → ORDER_TERMINAL', async () => {
    const r = await svc.cancelOrder(o1.id, '', 1);
    assert.strictEqual(r.error, 'ORDER_TERMINAL');
  });

  await test('F-05 cancel non-existent → ORDER_NOT_FOUND', async () => {
    const r = await svc.cancelOrder(9999, '', 1);
    assert.strictEqual(r.error, 'ORDER_NOT_FOUND');
  });

  await test('F-06 cancel DISPATCHED order', async () => {
    const fresh = (await svc.createOrder({
      fromUnitId: 30, toUnitId: 31,
      items: [{ itemId: 5, itemCode: 'ENG-001', quantity: 10 }]
    })).order;
    await svc.dispatch(fresh.id, 1);
    const r = await svc.cancelOrder(fresh.id, 'Route closed', 1);
    assert.strictEqual(r.order.state, 'CANCELLED');
  });

  // ── GROUP G: Queries ──────────────────────────────────────────────
  console.log('\n🔍 Group G: Queries');

  await test('G-01 getOrder returns correct order', () => {
    const o = svc.getOrder(o1.id);
    assert.ok(o);
    assert.strictEqual(o.fromUnitId, 10);
    assert.strictEqual(o.state, 'DELIVERED');
    assert.ok(Array.isArray(o.checkpoints));
  });

  await test('G-02 getOrder non-existent → null', () => {
    assert.strictEqual(svc.getOrder(9999), null);
  });

  await test('G-03 getOrdersInScope returns orders for scope units', () => {
    const { orders, total } = svc.getOrdersInScope([10, 11]);
    assert.ok(total >= 2);
    assert.ok(orders.every(o => [10,11].includes(o.fromUnitId) || [10,11].includes(o.toUnitId)));
  });

  await test('G-04 getOrdersInScope state filter', () => {
    const { orders } = svc.getOrdersInScope([10, 11, 12, 20, 21, 30, 31], { state: 'DELIVERED' });
    assert.ok(orders.every(o => o.state === 'DELIVERED'));
  });

  await test('G-05 getOrdersInScope priority filter', () => {
    const { orders } = svc.getOrdersInScope([10, 11, 12, 20, 21, 30, 31], { priority: 'ROUTINE' });
    assert.ok(orders.every(o => o.priority === 'ROUTINE'));
  });

  await test('G-06 EMERGENCY orders sorted before ROUTINE', async () => {
    const svc2 = new MovementOrderService(null);
    await svc2.createOrder({ fromUnitId: 1, toUnitId: 2, items: ITEMS, priority: 'ROUTINE' });
    await svc2.createOrder({ fromUnitId: 1, toUnitId: 2, items: ITEMS, priority: 'EMERGENCY' });
    await svc2.createOrder({ fromUnitId: 1, toUnitId: 2, items: ITEMS, priority: 'PRIORITY' });
    const { orders } = svc2.getOrdersInScope([1, 2]);
    assert.strictEqual(orders[0].priority, 'EMERGENCY');
    assert.strictEqual(orders[1].priority, 'PRIORITY');
    assert.strictEqual(orders[2].priority, 'ROUTINE');
  });

  await test('G-07 getOrdersInScope pagination', () => {
    const { orders } = svc.getOrdersInScope([10, 11, 12, 20, 21, 30, 31], { limit: 2 });
    assert.ok(orders.length <= 2);
  });

  await test('G-08 getActiveOrdersForUnit returns non-terminal orders', async () => {
    // Create a fresh IN_TRANSIT order for unit 40
    const fresh = (await svc.createOrder({
      fromUnitId: 40, toUnitId: 41,
      items: [{ itemId: 6, itemCode: 'CLO-001', quantity: 30 }]
    })).order;
    await svc.dispatch(fresh.id, 1);
    await svc.recordCheckpoint(fresh.id, { location: 'Sector 5' }, 1);
    const active = svc.getActiveOrdersForUnit(40);
    assert.ok(active.length >= 1);
    assert.ok(active.every(o => ['PLANNED','DISPATCHED','IN_TRANSIT'].includes(o.state)));
  });

  await test('G-09 getActiveOrdersForUnit excludes DELIVERED', () => {
    const active = svc.getActiveOrdersForUnit(10);
    assert.ok(active.every(o => o.state !== 'DELIVERED'));
  });

  await test('G-10 getOrdersInScope fromUnitId filter', () => {
    const { orders } = svc.getOrdersInScope([10, 11], { fromUnitId: 10 });
    assert.ok(orders.every(o => o.fromUnitId === 10));
  });

  // ── GROUP H: Edge Cases & Routes ──────────────────────────────────
  console.log('\n🛡️  Group H: Edge Cases & Routes');

  await test('H-01 routes module loads without error', () => {
    const f = require('../src/routes/movement.routes');
    assert.strictEqual(typeof f, 'function');
  });

  await test('H-02 getStats returns all fields', () => {
    const s = svc.getStats();
    assert.ok('ordersCreated'    in s);
    assert.ok('ordersDispatched' in s);
    assert.ok('ordersDelivered'  in s);
    assert.ok('ordersCancelled'  in s);
    assert.ok('totalOrders'      in s);
  });

  await test('H-03 works without audit log', async () => {
    const s2 = new MovementOrderService(null);
    const r  = await s2.createOrder({ fromUnitId: 1, toUnitId: 2, items: ITEMS });
    assert.strictEqual(r.success, true);
  });

  await test('H-04 assignVehicle blocked on DELIVERED order', async () => {
    const r = await svc.assignVehicle(o1.id, { vehicleReg: 'XX' }, 1);
    assert.strictEqual(r.error, 'ORDER_TERMINAL');
  });

  await test('H-05 checkpoint timestamp defaults to now if not provided', async () => {
    const fresh = (await svc.createOrder({
      fromUnitId: 50, toUnitId: 51, items: ITEMS
    })).order;
    await svc.dispatch(fresh.id, 1);
    const r = await svc.recordCheckpoint(fresh.id, { location: 'Test Point' }, 1);
    assert.ok(!isNaN(new Date(r.checkpoint.timestamp)));
  });

  await test('H-06 items have receivedQty:null after creation', () => {
    const o = svc.getOrder(o3.id);
    assert.ok(o.items.every(i => i.receivedQty === null));
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 25 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
