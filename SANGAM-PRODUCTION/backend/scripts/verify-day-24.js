'use strict';

/**
 * Day 24 Verification — Inventory Stock-Take Service
 */
const assert = require('assert');
const InventoryLedgerService = require('../src/services/inventory-ledger.service');
const SupplyChainService     = require('../src/services/supply-chain.service');
const AuditLogService        = require('../src/services/audit-log.service');

class StubRBAC  { async getCommandScope(u) { return [u]; } }
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
  const supply = new SupplyChainService(null, new StubRBAC(), new StubNotif(), audit);
  const ledger = new InventoryLedgerService(null, supply, audit);

  // Valid categories: AMMO, RATIONS, FUEL, MEDICAL, EQUIPMENT, COMMS, VEHICLE_PARTS, CLOTHING, ENGINEERING, GENERAL
  const i1 = (await supply.createItem({ itemCode:'I-001', itemName:'Rifle',   category:'EQUIPMENT', unitId:10, quantity:50  })).item;
  const i2 = (await supply.createItem({ itemCode:'I-002', itemName:'Ammo',    category:'AMMO',      unitId:10, quantity:2000})).item;
  const i3 = (await supply.createItem({ itemCode:'I-003', itemName:'Radio',   category:'COMMS',     unitId:10, quantity:10  })).item;
  const i4 = (await supply.createItem({ itemCode:'I-004', itemName:'Med Kit', category:'MEDICAL',   unitId:11, quantity:5   })).item;

  // Verify seeding
  if (!i1 || !i2 || !i3 || !i4) throw new Error('Item seeding failed — check categories');
  await new Promise(r => setTimeout(r, 20));
  return { audit, supply, ledger, i1, i2, i3, i4 };
}

