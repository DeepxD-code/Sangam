'use strict';

/**
 * Day 67 Verification — SQL command_units Integrity
 *
 * Background: this project's migration seed and its runtime demo seeder
 * (seed-demo-data.js) both independently assigned command_units ids
 * starting at 1 for two entirely unrelated 12-/N-unit hierarchies.
 * UnitManagementService._dbWrite()'s `ON CONFLICT (id) DO UPDATE`
 * silently overwrote the migration's rows with the runtime seeder's
 * data on a subset of columns, producing self-contradictory rows (e.g.
 * unit_code='CORPS-21' paired with unit_name='14 RAJPUTANA RIFLES
 * BRIGADE') on the very first real Postgres run. Proven via pg-mem
 * against real production code before this fix existed.
 *
 * This also surfaced a second, related gap while reading the same
 * code: updateUnit/deactivateUnit/reactivateUnit/reassignUnit never
 * called _dbWrite() at all, so SQL never reflected any change made
 * after a unit's creation. Both are fixed as of this day.
 *
 * Because no live Postgres is reachable in this sandbox, this script
 * uses pg-mem (an in-memory Postgres engine with real SQL parsing —
 * SERIAL, ON CONFLICT, foreign keys) to run the project's actual
 * production code (app.js, seed-demo-data.js, UnitManagementService,
 * RBACService) against something that behaves like real Postgres for
 * everything EXCEPT recursive CTEs, which pg-mem does not implement at
 * all (confirmed directly from its own error message — see Group C).
 * For everything pg-mem does support, this is also, not incidentally,
 * the first time ANY test in this project's history exercises the
 * db!=null code path — every one of the 1,949 Day-66 assertions runs
 * with db=null.
 *
 *   A. Fixed migration DDL + real seed-demo-data.js → SQL exactly
 *      matches in-memory data; no orphaned/mismatched rows.
 *   B. _dbWrite round-trip for create/update/deactivate/reactivate/
 *      reassign — each checked directly against SQL. Genuinely
 *      verified, first-ever coverage of this path.
 *   C. RBACService.getCommandScope()'s SQL branch — HONESTLY SCOPED:
 *      the actual recursive-CTE hierarchy expansion cannot be executed
 *      here (pg-mem limitation, not a project bug — see the in-line
 *      note). What IS verified: the query is reached (not skipped by
 *      the db=null branch) and getCommandScope() degrades gracefully
 *      to self-only when the query fails, rather than crashing. The
 *      CTE's actual correctness rests on manual syntax review against
 *      standard PostgreSQL recursive-CTE form, flagged as a real,
 *      open item to smoke-test against genuine Postgres before a demo.
 *   D. Restart/reseed idempotency — a second, fresh in-memory service
 *      re-seeding against the same underlying database stays clean.
 */

const { newDb } = require('pg-mem');
const fs         = require('fs');
const path       = require('path');
const createApp  = require('../src/app');
const RBACService           = require('../src/services/rbac.service');
const UnitManagementService = require('../src/services/unit-management.service');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

// command_units DDL, extracted verbatim (structure only — no seed rows,
// matching the fixed day-13-rbac-schema.sql) so this test doesn't depend
// on pg-mem's ability to parse the rest of the schema (it can't currently
// parse an unrelated plpgsql DO block and a view in other migration
// files — a pg-mem tooling limitation, not a project bug; confirmed by
// isolating exactly which statement it choked on).
const COMMAND_UNITS_DDL = `
CREATE TABLE command_units (
  id             SERIAL       PRIMARY KEY,
  unit_name      VARCHAR(100) NOT NULL,
  unit_type      VARCHAR(30)  NOT NULL
    CHECK (unit_type IN ('SECTION','PLATOON','COMPANY','BATTALION',
                         'BRIGADE','DIVISION','CORPS','COMMAND')),
  unit_code      VARCHAR(20)  UNIQUE NOT NULL,
  parent_unit_id INTEGER      REFERENCES command_units(id),
  commander_id   INTEGER,
  location       VARCHAR(100),
  active         BOOLEAN      NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
`;

function freshPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

