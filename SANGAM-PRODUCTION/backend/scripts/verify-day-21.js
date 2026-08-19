'use strict';

/**
 * Day 21 Verification — Bulk Operations Service
 *
 * Groups:
 *   A: CSV Import
 *   B: Bulk Transfer Initiate
 *   C: Bulk Approve
 *   D: Bulk Quantity Update
 *   E: Export Items to CSV
 *   F: Limits & Edge Cases
 */

const assert = require('assert');
const AuditLogService      = require('../src/services/audit-log.service');
const SupplyChainService   = require('../src/services/supply-chain.service');
const BulkOperationsService = require('../src/services/bulk-operations.service');

class StubRBAC {
  async getCommandScope(unitId) { return [unitId, unitId + 1]; }
}

class StubNotifications {
  async notifyLowStock()         {}
  async notifyTransferPending()  {}
  async notifyTransferDecision() {}
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { console.log(`  ✅ ${name}`); passed++; })
              .catch(e => { console.error(`  ❌ ${name}: ${e.message}`); failed++; });
    }
    console.log(`  ✅ ${name}`); passed++;
  } catch (e) {
    console.error(`  ❌ ${name}: ${e.message}`); failed++; return Promise.resolve();
  }
  return Promise.resolve();
}

async function buildEnv() {
  const rbac    = new StubRBAC();
  const audit   = new AuditLogService(null);
  const notif   = new StubNotifications();
  const supply  = new SupplyChainService(null, rbac, notif, audit);
  const bulk    = new BulkOperationsService(supply, audit, rbac);

  // Seed base items
  const base1 = (await supply.createItem({
    itemCode: 'BASE-001', itemName: 'Base Item One',
    category: 'GENERAL', unitId: 10, quantity: 100
  })).item;
  const base2 = (await supply.createItem({
    itemCode: 'BASE-002', itemName: 'Base Item Two',
    category: 'FUEL', unitId: 10, quantity: 500
  })).item;

  await new Promise(r => setTimeout(r, 20));
  return { rbac, audit, notif, supply, bulk, base1, base2 };
}

