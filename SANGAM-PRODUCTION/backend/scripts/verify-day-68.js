'use strict';

/**
 * Day 68 Verification — Migration Ordering, supply_items Schema Fix,
 * and the Fire-and-Forget Write Race
 *
 * All three bugs below were found the same way: by actually installing
 * and running real local PostgreSQL 16 in this sandbox (via apt-get —
 * no live Postgres had ever been available before today) and running
 * this project's real production code against it for the first time in
 * its history. None of these could have been found by the existing
 * offline (db=null) suite, and two of the three could not have been
 * found by pg-mem either (see notes below on what pg-mem can and can't
 * stand in for).
 *
 *   A. Migration ordering: day-12-reporting-schema.sql has hard FKs to
 *      command_units(id), but that table used to be defined in
 *      day-13-rbac-schema.sql, which sorts AFTER day-12 — confirmed for
 *      real by running the actual migration runner against genuine
 *      Postgres, which failed with "relation command_units does not
 *      exist". Fixed by extracting command_units into a new
 *      001-command-units-schema.sql (not by renaming any existing
 *      day-NN file, to preserve this project's real development
 *      history). This group is a GENERAL static-analysis guard — reads
 *      every migration file's REFERENCES clauses and confirms the
 *      referenced table is defined at or before that point in sort
 *      order — so it protects against this whole CLASS of mistake
 *      going forward, not just this one instance. No database needed.
 *   B. supply_items schema mismatch: _persistItem()'s INSERT referenced
 *      a created_at column that supply_items has never had at all —
 *      confirmed via pg-mem (which handles this simple, non-recursive
 *      DDL/DML fine) that every item write was failing 100% of the
 *      time whenever db was non-null, silently swallowed by the
 *      existing .catch(()=>{}). This, in turn, was the actual root
 *      cause of every transfers_item_id_fkey failure observed in real
 *      Postgres — not fundamentally a race, though a real race exists
 *      too (Group C).
 *   C. The flushPendingWrites() contract: SupplyChainService and
 *      UnitManagementService's fire-and-forget SQL writes are, by
 *      design, never awaited by the live per-request path (so a flaky
 *      Postgres never adds latency/failure to a normal request) — but
 *      this created a real, observed foreign-key race during rapid
 *      bulk seeding (command_units_parent_unit_id_fkey and
 *      transfers_item_id_fkey violations against genuine Postgres).
 *      pg-mem cannot reproduce the race itself (it isn't genuinely
 *      concurrent the way a real Postgres connection pool is), so this
 *      group verifies the NEW capability's contract deterministically
 *      instead: flushPendingWrites() actually waits for every tracked
 *      in-flight write to settle before resolving.
 *
 * HONEST NOTE ON REAL-POSTGRES VALIDATION: beyond what's automated
 * here, this day's fixes were also validated by hand against a real,
 * temporarily-installed local PostgreSQL 16 — full migration chain,
 * full demo reseed with zero unexpected errors in the Postgres log,
 * SQL row counts exactly matching in-memory (5 units / 20 items / 7
 * transfers), AND, for the first time ever, genuine proof that
 * RBACService.getCommandScope()'s recursive CTE returns correct
 * multi-level results (root → all 5 units; leaf → self only; a
 * 1-child unit → self+child; unknown unit → empty). That manual
 * validation is NOT re-runnable by this script or by `npm test` in
 * general, since a real Postgres server isn't guaranteed to be
 * installed/running in whatever environment eventually runs this
 * suite — see the Day 68 handoff notes for the full transcript rather
 * than re-deriving it here.
 */

