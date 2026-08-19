'use strict';

/**
 * Day 20 Verification — Compliance Reporting Service
 *
 * Groups:
 *   A: Chain of Custody
 *   B: Transfer Register
 *   C: Discrepancy Report
 *   D: Audit Export
 *   E: Compliance Summary
 *   F: CSV Export
 *   G: Edge cases & scope enforcement
 */

const assert = require('assert');

// ── Minimal service stubs ────────────────────────────────────────────────────
const AuditLogService  = require('../src/services/audit-log.service');
const SupplyChainService = require('../src/services/supply-chain.service');
const ComplianceService  = require('../src/services/compliance.service');

class StubRBAC {
  async getCommandScope(unitId) { return [unitId, unitId + 1]; }
  buildUserContext(row) { return { id: row.id, unitId: row.unit_id, role: row.role }; }
}

// ── Test runner ──────────────────────────────────────────────────────────────
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
    console.error(`  ❌ ${name}: ${e.message}`); failed++;
  }
  return Promise.resolve();
}

// ── Build a populated test environment ─────────────────────────────────────
async function buildEnv() {
  const rbac    = new StubRBAC();
  const audit   = new AuditLogService(null);          // offline mode
  const supply  = new SupplyChainService(null, rbac, null, audit);
  const compliance = new ComplianceService(null, audit, supply);

  // Seed items
  const item1 = (await supply.createItem({
    itemCode: 'AMMO-001', itemName: '5.56mm Rounds',
    category: 'AMMO', unitId: 10, quantity: 2000, lowStockThreshold: 200
  })).item;

  const item2 = (await supply.createItem({
    itemCode: 'FUEL-001', itemName: 'Diesel Fuel',
    category: 'FUEL', unitId: 10, quantity: 5000, lowStockThreshold: 500
  })).item;

  const item3 = (await supply.createItem({
    itemCode: 'MED-001', itemName: 'First Aid Kit',
    category: 'MEDICAL', unitId: 11, quantity: 50, lowStockThreshold: 10
  })).item;

  // Seed transfers
  const t1 = (await supply.initiateTransfer({
    itemId: item1.id, fromUnitId: 10, toUnitId: 11,
    quantity: 500, requestedByUserId: 1, notes: 'Monthly resupply'
  })).transfer;

  await supply.approveTransfer(t1.id, 5); // → COMPLETED, block written

  const t2 = (await supply.initiateTransfer({
    itemId: item1.id, fromUnitId: 10, toUnitId: 11,
    quantity: 200, requestedByUserId: 1
  })).transfer;

  await supply.rejectTransfer(t2.id, 5, 'Insufficient justification');

  const t3 = (await supply.initiateTransfer({
    itemId: item2.id, fromUnitId: 10, toUnitId: 11,
    quantity: 1000, requestedByUserId: 2
  })).transfer; // left PENDING

  // Wait for audit queue flush
  await new Promise(r => setTimeout(r, 50));

  return { audit, supply, compliance, item1, item2, item3, t1, t2, t3, rbac };
}