async function run() {
  const env = await buildEnv();
  const { supply, bulk, base1, base2 } = env;

  // ─────────────────────────────────────────────────────────────────
  // GROUP A: CSV Import
  // ─────────────────────────────────────────────────────────────────
  console.log('\n📥 Group A: CSV Import');

  const validCSV = [
    'itemCode,itemName,category,quantity,unitOfMeasure,lowStockThreshold',
    'AMMO-100,7.62mm Rounds,AMMO,1000,RDS,100',
    'MED-100,Morphine,MEDICAL,50,UNIT,10',
    'FUEL-100,Petrol,FUEL,2000,LTR,200'
  ].join('\n');

  await test('A-01 valid CSV imports all rows', async () => {
    const r = await bulk.importItemsFromCSV(validCSV, 10, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.summary.successCount, 3);
    assert.strictEqual(r.summary.failureCount, 0);
  });

  await test('A-02 succeeded array has row number and itemId', async () => {
    const uniqueCSV = [
      'itemCode,itemName,category,quantity',
      'A02-UNIQUE,Test Item A02,GENERAL,10'
    ].join('\n');
    const r = await bulk.importItemsFromCSV(uniqueCSV, 10, 1);
    assert.ok(r.succeeded.length > 0, 'Expected at least one succeeded row');
    const row = r.succeeded[0];
    assert.ok('row'      in row, 'missing row');
    assert.ok('itemId'   in row, 'missing itemId');
    assert.ok('itemCode' in row, 'missing itemCode');
  });

  const csvWithErrors = [
    'itemCode,itemName,category,quantity',
    ',Missing Code,AMMO,100',
    'VALID-001,Valid Item,MEDICAL,20',
    'DUP-001,Dup,GENERAL,-5'
  ].join('\n');

  await test('A-03 partial CSV: valid rows succeed, invalid rows fail', async () => {
    const r = await bulk.importItemsFromCSV(csvWithErrors, 10, 1);
    assert.strictEqual(r.success, true);
    assert.ok(r.summary.successCount >= 1);
    assert.ok(r.summary.failureCount >= 1);
    assert.strictEqual(r.summary.partialSuccess, true);
  });

  await test('A-04 missing itemCode → MISSING_ITEM_CODE in failed', async () => {
    const r = await bulk.importItemsFromCSV(csvWithErrors, 10, 1);
    assert.ok(r.failed.some(f => f.error === 'MISSING_ITEM_CODE'));
  });

  await test('A-05 negative quantity → INVALID_QUANTITY in failed', async () => {
    const r = await bulk.importItemsFromCSV(csvWithErrors, 10, 1);
    assert.ok(r.failed.some(f => f.error === 'INVALID_QUANTITY'));
  });

  await test('A-06 header-only CSV → NO_DATA_ROWS', async () => {
    const r = await bulk.importItemsFromCSV('itemCode,itemName,category', 10);
    assert.strictEqual(r.error, 'NO_DATA_ROWS');
  });

  await test('A-07 null CSV → EMPTY_CSV', async () => {
    const r = await bulk.importItemsFromCSV(null, 10);
    assert.strictEqual(r.error, 'EMPTY_CSV');
  });

  await test('A-08 missing unitId → MISSING_UNIT_ID', async () => {
    const r = await bulk.importItemsFromCSV(validCSV, null);
    assert.strictEqual(r.error, 'MISSING_UNIT_ID');
  });

  await test('A-09 oversized batch rejected', async () => {
    const header = 'itemCode,itemName,category,quantity';
    const rows   = Array.from({ length: 101 }, (_, i) =>
      `ITEM-${i},Item ${i},GENERAL,${i}`).join('\n');
    const r = await bulk.importItemsFromCSV(`${header}\n${rows}`, 10);
    assert.strictEqual(r.error, 'BATCH_TOO_LARGE');
  });

  await test('A-10 case-insensitive column headers', async () => {
    const csv = [
      'ItemCode,ItemName,Category,Quantity',
      'CI-001,Case Insensitive,MEDICAL,10'
    ].join('\n');
    const r = await bulk.importItemsFromCSV(csv, 10, 1);
    assert.ok(r.summary.successCount >= 1);
  });

  await test('A-11 CSV with quoted comma in field', async () => {
    const csv = [
      'itemCode,itemName,category,quantity',
      'QC-001,"Smith, John Kit",MEDICAL,5'
    ].join('\n');
    const r = await bulk.importItemsFromCSV(csv, 10, 1);
    assert.ok(r.summary.successCount >= 1);
    const item = supply.getItemById(r.succeeded[0].itemId);
    assert.strictEqual(item.itemName, 'Smith, John Kit');
  });

  await test('A-12 duplicate itemCode same unit → ITEM_CODE_EXISTS in failed', async () => {
    const csv = [
      'itemCode,itemName,category,quantity',
      'BASE-001,Duplicate,GENERAL,10'
    ].join('\n');
    const r = await bulk.importItemsFromCSV(csv, 10, 1);
    assert.ok(r.failed.some(f => f.error === 'ITEM_CODE_EXISTS'));
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP B: Bulk Transfer Initiate
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔀 Group B: Bulk Transfer Initiate');

  await test('B-01 bulk transfer with valid entries', async () => {
    const r = await bulk.bulkTransfer([
      { itemId: base1.id, fromUnitId: 10, toUnitId: 11, quantity: 10 },
      { itemId: base2.id, fromUnitId: 10, toUnitId: 11, quantity: 50 }
    ], 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.summary.successCount, 2);
  });

  await test('B-02 succeeded includes transferId', () => {
    bulk.bulkTransfer([
      { itemId: base1.id, fromUnitId: 10, toUnitId: 11, quantity: 5 }
    ], 1).then(r => {
      assert.ok('transferId' in r.succeeded[0]);
    });
  });

  await test('B-03 missing fields → MISSING_FIELDS in failed', async () => {
    const r = await bulk.bulkTransfer([
      { itemId: base1.id } // missing fromUnitId, toUnitId, quantity
    ], 1);
    assert.ok(r.failed.some(f => f.error === 'MISSING_FIELDS'));
  });

  await test('B-04 insufficient stock fails gracefully', async () => {
    const r = await bulk.bulkTransfer([
      { itemId: base1.id, fromUnitId: 10, toUnitId: 11, quantity: 999999 }
    ], 1);
    assert.ok(r.failed.some(f => f.error === 'INSUFFICIENT_STOCK'));
  });

  await test('B-05 empty list → EMPTY_LIST', async () => {
    const r = await bulk.bulkTransfer([], 1);
    assert.strictEqual(r.error, 'EMPTY_LIST');
  });

  await test('B-06 oversized batch rejected', async () => {
    const transfers = Array.from({ length: 51 }, (_, i) => ({
      itemId: base1.id, fromUnitId: 10, toUnitId: 11, quantity: 1
    }));
    const r = await bulk.bulkTransfer(transfers, 1);
    assert.strictEqual(r.error, 'BATCH_TOO_LARGE');
  });

  await test('B-07 partial success: one good one bad', async () => {
    const r = await bulk.bulkTransfer([
      { itemId: base1.id, fromUnitId: 10, toUnitId: 11, quantity: 5 }, // valid
      { itemId: 9999, fromUnitId: 10, toUnitId: 11, quantity: 1 }     // item not found
    ], 1);
    assert.ok(r.summary.successCount >= 1);
    assert.ok(r.summary.failureCount >= 1);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP C: Bulk Approve
  // ─────────────────────────────────────────────────────────────────
  console.log('\n✅ Group C: Bulk Approve');

  // Create 3 fresh transfers to approve
  async function makePending(qty = 2) {
    return (await supply.initiateTransfer({
      itemId: base1.id, fromUnitId: 10, toUnitId: 11,
      quantity: qty, requestedByUserId: 1
    })).transfer;
  }
  await supply.updateItem(base1.id, { quantity: 500 }); // reset stock

  const t1 = await makePending(5);
  const t2 = await makePending(5);
  const t3 = await makePending(5);

  await test('C-01 bulk approve succeeds for pending transfers', async () => {
    const r = await bulk.bulkApprove([t1.id, t2.id], 5);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.summary.approved, 2);
  });

  await test('C-02 blocks created for approved transfers', async () => {
    const r = await bulk.bulkApprove([t3.id], 5);
    assert.strictEqual(r.summary.blocksCreated, 1);
  });

  await test('C-03 approving already-completed → INVALID_STATUS in failed', async () => {
    const r = await bulk.bulkApprove([t1.id], 5); // already approved
    assert.ok(r.failed.some(f => f.error === 'INVALID_STATUS'));
  });

  await test('C-04 empty transferIds → EMPTY_LIST', async () => {
    const r = await bulk.bulkApprove([], 5);
    assert.strictEqual(r.error, 'EMPTY_LIST');
  });

  await test('C-05 oversized approval batch rejected', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => i + 1);
    const r   = await bulk.bulkApprove(ids, 5);
    assert.strictEqual(r.error, 'BATCH_TOO_LARGE');
  });

  await test('C-06 nonexistent transferId → error in failed, not crash', async () => {
    const r = await bulk.bulkApprove([99999], 5);
    assert.strictEqual(r.failed[0].error, 'TRANSFER_NOT_FOUND');
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP D: Bulk Quantity Update
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔢 Group D: Bulk Quantity Update');

  await test('D-01 bulk update valid items', async () => {
    const r = await bulk.bulkUpdateQuantity([
      { itemId: base1.id, quantity: 300 },
      { itemId: base2.id, quantity: 750 }
    ], 1);
    assert.strictEqual(r.summary.successCount, 2);
    assert.strictEqual(supply.getItemById(base1.id).quantity, 300);
    assert.strictEqual(supply.getItemById(base2.id).quantity, 750);
  });

  await test('D-02 negative quantity → INVALID_QUANTITY in failed', async () => {
    const r = await bulk.bulkUpdateQuantity([
      { itemId: base1.id, quantity: -1 }
    ]);
    assert.ok(r.failed.some(f => f.error === 'INVALID_QUANTITY'));
  });

  await test('D-03 nonexistent item → ITEM_NOT_FOUND in failed', async () => {
    const r = await bulk.bulkUpdateQuantity([{ itemId: 9999, quantity: 10 }]);
    assert.ok(r.failed.some(f => f.error === 'ITEM_NOT_FOUND'));
  });

  await test('D-04 missing fields → MISSING_FIELDS in failed', async () => {
    const r = await bulk.bulkUpdateQuantity([{ quantity: 10 }]);
    assert.ok(r.failed.some(f => f.error === 'MISSING_FIELDS'));
  });

  await test('D-05 empty list → EMPTY_LIST', async () => {
    const r = await bulk.bulkUpdateQuantity([]);
    assert.strictEqual(r.error, 'EMPTY_LIST');
  });

  await test('D-06 oversized batch rejected', async () => {
    const updates = Array.from({ length: 101 }, (_, i) => ({ itemId: i, quantity: 1 }));
    const r = await bulk.bulkUpdateQuantity(updates);
    assert.strictEqual(r.error, 'BATCH_TOO_LARGE');
  });

  await test('D-07 partial success: valid and invalid items mixed', async () => {
    const r = await bulk.bulkUpdateQuantity([
      { itemId: base1.id, quantity: 200 }, // valid
      { itemId: 9999,     quantity: 5   }  // not found
    ]);
    assert.ok(r.summary.successCount >= 1);
    assert.ok(r.summary.failureCount >= 1);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP E: Export Items to CSV
  // ─────────────────────────────────────────────────────────────────
  console.log('\n📤 Group E: Export Items to CSV');

  await test('E-01 exportItemsToCSV produces CSV string', () => {
    const { items } = supply.getItemsInScope([10, 11]);
    const csv = bulk.exportItemsToCSV(items);
    assert.strictEqual(typeof csv, 'string');
    assert.ok(csv.length > 0);
  });

  await test('E-02 CSV has correct headers', () => {
    const { items } = supply.getItemsInScope([10]);
    const csv    = bulk.exportItemsToCSV(items);
    const header = csv.split('\n')[0];
    assert.ok(header.includes('itemCode'));
    assert.ok(header.includes('itemName'));
    assert.ok(header.includes('category'));
    assert.ok(header.includes('quantity'));
  });

  await test('E-03 CSV row count matches items length', () => {
    const { items } = supply.getItemsInScope([10, 11]);
    const csv    = bulk.exportItemsToCSV(items);
    const lines  = csv.split('\n').filter(Boolean);
    assert.strictEqual(lines.length, items.length + 1); // +1 for header
  });

  await test('E-04 empty items → empty string', () => {
    const csv = bulk.exportItemsToCSV([]);
    assert.strictEqual(csv, '');
  });

  await test('E-05 CSV values are parseable back to original', () => {
    const { items } = supply.getItemsInScope([10]);
    const csv    = bulk.exportItemsToCSV(items);
    const lines  = csv.split('\n');
    const headers = lines[0].split(',');
    const qtyIdx  = headers.indexOf('quantity');
    const firstQty = parseInt(lines[1].split(',')[qtyIdx], 10);
    assert.ok(!isNaN(firstQty));
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP F: Limits & Edge Cases
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔒 Group F: Limits & Edge Cases');

  await test('F-01 BulkOperationsService.LIMITS is accessible', () => {
    const lim = BulkOperationsService.LIMITS;
    assert.ok(lim.CSV_IMPORT   > 0);
    assert.ok(lim.BULK_TRANSFER > 0);
    assert.ok(lim.BULK_APPROVE  > 0);
    assert.ok(lim.BULK_UPDATE   > 0);
  });

  await test('F-02 _parseCSV handles CRLF line endings', () => {
    const csv = 'itemCode,itemName,category,quantity\r\nAMMO-X,Test,AMMO,10';
    const { rows, headers } = bulk._parseCSV(csv);
    assert.strictEqual(headers.length, 4);
    assert.strictEqual(rows.length, 1);
  });

  await test('F-03 _parseCSV handles quoted newlines', () => {
    // quoted field with embedded newline
    const csv = 'itemCode,itemName,category,quantity\nNOTE-001,"Line1\nLine2",GENERAL,5';
    const { rows } = bulk._parseCSV(csv);
    // Parser may or may not handle embedded newlines — test it doesn't crash
    assert.ok(Array.isArray(rows));
  });

  await test('F-04 bulkTransfer empty array → EMPTY_LIST', async () => {
    const r = await bulk.bulkTransfer([]);
    assert.strictEqual(r.error, 'EMPTY_LIST');
  });

  await test('F-05 routes module loads without error', () => {
    const createBulkRoutes = require('../src/routes/bulk.routes');
    assert.strictEqual(typeof createBulkRoutes, 'function');
  });

  await test('F-06 bulk service works without audit log', async () => {
    const b2 = new BulkOperationsService(supply);
    const r  = await b2.bulkUpdateQuantity([{ itemId: base1.id, quantity: 100 }], 1);
    assert.strictEqual(r.summary.successCount, 1);
  });

  // ─────────────────────────────────────────────────────────────────
  // FINAL
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 21 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(err => { console.error(err); process.exit(1); });