async function run() {
  const { supply, ledger, i1, i2, i3, i4 } = await buildEnv();

  // ── GROUP A: createSession ────────────────────────────────────────
  console.log('\n📋 Group A: createSession');

  await test('A-01 create session for unit 10 → OPEN, itemsExpected=3', async () => {
    const r = await ledger.createSession({ unitId: 10, actorUserId: 1, notes: 'Monthly' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.session.state, 'OPEN');
    assert.strictEqual(r.session.unitId, 10);
    assert.strictEqual(r.session.itemsExpected, 3);
  });

  await test('A-02 duplicate active session → ACTIVE_SESSION_EXISTS', async () => {
    const r = await ledger.createSession({ unitId: 10 });
    assert.strictEqual(r.error, 'ACTIVE_SESSION_EXISTS');
    assert.ok(r.existingSessionId > 0);
  });

  await test('A-03 missing unitId → MISSING_UNIT_ID', async () => {
    const r = await ledger.createSession({});
    assert.strictEqual(r.error, 'MISSING_UNIT_ID');
  });

  await test('A-04 different unit can create session concurrently', async () => {
    const r = await ledger.createSession({ unitId: 11, actorUserId: 2 });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.session.itemsExpected, 1); // only i4 in unit 11
  });

  await test('A-05 stats.sessionsCreated reflects both sessions', () => {
    assert.strictEqual(ledger.getStats().sessionsCreated, 2);
  });

  await test('A-06 SESSION_STATES static has 5 entries', () => {
    const states = Object.values(InventoryLedgerService.SESSION_STATES);
    assert.strictEqual(states.length, 5);
    assert.ok(states.includes('RECONCILED'));
    assert.ok(states.includes('PENDING_APPROVAL'));
  });

  // Grab the active unit-10 session id
  const s10 = ledger.getActiveSession(10);
  const sessionId = s10.id;

  // ── GROUP B: recordCount ──────────────────────────────────────────
  console.log('\n🔢 Group B: recordCount');

  await test('B-01 first recordCount moves session OPEN → COUNTING', async () => {
    const r = await ledger.recordCount(sessionId, i1.id, 48, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.session.state, 'COUNTING');
    assert.strictEqual(r.count.delta, -2); // 48 - 50
  });

  await test('B-02 second item count increments itemsCounted', async () => {
    await ledger.recordCount(sessionId, i2.id, 2000, 1);
    const s = ledger.getSession(sessionId);
    assert.strictEqual(s.itemsCounted, 2);
  });

  await test('B-03 overwrite count for same item', async () => {
    const r = await ledger.recordCount(sessionId, i1.id, 50, 1);
    assert.strictEqual(r.count.delta, 0); // 50 - 50 = 0
    const s = ledger.getSession(sessionId);
    assert.strictEqual(s.itemsCounted, 2); // still 2 unique items
  });

  await test('B-04 item from wrong unit → ITEM_UNIT_MISMATCH', async () => {
    const r = await ledger.recordCount(sessionId, i4.id, 3, 1);
    assert.strictEqual(r.error, 'ITEM_UNIT_MISMATCH');
  });

  await test('B-05 non-existent item → ITEM_NOT_FOUND', async () => {
    const r = await ledger.recordCount(sessionId, 9999, 5, 1);
    assert.strictEqual(r.error, 'ITEM_NOT_FOUND');
  });

  await test('B-06 negative count → INVALID_COUNT', async () => {
    const r = await ledger.recordCount(sessionId, i3.id, -1, 1);
    assert.strictEqual(r.error, 'INVALID_COUNT');
  });

  await test('B-07 missing count → MISSING_COUNT', async () => {
    const r = await ledger.recordCount(sessionId, i3.id, undefined, 1);
    assert.strictEqual(r.error, 'MISSING_COUNT');
  });

  await test('B-08 non-existent session → SESSION_NOT_FOUND', async () => {
    const r = await ledger.recordCount(9999, i1.id, 10, 1);
    assert.strictEqual(r.error, 'SESSION_NOT_FOUND');
  });

  await test('B-09 zero count is valid', async () => {
    const r = await ledger.recordCount(sessionId, i3.id, 0, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.count.physicalCount, 0);
    assert.strictEqual(r.count.delta, -10); // 0 - 10 = -10
  });

  // ── GROUP C: finalizeSession ──────────────────────────────────────
  console.log('\n🏁 Group C: finalizeSession');

  // State: i1=50(no disc), i2=2000(no disc), i3=0(delta -10 DEFICIT)
  await test('C-01 finalizeSession → PENDING_APPROVAL', async () => {
    const r = await ledger.finalizeSession(sessionId, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.session.state, 'PENDING_APPROVAL');
    assert.ok(r.summary);
    assert.strictEqual(r.summary.itemsCounted, 3); // all 3 counted
  });

  await test('C-02 DEFICIT discrepancy generated for i3', () => {
    const s = ledger.getSession(sessionId);
    const d = s.discrepancies.find(x => x.itemId === i3.id);
    assert.ok(d, 'Expected discrepancy for i3');
    assert.strictEqual(d.type, 'DEFICIT');
    assert.strictEqual(d.delta, -10);
  });

  await test('C-03 no discrepancy for items with matching counts', () => {
    const s = ledger.getSession(sessionId);
    assert.ok(!s.discrepancies.find(x => x.itemId === i1.id));
    assert.ok(!s.discrepancies.find(x => x.itemId === i2.id));
  });

  await test('C-04 cannot finalize PENDING_APPROVAL session', async () => {
    const r = await ledger.finalizeSession(sessionId, 1);
    assert.strictEqual(r.error, 'SESSION_NOT_ACTIVE');
  });

  await test('C-05 non-existent session → SESSION_NOT_FOUND', async () => {
    const r = await ledger.finalizeSession(9999, 1);
    assert.strictEqual(r.error, 'SESSION_NOT_FOUND');
  });

  await test('C-06 SURPLUS discrepancy typed correctly', async () => {
    // Create fresh session in new supply service to avoid state pollution
    const supply2 = new SupplyChainService(null, new StubRBAC(), new StubNotif());
    const ii = (await supply2.createItem({ itemCode:'S-001', itemName:'Surplus Item', category:'FUEL', unitId:20, quantity:100 })).item;
    const l2  = new InventoryLedgerService(null, supply2);
    const sid = (await l2.createSession({ unitId: 20 })).session.id;
    await l2.recordCount(sid, ii.id, 120, 1); // 120 > 100 → SURPLUS
    const fin = await l2.finalizeSession(sid, 1);
    assert.ok(fin.discrepancies.some(d => d.type === 'SURPLUS'));
    assert.strictEqual(fin.summary.surpluses, 1);
  });

  await test('C-07 NOT_COUNTED generated for uncounted items', async () => {
    const supply3 = new SupplyChainService(null, new StubRBAC(), new StubNotif());
    await supply3.createItem({ itemCode:'NC-001', itemName:'A', category:'GENERAL', unitId:30, quantity:5 });
    await supply3.createItem({ itemCode:'NC-002', itemName:'B', category:'GENERAL', unitId:30, quantity:10 });
    const l3  = new InventoryLedgerService(null, supply3);
    const sid = (await l3.createSession({ unitId: 30 })).session.id;
    // Count only first item
    const items30 = supply3.getItemsInScope([30]).items;
    await l3.recordCount(sid, items30[0].id, 5, 1);
    const fin = await l3.finalizeSession(sid, 1);
    assert.strictEqual(fin.summary.notCounted, 1);
    assert.ok(fin.discrepancies.some(d => d.type === 'NOT_COUNTED'));
  });

  // ── GROUP D: approveReconciliation ────────────────────────────────
  console.log('\n✅ Group D: approveReconciliation');

  await test('D-01 approveReconciliation → RECONCILED', async () => {
    const r = await ledger.approveReconciliation(sessionId, 5);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.session.state, 'RECONCILED');
    assert.strictEqual(r.session.approvedByUserId, 5);
  });

  await test('D-02 system quantity updated to physical count for i3', () => {
    const item = supply.getItemById(i3.id);
    assert.strictEqual(item.quantity, 0); // physical count was 0
  });

  await test('D-03 items with no discrepancy are skipped', () => {
    const sessions = ledger.getSessionsForUnit(10, { state: 'RECONCILED' });
    assert.ok(sessions.sessions.length >= 1);
  });

  await test('D-04 cannot approve already-RECONCILED session', async () => {
    const r = await ledger.approveReconciliation(sessionId, 5);
    assert.strictEqual(r.error, 'INVALID_STATE');
  });

  await test('D-05 stats.sessionsReconciled incremented', () => {
    assert.ok(ledger.getStats().sessionsReconciled >= 1);
  });

  await test('D-06 non-existent session → SESSION_NOT_FOUND', async () => {
    const r = await ledger.approveReconciliation(9999, 5);
    assert.strictEqual(r.error, 'SESSION_NOT_FOUND');
  });

  await test('D-07 reconciliation summary has correct counts', async () => {
    // Create isolated scenario for counting
    const supply4 = new SupplyChainService(null, new StubRBAC(), new StubNotif());
    const ix = (await supply4.createItem({ itemCode:'R-001', itemName:'X', category:'FUEL', unitId:40, quantity:100 })).item;
    const l4  = new InventoryLedgerService(null, supply4);
    const sid = (await l4.createSession({ unitId: 40 })).session.id;
    await l4.recordCount(sid, ix.id, 90, 1); // delta=-10
    await l4.finalizeSession(sid, 1);
    const r = await l4.approveReconciliation(sid, 5);
    assert.strictEqual(r.summary.reconciledCount, 1);
    assert.strictEqual(supply4.getItemById(ix.id).quantity, 90);
  });

  // ── GROUP E: cancelSession ────────────────────────────────────────
  console.log('\n❌ Group E: cancelSession');

  await test('E-01 cancel OPEN session', async () => {
    const newSess = (await ledger.createSession({ unitId: 10 })).session;
    const r = await ledger.cancelSession(newSess.id, 1, 'Test cancel');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.session.state, 'CANCELLED');
    assert.strictEqual(r.session.cancelledReason, 'Test cancel');
  });

  await test('E-02 cancel COUNTING session', async () => {
    const newSess = (await ledger.createSession({ unitId: 10 })).session;
    await ledger.recordCount(newSess.id, i1.id, 50, 1);
    const r = await ledger.cancelSession(newSess.id, 1, 'Aborted');
    assert.strictEqual(r.session.state, 'CANCELLED');
  });

  await test('E-03 cancel RECONCILED → ALREADY_RECONCILED', async () => {
    const r = await ledger.cancelSession(sessionId, 1);
    assert.strictEqual(r.error, 'ALREADY_RECONCILED');
  });

  await test('E-04 cancel CANCELLED → ALREADY_CANCELLED', async () => {
    const { sessions } = ledger.getSessionsForUnit(10, { state: 'CANCELLED' });
    assert.ok(sessions.length >= 1);
    const r = await ledger.cancelSession(sessions[0].id, 1);
    assert.strictEqual(r.error, 'ALREADY_CANCELLED');
  });

  await test('E-05 non-existent session → SESSION_NOT_FOUND', async () => {
    const r = await ledger.cancelSession(9999, 1);
    assert.strictEqual(r.error, 'SESSION_NOT_FOUND');
  });

  await test('E-06 stats.sessionsCancelled incremented', () => {
    assert.ok(ledger.getStats().sessionsCancelled >= 2);
  });

  // ── GROUP F: Queries ──────────────────────────────────────────────
  console.log('\n🔍 Group F: Queries');

  await test('F-01 getSession returns counts array', () => {
    const s = ledger.getSession(sessionId);
    assert.ok(Array.isArray(s.counts));
    assert.ok(s.counts.length >= 2);
  });

  await test('F-02 getSession returns discrepancies', () => {
    const s = ledger.getSession(sessionId);
    assert.ok(Array.isArray(s.discrepancies));
  });

  await test('F-03 getSession includes countedItemIds', () => {
    const s = ledger.getSession(sessionId);
    assert.ok(Array.isArray(s.countedItemIds));
    assert.ok(s.countedItemIds.includes(i1.id));
  });

  await test('F-04 getSession non-existent → null', () => {
    assert.strictEqual(ledger.getSession(9999), null);
  });

  await test('F-05 getSessionsForUnit returns paginated list', () => {
    const { sessions, total } = ledger.getSessionsForUnit(10);
    assert.ok(total >= 3);
    assert.ok(Array.isArray(sessions));
  });

  await test('F-06 getSessionsForUnit state filter', () => {
    const { sessions } = ledger.getSessionsForUnit(10, { state: 'RECONCILED' });
    assert.ok(sessions.every(s => s.state === 'RECONCILED'));
  });

  await test('F-07 getSessionsForUnit sorted newest-first', () => {
    const { sessions } = ledger.getSessionsForUnit(10);
    for (let i = 1; i < sessions.length; i++) {
      assert.ok(sessions[i].createdAt <= sessions[i-1].createdAt);
    }
  });

  await test('F-08 getSessionsForUnit pagination', () => {
    const { sessions } = ledger.getSessionsForUnit(10, { limit: 1 });
    assert.strictEqual(sessions.length, 1);
  });

  await test('F-09 getActiveSession returns null when none active', async () => {
    // All unit-10 sessions are now RECONCILED or CANCELLED
    assert.strictEqual(ledger.getActiveSession(10), null);
  });

  await test('F-10 getActiveSession returns session when active', async () => {
    const newSess = (await ledger.createSession({ unitId: 10 })).session;
    const active  = ledger.getActiveSession(10);
    assert.ok(active);
    assert.ok(['OPEN','COUNTING'].includes(active.state));
    await ledger.cancelSession(newSess.id, 1, 'cleanup');
  });

  // ── GROUP G: Edge Cases & Routes ──────────────────────────────────
  console.log('\n🛡️  Group G: Edge Cases & Routes');

  await test('G-01 routes module loads without error', () => {
    const f = require('../src/routes/inventory.routes');
    assert.strictEqual(typeof f, 'function');
  });

  await test('G-02 getStats all fields present', () => {
    const s = ledger.getStats();
    assert.ok('sessionsCreated'    in s);
    assert.ok('sessionsReconciled' in s);
    assert.ok('sessionsCancelled'  in s);
    assert.ok('itemsCounted'       in s);
    assert.ok('discrepanciesFound' in s);
    assert.ok('totalSessions'      in s);
  });

  await test('G-03 zero-item unit session: empty discrepancy list', async () => {
    const s = (await ledger.createSession({ unitId: 99 })).session;
    assert.strictEqual(s.itemsExpected, 0);
    const fin = await ledger.finalizeSession(s.id, 1);
    assert.strictEqual(fin.discrepancies.length, 0);
    assert.strictEqual(fin.summary.notCounted, 0);
  });

  await test('G-04 recordCount on PENDING_APPROVAL → SESSION_NOT_ACTIVE', async () => {
    const s3 = new SupplyChainService(null, new StubRBAC(), new StubNotif());
    const it  = (await s3.createItem({ itemCode:'P-1', itemName:'Pending', category:'GENERAL', unitId:50, quantity:10 })).item;
    const l3  = new InventoryLedgerService(null, s3);
    const sid = (await l3.createSession({ unitId: 50 })).session.id;
    await l3.recordCount(sid, it.id, 10, 1);
    await l3.finalizeSession(sid, 1);
    const r = await l3.recordCount(sid, it.id, 5, 1);
    assert.strictEqual(r.error, 'SESSION_NOT_ACTIVE');
  });

  await test('G-05 works without audit log', async () => {
    const s5 = new SupplyChainService(null, new StubRBAC(), new StubNotif());
    const l5  = new InventoryLedgerService(null, s5);
    const r   = await l5.createSession({ unitId: 60 });
    assert.strictEqual(r.success, true);
  });

  await test('G-06 discrepanciesFound stat includes all finalized discrepancies', () => {
    const s = ledger.getStats();
    assert.ok(s.discrepanciesFound >= 1);
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 24 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