async function run() {
  const env = await buildEnv();
  const { audit, supply, compliance, item1, item2, item3, t1, t2, t3 } = env;

  // ─────────────────────────────────────────────────────────────────
  // GROUP A: Chain of Custody
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔗 Group A: Chain of Custody');

  await test('A-01 getChainOfCustody returns success for valid item', async () => {
    const r = await compliance.getChainOfCustody(item1.id, [10, 11]);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.itemId, item1.id);
    assert.ok(Array.isArray(r.events));
  });

  await test('A-02 custody events include SUPPLY_CREATE', async () => {
    const r = await compliance.getChainOfCustody(item1.id, [10, 11]);
    assert.ok(r.events.some(e => e.action === 'SUPPLY_CREATE'));
  });

  await test('A-03 custody events include transfer actions', async () => {
    const r = await compliance.getChainOfCustody(item1.id, [10, 11]);
    assert.ok(r.events.some(e =>
      e.action === 'SUPPLY_TRANSFER_INITIATE' ||
      e.action === 'SUPPLY_TRANSFER_APPROVE'));
  });

  await test('A-04 events sorted chronologically', async () => {
    const r = await compliance.getChainOfCustody(item1.id, [10, 11]);
    for (let i = 1; i < r.events.length; i++) {
      assert.ok(
        new Date(r.events[i].timestamp) >= new Date(r.events[i - 1].timestamp),
        `Event ${i} timestamp out of order`
      );
    }
  });

  await test('A-05 item not found → ITEM_NOT_FOUND', async () => {
    const r = await compliance.getChainOfCustody(9999, [10]);
    assert.strictEqual(r.error, 'ITEM_NOT_FOUND');
  });

  await test('A-06 item out of scope → UNIT_OUT_OF_SCOPE', async () => {
    const r = await compliance.getChainOfCustody(item1.id, [99]); // unit 10 not in [99]
    assert.strictEqual(r.error, 'UNIT_OUT_OF_SCOPE');
  });

  await test('A-07 exportedAt is an ISO timestamp', async () => {
    const r = await compliance.getChainOfCustody(item1.id, [10, 11]);
    assert.ok(!isNaN(new Date(r.exportedAt)));
  });

  await test('A-08 eventCount matches events array length', async () => {
    const r = await compliance.getChainOfCustody(item1.id, [10, 11]);
    assert.strictEqual(r.eventCount, r.events.length);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP B: Transfer Register
  // ─────────────────────────────────────────────────────────────────
  console.log('\n📋 Group B: Transfer Register');

  await test('B-01 getTransferRegister returns all scope transfers', () => {
    const r = compliance.getTransferRegister([10, 11]);
    assert.strictEqual(r.success, true);
    assert.ok(r.total >= 3);
    assert.ok(Array.isArray(r.transfers));
  });

  await test('B-02 transfer register includes enriched fields', () => {
    const r = compliance.getTransferRegister([10, 11]);
    const t = r.transfers[0];
    assert.ok('transferId'        in t, 'missing transferId');
    assert.ok('itemCode'          in t, 'missing itemCode');
    assert.ok('auditVerified'     in t, 'missing auditVerified');
    assert.ok('requestedByUserId' in t, 'missing requestedByUserId');
  });

  await test('B-03 status filter: COMPLETED', () => {
    const r = compliance.getTransferRegister([10, 11], { status: 'COMPLETED' });
    assert.ok(r.transfers.every(t => t.status === 'COMPLETED'));
  });

  await test('B-04 status filter: PENDING', () => {
    const r = compliance.getTransferRegister([10, 11], { status: 'PENDING' });
    assert.ok(r.transfers.every(t => t.status === 'PENDING'));
  });

  await test('B-05 status filter: REJECTED', () => {
    const r = compliance.getTransferRegister([10, 11], { status: 'REJECTED' });
    assert.ok(r.transfers.length >= 1);
    assert.ok(r.transfers.every(t => t.status === 'REJECTED'));
  });

  await test('B-06 date filter: no results for far future', () => {
    const r = compliance.getTransferRegister([10, 11], {
      startDate: '2099-01-01', endDate: '2099-12-31'
    });
    assert.strictEqual(r.transfers.length, 0);
  });

  await test('B-07 pagination: limit=1 offset=0 returns 1 transfer', () => {
    const r = compliance.getTransferRegister([10, 11], { limit: 1 });
    assert.strictEqual(r.transfers.length, 1);
    assert.strictEqual(r.limit, 1);
  });

  await test('B-08 generatedAt is present', () => {
    const r = compliance.getTransferRegister([10, 11]);
    assert.ok(!isNaN(new Date(r.generatedAt)));
  });

  await test('B-09 out-of-scope units return empty', () => {
    const r = compliance.getTransferRegister([99]);
    assert.strictEqual(r.total, 0);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP C: Discrepancy Report
  // ─────────────────────────────────────────────────────────────────
  console.log('\n⚠️  Group C: Discrepancy Report');

  await test('C-01 getDiscrepancyReport returns success', () => {
    const r = compliance.getDiscrepancyReport([10, 11]);
    assert.strictEqual(r.success, true);
    assert.ok(Array.isArray(r.discrepancies));
    assert.ok(Array.isArray(r.cleanItems));
  });

  await test('C-02 total items = discrepancies + cleanItems', () => {
    const r = compliance.getDiscrepancyReport([10, 11]);
    assert.strictEqual(r.totalItems, r.discrepancyCount + r.cleanItems.length);
  });

  await test('C-03 discrepancy has required fields', () => {
    const r = compliance.getDiscrepancyReport([10, 11]);
    if (r.discrepancies.length > 0) {
      const d = r.discrepancies[0];
      assert.ok('itemId'      in d);
      assert.ok('itemCode'    in d);
      assert.ok('expectedQty' in d);
      assert.ok('actualQty'   in d);
      assert.ok('delta'       in d);
      assert.ok('severity'    in d);
    }
  });

  await test('C-04 clean items have itemId and itemCode', () => {
    const r = compliance.getDiscrepancyReport([10, 11]);
    if (r.cleanItems.length > 0) {
      assert.ok('itemId'   in r.cleanItems[0]);
      assert.ok('itemCode' in r.cleanItems[0]);
    }
  });

  await test('C-05 discrepancy severity HIGH when |delta| > 10', () => {
    const r = compliance.getDiscrepancyReport([10, 11]);
    for (const d of r.discrepancies) {
      if (Math.abs(d.delta) > 10) {
        assert.strictEqual(d.severity, 'HIGH');
      }
    }
  });

  await test('C-06 out-of-scope returns empty report', () => {
    const r = compliance.getDiscrepancyReport([99]);
    assert.strictEqual(r.totalItems, 0);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP D: Audit Export
  // ─────────────────────────────────────────────────────────────────
  console.log('\n📤 Group D: Audit Export');

  await test('D-01 getAuditExport returns success', () => {
    const r = compliance.getAuditExport();
    assert.strictEqual(r.success, true);
    assert.ok(Array.isArray(r.entries));
  });

  await test('D-02 entries have required fields', () => {
    const r = compliance.getAuditExport();
    if (r.entries.length > 0) {
      const e = r.entries[0];
      assert.ok('action'    in e, 'missing action');
      assert.ok('resource'  in e, 'missing resource');
      assert.ok('timestamp' in e, 'missing timestamp');
      assert.ok('severity'  in e, 'missing severity');
    }
  });

  await test('D-03 severity filter works', () => {
    const r = compliance.getAuditExport({ severity: 'INFO' });
    assert.ok(r.entries.every(e => e.severity === 'INFO'));
  });

  await test('D-04 resource filter works', () => {
    const r = compliance.getAuditExport({ resource: 'supply_items' });
    assert.ok(r.entries.every(e => e.resource === 'supply_items'));
  });

  await test('D-05 date range: future dates return empty', () => {
    const r = compliance.getAuditExport({
      startDate: '2099-01-01', endDate: '2099-12-31'
    });
    assert.strictEqual(r.entries.length, 0);
  });

  await test('D-06 limit is respected', () => {
    const r = compliance.getAuditExport({ limit: 2 });
    assert.ok(r.entries.length <= 2);
  });

  await test('D-07 capped flag set when limit exceeded', () => {
    const all = compliance.getAuditExport();
    if (all.total > 2) {
      const r = compliance.getAuditExport({ limit: 2 });
      assert.strictEqual(r.capped, true);
    }
  });

  await test('D-08 exportedAt is valid ISO timestamp', () => {
    const r = compliance.getAuditExport();
    assert.ok(!isNaN(new Date(r.exportedAt)));
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP E: Compliance Summary
  // ─────────────────────────────────────────────────────────────────
  console.log('\n📊 Group E: Compliance Summary');

  await test('E-01 getComplianceSummary returns success', () => {
    const r = compliance.getComplianceSummary({ id: 5, unitId: 10 }, [10, 11]);
    assert.strictEqual(r.success, true);
    assert.ok(r.summary);
  });

  await test('E-02 summary.transfers has all fields', () => {
    const { summary } = compliance.getComplianceSummary({ id: 5, unitId: 10 }, [10, 11]);
    const t = summary.transfers;
    assert.ok('total'        in t, 'missing total');
    assert.ok('completed'    in t, 'missing completed');
    assert.ok('rejected'     in t, 'missing rejected');
    assert.ok('pending'      in t, 'missing pending');
    assert.ok('approvalRate' in t, 'missing approvalRate');
  });

  await test('E-03 summary.inventory reflects seeded items', () => {
    const { summary } = compliance.getComplianceSummary({ id: 5, unitId: 10 }, [10, 11]);
    assert.ok(summary.inventory.totalItems >= 3);
  });

  await test('E-04 summary.blockchain reflects chain state', () => {
    const { summary } = compliance.getComplianceSummary({ id: 5, unitId: 10 }, [10, 11]);
    assert.ok('chainVerified' in summary.blockchain);
    assert.ok('blockCount'    in summary.blockchain);
    assert.strictEqual(summary.blockchain.chainVerified, true);
  });

  await test('E-05 summary.audit has entry count', () => {
    const { summary } = compliance.getComplianceSummary({ id: 5, unitId: 10 }, [10, 11]);
    assert.ok(typeof summary.audit.totalEntries === 'number');
  });

  await test('E-06 approvalRate is a percentage string', () => {
    const { summary } = compliance.getComplianceSummary({ id: 5, unitId: 10 }, [10, 11]);
    assert.ok(summary.transfers.approvalRate.endsWith('%'));
  });

  await test('E-07 generatedAt present in summary', () => {
    const { summary } = compliance.getComplianceSummary({ id: 5, unitId: 10 }, [10, 11]);
    assert.ok(!isNaN(new Date(summary.generatedAt)));
  });

  await test('E-08 low-stock items listed in inventory', () => {
    // item2 (FUEL) qty=5000 threshold=500 → no low stock unless depleted
    // item3 (MED) qty=50 threshold=10 → qty > threshold, not low
    const { summary } = compliance.getComplianceSummary({ id: 5, unitId: 10 }, [10, 11]);
    assert.ok(typeof summary.inventory.lowStockItems === 'number');
    assert.ok(Array.isArray(summary.inventory.lowStockDetails));
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP F: CSV Export
  // ─────────────────────────────────────────────────────────────────
  console.log('\n📄 Group F: CSV Export');

  await test('F-01 exportToCSV produces correct header row', () => {
    const rows = [{ a: 1, b: 'hello', c: true }];
    const csv  = compliance.exportToCSV(rows);
    const lines = csv.split('\n');
    assert.strictEqual(lines[0], 'a,b,c');
  });

  await test('F-02 exportToCSV with explicit headers', () => {
    const rows = [{ a: 1, b: 2, c: 3 }];
    const csv  = compliance.exportToCSV(rows, ['c', 'a']);
    assert.ok(csv.startsWith('c,a'));
  });

  await test('F-03 exportToCSV escapes commas in values', () => {
    const rows = [{ name: 'Smith, John', rank: 'Captain' }];
    const csv  = compliance.exportToCSV(rows);
    assert.ok(csv.includes('"Smith, John"'));
  });

  await test('F-04 exportToCSV escapes double-quotes', () => {
    const rows = [{ note: 'He said "hello"' }];
    const csv  = compliance.exportToCSV(rows);
    assert.ok(csv.includes('""hello""'));
  });

  await test('F-05 exportToCSV handles null/undefined values', () => {
    const rows = [{ a: null, b: undefined, c: 'ok' }];
    const csv  = compliance.exportToCSV(rows);
    const lines = csv.split('\n');
    assert.ok(lines[1].startsWith(',,ok'));
  });

  await test('F-06 exportToCSV handles empty array', () => {
    assert.strictEqual(compliance.exportToCSV([]), '');
  });

  await test('F-07 exportToCSV multiple rows', () => {
    const rows = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const csv  = compliance.exportToCSV(rows);
    const lines = csv.split('\n');
    assert.strictEqual(lines.length, 4); // header + 3 rows
  });

  await test('F-08 exportToCSV serialises objects as JSON', () => {
    const rows = [{ meta: { a: 1 } }];
    const csv  = compliance.exportToCSV(rows);
    assert.ok(csv.includes('{'));
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP G: Edge Cases & Scope Enforcement
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🛡️  Group G: Edge Cases & Scope Enforcement');

  await test('G-01 _getAuditEntries returns empty array without audit log', () => {
    const c = new ComplianceService(null, null, supply);
    const r = c._getAuditEntries({});
    assert.deepStrictEqual(r, []);
  });

  await test('G-02 getChainOfCustody works without audit log', async () => {
    const c = new ComplianceService(null, null, supply);
    const r = await c.getChainOfCustody(item1.id, [10, 11]);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.events.length, 0); // no audit = no events
  });

  await test('G-03 getTransferRegister scope [99] returns zero transfers', () => {
    const r = compliance.getTransferRegister([99]);
    assert.strictEqual(r.total, 0);
  });

  await test('G-04 getAuditExport action filter: SUPPLY prefix', () => {
    const r = compliance.getAuditExport({ action: 'SUPPLY' });
    // action filter matches startsWith
    assert.ok(r.entries.every(e => e.action?.startsWith('SUPPLY')));
  });

  await test('G-05 discrepancy severity LOW when |delta| <= 10', () => {
    const r = compliance.getDiscrepancyReport([10, 11]);
    for (const d of r.discrepancies) {
      if (Math.abs(d.delta) <= 10) {
        assert.strictEqual(d.severity, 'LOW');
      }
    }
  });

  await test('G-06 compliance summary handles empty supply state', () => {
    const emptySvc = new SupplyChainService(null, env.rbac, null, null);
    const c2       = new ComplianceService(null, audit, emptySvc);
    const r        = c2.getComplianceSummary({ id: 99, unitId: 99 }, [99]);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.summary.transfers.total, 0);
  });

  await test('G-07 getAuditExport with multiple severity values (array)', () => {
    const r = compliance.getAuditExport({ severity: ['INFO', 'SECURITY'] });
    assert.ok(r.entries.every(e => ['INFO','SECURITY'].includes(e.severity)));
  });

  await test('G-08 routes module loads without error', () => {
    const createComplianceRoutes = require('../src/routes/compliance.routes');
    assert.strictEqual(typeof createComplianceRoutes, 'function');
  });

  // ─────────────────────────────────────────────────────────────────
  // FINAL
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 20 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(err => { console.error(err); process.exit(1); });