async function run() {

  // ── Group A: fixed migration + real seed-demo-data.js ────────────
  console.log('\n🗄️  Group A: post-fix migration + real runtime seed → SQL consistency');
  const poolA = freshPgMemPool();
  await poolA.query(COMMAND_UNITS_DDL);

  const appA = createApp(poolA, {}, { logLevel: false });
  const { seedDemoData } = require('../scripts/seed-demo-data.js');
  await seedDemoData(appA.locals.services);

  const sqlRowsA = (await poolA.query('SELECT id, unit_code, unit_name, unit_type, parent_unit_id, active FROM command_units ORDER BY id')).rows;
  const memUnitsA = appA.locals.services.units.getUnitsInScope(
    sqlRowsA.map(r => r.id), { activeOnly: false }
  ).units;

  check('A-01 SQL row count matches in-memory unit count exactly', sqlRowsA.length === memUnitsA.length, `SQL=${sqlRowsA.length} memory=${memUnitsA.length}`);

  let allConsistent = true;
  for (const row of sqlRowsA) {
    const mem = memUnitsA.find(u => u.id === row.id);
    if (!mem || mem.unitCode !== row.unit_code || mem.unitName !== row.unit_name || mem.unitType !== row.unit_type) {
      allConsistent = false;
      console.error(`     mismatch at id=${row.id}: SQL(code=${row.unit_code}, name=${row.unit_name}) vs memory(code=${mem?.unitCode}, name=${mem?.unitName})`);
    }
  }
  check('A-02 every SQL row is fully consistent with its in-memory counterpart (no Frankenstein rows)', allConsistent);
  check('A-03 no leftover "21 Corps" rows from the old colliding seed', !sqlRowsA.some(r => r.unit_code === 'CORPS-21'));

  // ── Group B: _dbWrite round-trip for every mutating operation ────
  console.log('\n🔄 Group B: _dbWrite round-trip (create/update/deactivate/reactivate/reassign)');
  const poolB = freshPgMemPool();
  await poolB.query(COMMAND_UNITS_DDL);
  const unitsB = new UnitManagementService(poolB, null, null);

  const root  = (await unitsB.createUnit({ unitName: 'D67 Root',  unitType: 'BRIGADE',   unitCode: 'D67-ROOT' })).unit;
  const child = (await unitsB.createUnit({ unitName: 'D67 Child', unitType: 'BATTALION', unitCode: 'D67-CHILD', parentUnitId: root.id })).unit;
  // _dbWrite is fire-and-forget (best-effort, .catch(()=>{})); give the
  // microtask queue a tick so the INSERT lands before we query it back.
  await new Promise(r => setTimeout(r, 20));

  {
    const rows = (await poolB.query('SELECT * FROM command_units WHERE id = $1', [root.id])).rows;
    check('B-01 createUnit → row exists in SQL', rows.length === 1);
    check('B-02 createUnit → unit_name matches', rows[0]?.unit_name === 'D67 Root');
  }
  {
    await unitsB.updateUnit(root.id, { unitName: 'D67 Root Renamed', location: 'Siachen Base Camp' });
    await new Promise(r => setTimeout(r, 20));
    const row = (await poolB.query('SELECT unit_name, location FROM command_units WHERE id = $1', [root.id])).rows[0];
    check('B-03 updateUnit now syncs to SQL (was previously never called)', row?.unit_name === 'D67 Root Renamed' && row?.location === 'Siachen Base Camp');
  }
  {
    const d = await unitsB.deactivateUnit(child.id);
    check('B-04 deactivateUnit succeeds (leaf, no children)', d.success === true);
    await new Promise(r => setTimeout(r, 20));
    const row = (await poolB.query('SELECT active FROM command_units WHERE id = $1', [child.id])).rows[0];
    check('B-05 deactivateUnit now syncs active=false to SQL (was previously never called)', row?.active === false);
  }
  {
    const r = await unitsB.reactivateUnit(child.id);
    check('B-06 reactivateUnit succeeds', r.success === true);
    await new Promise(r2 => setTimeout(r2, 20));
    const row = (await poolB.query('SELECT active FROM command_units WHERE id = $1', [child.id])).rows[0];
    check('B-07 reactivateUnit now syncs active=true to SQL (was previously never called)', row?.active === true);
  }
  {
    const grandchild = (await unitsB.createUnit({ unitName: 'D67 GC', unitType: 'COMPANY', unitCode: 'D67-GC', parentUnitId: child.id })).unit;
    await new Promise(r => setTimeout(r, 20));
    const reassignResult = await unitsB.reassignUnit(grandchild.id, root.id);
    check('B-08 reassignUnit succeeds (COMPANY can be a direct child of BRIGADE)', reassignResult.success === true, JSON.stringify(reassignResult));
    await new Promise(r => setTimeout(r, 20));
    const row = (await poolB.query('SELECT parent_unit_id FROM command_units WHERE id = $1', [grandchild.id])).rows[0];
    check('B-09 reassignUnit now syncs parent_unit_id to SQL (was previously never called, and previously excluded from the UPDATE SET list even if it had been)', row?.parent_unit_id === root.id);
  }
  {
    // unit_type and unit_code must remain immutable in SQL even after
    // all the above writes — confirms the deliberate exclusion still holds.
    const row = (await poolB.query('SELECT unit_type, unit_code FROM command_units WHERE id = $1', [root.id])).rows[0];
    check('B-10 unit_type/unit_code remain untouched by updates (deliberately immutable)', row?.unit_type === 'BRIGADE' && row?.unit_code === 'D67-ROOT');
  }

  // ── Group C: the SQL recursive-CTE path of getCommandScope() ─────
  console.log('\n🌲 Group C: RBACService.getCommandScope() SQL path — honest scope');
  // IMPORTANT — read before extending this group: pg-mem cannot execute
  // recursive CTEs at all. Confirmed directly from pg-mem itself:
  //   "🔨 Not supported 🔨 : recursirve with statements not implemented by pg-mem"
  // (checked on the latest available version, 3.0.14 — no newer version
  // exists to try). This was verified in isolation with a minimal 4-row
  // parent/child table before concluding anything about SANGAM's own SQL,
  // to make sure this was pg-mem's limitation and not a project bug.
  //
  // Consequence, stated plainly: this script does NOT execute or prove
  // correct RBACService.getCommandScope()'s actual recursive CTE. That
  // specific piece of logic remains verified only by manual review
  // against standard PostgreSQL recursive-CTE syntax (anchor member,
  // UNION ALL, recursive member referencing the CTE name in a JOIN —
  // the CTE in rbac.service.js follows this textbook pattern exactly,
  // with no exotic or version-specific syntax), NOT by automated
  // execution. It has never been run against a real Postgres server —
  // that remains a genuine, open gap, flagged as a Day 68+ action item:
  // smoke-test this specific query the first time this project is ever
  // run against real docker-compose Postgres, before relying on it for
  // an actual demo.
  //
  // What IS genuinely, empirically verified below: the graceful-
  // degradation path when this query fails — confirmed for real by
  // watching getCommandScope() catch pg-mem's actual thrown error
  // during initial test development and correctly fall back to
  // self-only rather than crashing or hanging.
  const poolC = freshPgMemPool();
  await poolC.query(COMMAND_UNITS_DDL);
  const unitsC = new UnitManagementService(poolC, null, null);
  const hq = (await unitsC.createUnit({ unitName: 'D67C HQ', unitType: 'CORPS', unitCode: 'D67C-HQ' })).unit;
  await new Promise(r => setTimeout(r, 20));

  {
    const rbac = new RBACService(poolC);
    // poolC genuinely has a `db` (truthy), so this exercises the !db===false
    // branch and reaches the real query() call — it just can't complete
    // due to pg-mem's recursive-CTE limitation, not a mock/stub shortcut.
    const scope = await rbac.getCommandScope(hq.id, poolC);
    check('C-01 when the SQL query throws (pg-mem: recursive CTE unsupported), getCommandScope degrades gracefully to self-only rather than throwing/hanging', scope.ids.length === 1 && scope.ids[0] === hq.id, `got ${JSON.stringify(scope)}`);
    check('C-02 graceful-degradation result has the correct {ids, codes} shape', Array.isArray(scope.ids) && Array.isArray(scope.codes));
  }
  console.log('  ℹ️  C-03 SKIPPED (documented, not silently omitted): full recursive-CTE');
  console.log('      hierarchy expansion cannot be executed in this sandbox — no tool');
  console.log('      available here supports it. Verified by manual syntax review only.');
  console.log('      Action item carried to the Day 67 handoff notes: smoke-test');
  console.log('      RBACService.getCommandScope() against a real Postgres instance');
  console.log('      (e.g. via `docker-compose up db` locally) before the actual demo.');

  // ── Group D: restart/reseed idempotency ───────────────────────────
  console.log('\n🔁 Group D: restart simulation — reseeding against the same DB stays clean');
  const poolD = freshPgMemPool();
  await poolD.query(COMMAND_UNITS_DDL);

  const app1 = createApp(poolD, {}, { logLevel: false });
  await seedDemoData(app1.locals.services);
  const countAfterFirst = (await poolD.query('SELECT COUNT(*)::int AS n FROM command_units')).rows[0].n;

  // Simulate a server restart: a brand-new app/in-memory-service instance
  // (fresh Map, ids starting at 1 again) reseeding against the SAME
  // underlying Postgres.
  const app2 = createApp(poolD, {}, { logLevel: false });
  await seedDemoData(app2.locals.services);
  const countAfterSecond = (await poolD.query('SELECT COUNT(*)::int AS n FROM command_units')).rows[0].n;

  check('D-01 reseeding after a simulated restart does not duplicate rows', countAfterFirst === countAfterSecond, `first=${countAfterFirst} second=${countAfterSecond}`);

  const rowsD = (await poolD.query('SELECT id, unit_code, unit_name FROM command_units ORDER BY id')).rows;
  const memD  = app2.locals.services.units.getUnitsInScope(rowsD.map(r => r.id), { activeOnly: false }).units;
  const stillConsistent = rowsD.every(row => {
    const mem = memD.find(u => u.id === row.id);
    return mem && mem.unitCode === row.unit_code && mem.unitName === row.unit_name;
  });
  check('D-02 SQL still fully consistent with in-memory after the simulated restart', stillConsistent);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 67 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