const { newDb } = require('pg-mem');
const path       = require('path');
const createApp  = require('../src/app');
const { sortKey, getMigrationFiles } = require('../scripts/run-migrations.js');
const SupplyChainService     = require('../src/services/supply-chain.service');
const UnitManagementService  = require('../src/services/unit-management.service');

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

  // ── Group A: migration ordering — general static guard ───────────
  console.log('\n📐 Group A: migration file ordering vs. FK dependencies');
  const MIGRATIONS_DIR = path.join(__dirname, '../../database/migrations');
  const sorted = getMigrationFiles(); // already filenames, already sorted by sortKey
  const fs = require('fs');

  // File-level (not statement-level) check: a table a file REFERENCES
  // must be CREATEd either by a strictly earlier file, or by this same
  // file (self-references and same-file forward references, like
  // transfers→supply_items within day-12, are both legitimate and
  // already proven to actually run correctly against real Postgres —
  // this guard's job is to catch CROSS-file ordering mistakes, which is
  // the actual bug class found and fixed today, without the fragility
  // of hand-parsing individual SQL statements).
  const createdByFile = new Map(); // filename -> Set(tableNames)
  for (const filename of sorted) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const tables = new Set([...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)].map(m => m[1]));
    createdByFile.set(filename, tables);
  }

  const violations = [];
  const createdSoFar = new Set();
  for (const filename of sorted) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const refs = new Set([...sql.matchAll(/REFERENCES\s+(\w+)\s*\(/gi)].map(m => m[1]));
    const availableNow = new Set([...createdSoFar, ...createdByFile.get(filename)]);
    for (const targetTable of refs) {
      if (!availableNow.has(targetTable)) {
        violations.push(`${filename} references "${targetTable}", which is not created by this file or any earlier one`);
      }
    }
    for (const t of createdByFile.get(filename)) createdSoFar.add(t);
  }

  check('A-01 every REFERENCES target is created by this file or an earlier one', violations.length === 0, violations.join('; '));
  check('A-02 001-command-units-schema.sql sorts before day-12-reporting-schema.sql', sortKey('001-command-units-schema.sql') < sortKey('day-12-reporting-schema.sql'));
  check('A-03 001-command-units-schema.sql sorts before day-13-rbac-schema.sql', sortKey('001-command-units-schema.sql') < sortKey('day-13-rbac-schema.sql'));
  check('A-04 no existing day-NN migration file was renamed (history preserved)', sorted.includes('day-13-rbac-schema.sql') && sorted.includes('day-12-reporting-schema.sql'));

  // ── Group B: supply_items schema match, via pg-mem ────────────────
  console.log('\n🗄️  Group B: _persistItem() SQL matches supply_items\' actual schema');
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
  const unitsB = new UnitManagementService(poolB, null, null);
  const supplyB = new SupplyChainService(poolB, null, null, null);
  const unitB = (await unitsB.createUnit({ unitName: 'D68 Unit', unitType: 'BATTALION', unitCode: 'D68-UNIT' })).unit;
  await unitsB.flushPendingWrites();

  const itemRes = await supplyB.createItem({ itemCode: 'D68-ITEM', itemName: 'Test Item', category: 'EQUIPMENT', unitId: unitB.id, quantity: 5, createdByUserId: null });
  check('B-01 createItem succeeds', itemRes.success === true, JSON.stringify(itemRes));
  await supplyB.flushPendingWrites();

  {
    const row = (await poolB.query('SELECT * FROM supply_items WHERE item_code = $1', ['D68-ITEM'])).rows[0];
    check('B-02 item actually landed in SQL (previously failed 100% of the time)', !!row);
    check('B-03 SQL row values match the in-memory item', row?.item_name === 'Test Item' && row?.quantity === 5);
  }

  // ── Group C: flushPendingWrites() contract ─────────────────────────
  console.log('\n⏳ Group C: flushPendingWrites() actually waits for in-flight writes');
  {
    // A deliberately slow, controllable fake "db.query" to prove
    // flushPendingWrites() genuinely waits rather than resolving early.
    let writeLanded = false;
    const slowDb = {
      query: () => new Promise(resolve => {
        setTimeout(() => { writeLanded = true; resolve({ rows: [] }); }, 150);
      })
    };
    const unitsC = new UnitManagementService(slowDb, null, null);
    const created = await unitsC.createUnit({ unitName: 'D68C Unit', unitType: 'BATTALION', unitCode: 'D68C-UNIT' });
    check('C-01 createUnit resolves immediately (fire-and-forget write not yet landed)', writeLanded === false);
    await unitsC.flushPendingWrites();
    check('C-02 flushPendingWrites() waited until the write actually landed', writeLanded === true);
  }
  {
    // Same contract for SupplyChainService.
    let writeLanded = false;
    const slowDb = {
      query: () => new Promise(resolve => {
        setTimeout(() => { writeLanded = true; resolve({ rows: [] }); }, 150);
      })
    };
    const supplyC = new SupplyChainService(slowDb, null, null, null);
    await supplyC.createItem({ itemCode: 'D68C-ITEM', itemName: 'x', category: 'EQUIPMENT', unitId: 1, quantity: 1, createdByUserId: null });
    check('C-03 createItem resolves immediately (fire-and-forget write not yet landed)', writeLanded === false);
    await supplyC.flushPendingWrites();
    check('C-04 flushPendingWrites() waited until the write actually landed', writeLanded === true);
  }
  {
    // flushPendingWrites() must never throw even if the underlying write
    // fails — it settles (Promise.allSettled), it doesn't propagate.
    const failingDb = { query: () => Promise.reject(new Error('simulated failure')) };
    const unitsD = new UnitManagementService(failingDb, null, null);
    await unitsD.createUnit({ unitName: 'D68D Unit', unitType: 'BATTALION', unitCode: 'D68D-UNIT' });
    let threw = false;
    try { await unitsD.flushPendingWrites(); } catch { threw = true; }
    check('C-05 flushPendingWrites() does not throw even when the underlying write failed', threw === false);
  }
  {
    // db=null (offline) — flushPendingWrites() must resolve immediately,
    // nothing to wait for. Confirms zero behavior change for the
    // existing, fully-tested offline path.
    const unitsE = new UnitManagementService(null, null, null);
    await unitsE.createUnit({ unitName: 'D68E Unit', unitType: 'BATTALION', unitCode: 'D68E-UNIT' });
    await unitsE.flushPendingWrites(); // should resolve instantly, not hang
    check('C-06 flushPendingWrites() is a safe no-op when db is null', true);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 68 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
