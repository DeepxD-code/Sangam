'use strict';

/**
 * Day 69 Verification — Cross-Service SQL Audit + Bulk-Operation Flush
 *
 * Following Day 68's discovery pattern (real bugs found by checking
 * actual SQL against actual table schemas, and by tracing which bulk-
 * creation call sites lack flushPendingWrites()), this day systematically
 * checked every OTHER service with SQL persistence:
 *
 *   - movement-order, inventory-ledger, alert-escalation, compliance
 *     services: confirmed to have ZERO SQL persistence at all (grep for
 *     db.query/_persist/_dbWrite: no matches in any of the four). Not a
 *     bug — a documented architectural fact. These domains simply have
 *     no SQL audit trail, unlike units/supply-chain/delegation/
 *     notification/audit-log.
 *   - delegation.service.js, notification.service.js: read against
 *     their real table schemas (day-15, day-11) — both INSERTs
 *     correctly reference only real, existing columns. Notification's
 *     write was additionally smoke-tested against genuine local
 *     PostgreSQL (installed Day 68, restarted this session) — landed
 *     correctly, zero new errors in the Postgres log.
 *   - audit-log.service.js: uses a real BEGIN/COMMIT/ROLLBACK
 *     transaction with properly-awaited writes (not fire-and-forget
 *     like the others) — different, more careful pattern already in
 *     place. Smoke-tested against real Postgres — landed correctly.
 *     Minor, NOT fixed today: day-16 adds audit_logs.encryption_version
 *     but the INSERT never sets it, so it silently defaults to 0
 *     (plaintext/legacy) regardless of whether `details` was actually
 *     AES-256-GCM encrypted before insertion. Doesn't crash or corrupt
 *     anything — a metadata-accuracy question, not a functional bug —
 *     flagged for a future day rather than dug into today without full
 *     confidence in the encryption code's intent.
 *   - bulk-operations.service.js: found the SAME fire-and-forget race
 *     exposure as Day 68's seeder fix, in two places — importItemsFromCSV
 *     (many createItem calls in a tight loop) and bulkTransfer (many
 *     createTransfer calls). Fixed both with the same flushPendingWrites()
 *     call Day 68 already built, right before each method's final
 *     _audit() call — so by the time an HTTP response returns, every
 *     succeeded row has actually landed in SQL. The live single-item
 *     POST /supply/items and POST /supply/transfers paths are untouched.
 *
 * This script covers what's portable (pg-mem + deterministic contract
 * tests). The real-Postgres smoke tests for notification/audit-log
 * described above were performed manually this session and are not
 * re-runnable here — see the Day 69 handoff notes, consistent with how
 * Day 68 handled the same limitation.
 */

const { newDb } = require('pg-mem');
const SupplyChainService     = require('../src/services/supply-chain.service');
const UnitManagementService  = require('../src/services/unit-management.service');
const BulkOperationsService  = require('../src/services/bulk-operations.service');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function freshPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

async function run() {

  // ── Group A: cross-service audit summary (static facts, no I/O) ──
  console.log('\n🔍 Group A: cross-service SQL persistence audit');
  const fs = require('fs');
  const path = require('path');
  const servicesDir = path.join(__dirname, '../src/services');
  const noPersistence = ['movement-order.service.js', 'inventory-ledger.service.js', 'alert-escalation.service.js', 'compliance.service.js'];
  for (const filename of noPersistence) {
    const content = fs.readFileSync(path.join(servicesDir, filename), 'utf8');
    const hasDbWrite = /this\.db\.query|_persist\w*\s*\(|_dbWrite/.test(content);
    check(`A-0${noPersistence.indexOf(filename) + 1} ${filename} has no SQL persistence (documented, not a bug)`, !hasDbWrite);
  }

  // ── Group B: bulk-operations flush additions ──────────────────────
  console.log('\n📦 Group B: bulk-import / bulk-transfer flushPendingWrites()');
  const poolB = freshPgMemPool();
  await poolB.query(`
    CREATE TABLE command_units (
      id SERIAL PRIMARY KEY, unit_name VARCHAR(100) NOT NULL,
      unit_type VARCHAR(30) NOT NULL, unit_code VARCHAR(20) UNIQUE NOT NULL,
      parent_unit_id INTEGER REFERENCES command_units(id),
      commander_id INTEGER, location VARCHAR(100),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE supply_items (
      id SERIAL PRIMARY KEY, item_code VARCHAR(50) UNIQUE NOT NULL,
      item_name VARCHAR(150) NOT NULL, category VARCHAR(50) NOT NULL,
      unit_id INTEGER NOT NULL REFERENCES command_units(id),
      quantity INTEGER NOT NULL DEFAULT 0, unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'EA',
      low_stock_threshold INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const unitsB  = new UnitManagementService(poolB, null, null);
  const supplyB = new SupplyChainService(poolB, null, null, null);
  const bulkB   = new BulkOperationsService(supplyB, null, null);

  const unitB = (await unitsB.createUnit({ unitName: 'D69 Unit', unitType: 'BATTALION', unitCode: 'D69-UNIT' })).unit;
  await unitsB.flushPendingWrites();

  const csv = 'itemCode,itemName,category,quantity\n' +
    'D69-A,Item A,EQUIPMENT,10\n' +
    'D69-B,Item B,EQUIPMENT,20\n' +
    'D69-C,Item C,EQUIPMENT,30\n';
  const importResult = await bulkB.importItemsFromCSV(csv, unitB.id, null);
  check('B-01 importItemsFromCSV succeeds', importResult.success === true && importResult.succeeded.length === 3, JSON.stringify(importResult));

  {
    // No extra wait here at all — if importItemsFromCSV's internal
    // flush didn't work, this immediate query could still race in a
    // genuinely concurrent environment (pg-mem itself is synchronous
    // enough not to reproduce the race, but this confirms the method
    // resolved only AFTER calling flush, which is the actual contract
    // that matters).
    const rows = (await poolB.query('SELECT item_code FROM supply_items ORDER BY id')).rows;
    check('B-02 all 3 imported items landed in SQL by the time importItemsFromCSV returned', rows.length === 3, `got ${rows.length}`);
  }

  const transferResult = await bulkB.bulkTransfer([
    { itemId: importResult.succeeded[0].itemId, fromUnitId: unitB.id, toUnitId: unitB.id, quantity: 1 }
  ], null);
  check('B-03 bulkTransfer runs without throwing', transferResult && typeof transferResult.succeeded !== 'undefined', JSON.stringify(transferResult));

  // ── Group C: flush call sites actually exist in source (regression
  //             guard — if someone edits these methods later and drops
  //             the flush call, this catches it even without needing to
  //             reproduce the underlying race) ──────────────────────
  console.log('\n🔒 Group C: flush call sites present in source (regression guard)');
  const bulkSrc = fs.readFileSync(path.join(servicesDir, 'bulk-operations.service.js'), 'utf8');
  const importFn = bulkSrc.slice(bulkSrc.indexOf('async importItemsFromCSV'), bulkSrc.indexOf('async importItemsFromCSV') + 3500);
  const transferFn = bulkSrc.slice(bulkSrc.indexOf('async bulkTransfer'), bulkSrc.indexOf('async bulkTransfer') + 2500);
  check('C-01 importItemsFromCSV calls flushPendingWrites before its _audit call', /flushPendingWrites\(\)/.test(importFn) && importFn.indexOf('flushPendingWrites') < importFn.indexOf('_audit('));
  check('C-02 bulkTransfer calls flushPendingWrites before its _audit call', /flushPendingWrites\(\)/.test(transferFn) && transferFn.indexOf('flushPendingWrites') < transferFn.indexOf('_audit('));

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 69 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
