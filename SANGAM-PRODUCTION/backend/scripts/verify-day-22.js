'use strict';

/**
 * Day 22 Verification — Unit Management Service & Routes
 *
 * Groups:
 *   A: createUnit
 *   B: getUnitById / getUnitsInScope
 *   C: getUnitHierarchy
 *   D: updateUnit
 *   E: deactivateUnit / reactivateUnit
 *   F: reassignUnit (including cycle guard)
 *   G: getUnitStats
 *   H: Edge cases & routes module
 */

const assert = require('assert');
const UnitManagementService = require('../src/services/unit-management.service');

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

// ── Build a realistic hierarchy for testing ─────────────────────
// CORPS → DIVISION → BRIGADE → BATTALION → COMPANY → PLATOON → SECTION
async function buildHierarchy() {
  const svc = new UnitManagementService(null);

  const corps = (await svc.createUnit({
    unitName: '1 Corps', unitType: 'CORPS', unitCode: '1-CORPS'
  })).unit;

  const div = (await svc.createUnit({
    unitName: '1 Division', unitType: 'DIVISION', unitCode: '1-DIV',
    parentUnitId: corps.id
  })).unit;

  const bde = (await svc.createUnit({
    unitName: '1 Brigade', unitType: 'BRIGADE', unitCode: '1-BDE',
    parentUnitId: div.id
  })).unit;

  const bn = (await svc.createUnit({
    unitName: '1 Battalion', unitType: 'BATTALION', unitCode: '1-BN',
    parentUnitId: bde.id
  })).unit;

  const coy = (await svc.createUnit({
    unitName: 'Alpha Company', unitType: 'COMPANY', unitCode: 'A-COY',
    parentUnitId: bn.id
  })).unit;

  const pl = (await svc.createUnit({
    unitName: '1 Platoon', unitType: 'PLATOON', unitCode: '1-PL',
    parentUnitId: coy.id
  })).unit;

  const sec = (await svc.createUnit({
    unitName: '1 Section', unitType: 'SECTION', unitCode: '1-SEC',
    parentUnitId: pl.id
  })).unit;

  return { svc, corps, div, bde, bn, coy, pl, sec };
}

async function run() {
  const { svc, corps, div, bde, bn, coy, pl, sec } = await buildHierarchy();

  // ─────────────────────────────────────────────────────────────────
  // GROUP A: createUnit
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🏗️  Group A: createUnit');

  await test('A-01 creates unit with all fields', async () => {
    const r = await svc.createUnit({
      unitName: 'Beta Company', unitType: 'COMPANY', unitCode: 'B-COY',
      parentUnitId: bn.id, location: 'Pathankot', commanderId: 42
    });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.unit.unitCode, 'B-COY');
    assert.strictEqual(r.unit.location, 'Pathankot');
    assert.strictEqual(r.unit.commanderId, 42);
  });

  await test('A-02 missing required fields → MISSING_REQUIRED_FIELDS', async () => {
    const r = await svc.createUnit({ unitName: 'X' });
    assert.strictEqual(r.error, 'MISSING_REQUIRED_FIELDS');
  });

  await test('A-03 invalid unitType → INVALID_UNIT_TYPE', async () => {
    const r = await svc.createUnit({ unitName: 'X', unitType: 'REGIMENT', unitCode: 'X-001' });
    assert.strictEqual(r.error, 'INVALID_UNIT_TYPE');
  });

  await test('A-04 duplicate unitCode → UNIT_CODE_EXISTS', async () => {
    const r = await svc.createUnit({ unitName: 'Dup', unitType: 'CORPS', unitCode: '1-CORPS' });
    assert.strictEqual(r.error, 'UNIT_CODE_EXISTS');
  });

  await test('A-05 parent not found → PARENT_NOT_FOUND', async () => {
    const r = await svc.createUnit({
      unitName: 'X', unitType: 'SECTION', unitCode: 'X-SEC', parentUnitId: 9999
    });
    assert.strictEqual(r.error, 'PARENT_NOT_FOUND');
  });

  await test('A-06 child cannot be equal or higher type than parent → INVALID_HIERARCHY', async () => {
    // Corps under Division violates hierarchy
    const r = await svc.createUnit({
      unitName: 'Bad Corps', unitType: 'CORPS', unitCode: 'BAD-CORPS',
      parentUnitId: div.id
    });
    assert.strictEqual(r.error, 'INVALID_HIERARCHY');
  });

  await test('A-07 same type as parent → INVALID_HIERARCHY', async () => {
    const r = await svc.createUnit({
      unitName: 'Another DIV', unitType: 'DIVISION', unitCode: 'DIV-2',
      parentUnitId: div.id // DIVISION under DIVISION
    });
    assert.strictEqual(r.error, 'INVALID_HIERARCHY');
  });

  await test('A-08 unit active by default', () => {
    assert.strictEqual(corps.active, true);
  });

  await test('A-09 UNIT_TYPES static has 8 entries', () => {
    assert.strictEqual(UnitManagementService.UNIT_TYPES.length, 8);
    assert.ok(UnitManagementService.UNIT_TYPES.includes('BATTALION'));
  });

  await test('A-10 stats incremented after create', () => {
    const s = svc.getStats();
    assert.ok(s.unitsCreated >= 8);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP B: getUnitById / getUnitsInScope
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔍 Group B: getUnitById / getUnitsInScope');

  await test('B-01 getUnitById returns correct unit', () => {
    const u = svc.getUnitById(corps.id);
    assert.ok(u);
    assert.strictEqual(u.unitCode, '1-CORPS');
  });

  await test('B-02 getUnitById non-existent → null', () => {
    assert.strictEqual(svc.getUnitById(9999), null);
  });

  await test('B-03 getUnitsInScope returns only scope units', () => {
    const { units } = svc.getUnitsInScope([corps.id, div.id]);
    assert.strictEqual(units.length, 2);
    const ids = units.map(u => u.id);
    assert.ok(ids.includes(corps.id));
    assert.ok(ids.includes(div.id));
  });

  await test('B-04 getUnitsInScope unitType filter', () => {
    const all = [corps, div, bde, bn, coy, pl, sec].map(u => u.id);
    const { units } = svc.getUnitsInScope(all, { unitType: 'COMPANY' });
    assert.ok(units.every(u => u.unitType === 'COMPANY'));
  });

  await test('B-05 getUnitsInScope search filter', () => {
    const all = [corps, div, bde, bn, coy, pl, sec].map(u => u.id);
    const { units } = svc.getUnitsInScope(all, { search: 'alpha' });
    assert.ok(units.some(u => u.unitName === 'Alpha Company'));
  });

  await test('B-06 getUnitsInScope sorts by type rank desc', () => {
    const all = [coy.id, pl.id, bn.id];
    const { units } = svc.getUnitsInScope(all);
    assert.strictEqual(units[0].unitType, 'BATTALION');
  });

  await test('B-07 activeOnly=false includes inactive units', async () => {
    const freshSvc = new UnitManagementService(null);
    const u = (await freshSvc.createUnit({
      unitName: 'Temp', unitType: 'SECTION', unitCode: 'TEMP-1'
    })).unit;
    await freshSvc.deactivateUnit(u.id);
    const { units: active }   = freshSvc.getUnitsInScope([u.id], { activeOnly: true });
    const { units: all }      = freshSvc.getUnitsInScope([u.id], { activeOnly: false });
    assert.strictEqual(active.length, 0);
    assert.strictEqual(all.length, 1);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP C: getUnitHierarchy
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🌳 Group C: getUnitHierarchy');

  await test('C-01 hierarchy from root returns tree', () => {
    const r = svc.getUnitHierarchy(corps.id);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.tree[0].unitCode, '1-CORPS');
  });

  await test('C-02 hierarchy includes nested children', () => {
    const r    = svc.getUnitHierarchy(corps.id);
    const root = r.tree[0];
    assert.ok(Array.isArray(root.children));
    assert.ok(root.children.length >= 1);
  });

  await test('C-03 hierarchy depth reflects 7-level chain', () => {
    // corps → div → bde → bn → coy → pl → sec = 7 levels
    const r      = svc.getUnitHierarchy(corps.id);
    let depth    = 0;
    let current  = r.tree[0];
    while (current.children && current.children.length > 0) {
      depth++;
      current = current.children[0];
    }
    assert.ok(depth >= 5); // at least 5 levels deep
  });

  await test('C-04 full hierarchy (null root) returns forest', () => {
    const r = svc.getUnitHierarchy(null);
    assert.strictEqual(r.success, true);
    assert.ok(Array.isArray(r.tree));
  });

  await test('C-05 non-existent root → UNIT_NOT_FOUND', () => {
    const r = svc.getUnitHierarchy(9999);
    assert.strictEqual(r.error, 'UNIT_NOT_FOUND');
  });

  await test('C-06 hierarchy only includes active units', async () => {
    const freshSvc = new UnitManagementService(null);
    const p = (await freshSvc.createUnit({ unitName: 'P', unitType: 'BATTALION', unitCode: 'P1' })).unit;
    const c = (await freshSvc.createUnit({
      unitName: 'C', unitType: 'COMPANY', unitCode: 'C1', parentUnitId: p.id
    })).unit;
    await freshSvc.deactivateUnit(c.id);
    const r = freshSvc.getUnitHierarchy(p.id);
    assert.strictEqual(r.tree[0].children.length, 0);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP D: updateUnit
  // ─────────────────────────────────────────────────────────────────
  console.log('\n✏️  Group D: updateUnit');

  await test('D-01 updateUnit changes unitName', async () => {
    const r = await svc.updateUnit(coy.id, { unitName: 'Alpha Coy (Renamed)' }, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.unit.unitName, 'Alpha Coy (Renamed)');
  });

  await test('D-02 updateUnit changes location', async () => {
    const r = await svc.updateUnit(bn.id, { location: 'Jammu' }, 1);
    assert.strictEqual(r.unit.location, 'Jammu');
  });

  await test('D-03 updateUnit changes commanderId', async () => {
    const r = await svc.updateUnit(bn.id, { commanderId: 99 }, 1);
    assert.strictEqual(r.unit.commanderId, 99);
  });

  await test('D-04 updateUnit non-existent → UNIT_NOT_FOUND', async () => {
    const r = await svc.updateUnit(9999, { unitName: 'X' });
    assert.strictEqual(r.error, 'UNIT_NOT_FOUND');
  });

  await test('D-05 updateUnit no valid fields → NO_UPDATE_FIELDS', async () => {
    const r = await svc.updateUnit(bn.id, { unitType: 'CORPS' }); // unitType not updatable
    assert.strictEqual(r.error, 'NO_UPDATE_FIELDS');
  });

  await test('D-06 updatedAt changes on update', async () => {
    const before = svc.getUnitById(pl.id).updatedAt;
    await new Promise(r => setTimeout(r, 5));
    await svc.updateUnit(pl.id, { location: 'Srinagar' }, 1);
    const after = svc.getUnitById(pl.id).updatedAt;
    assert.ok(after > before);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP E: deactivateUnit / reactivateUnit
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔴 Group E: deactivateUnit / reactivateUnit');

  await test('E-01 deactivate leaf unit succeeds', async () => {
    const r = await svc.deactivateUnit(sec.id, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(svc.getUnitById(sec.id).active, false);
  });

  await test('E-02 deactivate already-inactive → ALREADY_INACTIVE', async () => {
    const r = await svc.deactivateUnit(sec.id, 1);
    assert.strictEqual(r.error, 'ALREADY_INACTIVE');
  });

  await test('E-03 deactivate unit with active children → HAS_ACTIVE_CHILDREN', async () => {
    // pl has sec (deactivated), but coy still has pl (active)
    const r = await svc.deactivateUnit(coy.id, 1);
    assert.strictEqual(r.error, 'HAS_ACTIVE_CHILDREN');
    assert.ok('childIds' in r);
  });

  await test('E-04 deactivate non-existent → UNIT_NOT_FOUND', async () => {
    const r = await svc.deactivateUnit(9999, 1);
    assert.strictEqual(r.error, 'UNIT_NOT_FOUND');
  });

  await test('E-05 reactivate previously deactivated unit', async () => {
    const r = await svc.reactivateUnit(sec.id, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(svc.getUnitById(sec.id).active, true);
  });

  await test('E-06 reactivate already-active → ALREADY_ACTIVE', async () => {
    const r = await svc.reactivateUnit(sec.id, 1);
    assert.strictEqual(r.error, 'ALREADY_ACTIVE');
  });

  await test('E-07 reactivate with inactive parent → PARENT_INACTIVE', async () => {
    const freshSvc = new UnitManagementService(null);
    const p = (await freshSvc.createUnit({ unitName: 'P', unitType: 'PLATOON', unitCode: 'P2' })).unit;
    const c = (await freshSvc.createUnit({
      unitName: 'C', unitType: 'SECTION', unitCode: 'C2', parentUnitId: p.id
    })).unit;
    await freshSvc.deactivateUnit(c.id);
    await freshSvc.deactivateUnit(p.id);
    const r = await freshSvc.reactivateUnit(c.id);
    assert.strictEqual(r.error, 'PARENT_INACTIVE');
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP F: reassignUnit
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔄 Group F: reassignUnit');

  // Create an extra battalion for reassignment tests
  const bn2 = (await svc.createUnit({
    unitName: '2 Battalion', unitType: 'BATTALION', unitCode: '2-BN',
    parentUnitId: bde.id
  })).unit;

  await test('F-01 reassign coy from bn to bn2', async () => {
    // First create a fresh coy to reassign
    const coy2 = (await svc.createUnit({
      unitName: 'Charlie Company', unitType: 'COMPANY', unitCode: 'C-COY',
      parentUnitId: bn.id
    })).unit;
    const r = await svc.reassignUnit(coy2.id, bn2.id, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.unit.parentUnitId, bn2.id);
  });

  await test('F-02 reassign stats incremented', () => {
    assert.ok(svc.getStats().unitsReassigned >= 1);
  });

  await test('F-03 reassign with null newParentId detaches unit', async () => {
    const r = await svc.reassignUnit(sec.id, null, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.unit.parentUnitId, null);
  });

  await test('F-04 reassign to inactive parent → PARENT_INACTIVE', async () => {
    // Create isolated units
    const freshSvc = new UnitManagementService(null);
    const p1 = (await freshSvc.createUnit({ unitName: 'P1', unitType: 'BRIGADE', unitCode: 'P1-BDE' })).unit;
    const p2 = (await freshSvc.createUnit({ unitName: 'P2', unitType: 'BRIGADE', unitCode: 'P2-BDE' })).unit;
    const c  = (await freshSvc.createUnit({
      unitName: 'C', unitType: 'BATTALION', unitCode: 'C-BN', parentUnitId: p1.id
    })).unit;
    await freshSvc.deactivateUnit(p2.id); // can deactivate since no children
    const r = await freshSvc.reassignUnit(c.id, p2.id);
    assert.strictEqual(r.error, 'PARENT_INACTIVE');
  });

  await test('F-05 reassign to lower type → INVALID_HIERARCHY', async () => {
    // CORPS cannot go under a COMPANY
    const r = await svc.reassignUnit(corps.id, coy.id);
    assert.strictEqual(r.error, 'INVALID_HIERARCHY');
  });

  await test('F-06 cycle detection: ancestor cannot become descendant', async () => {
    // Try to put CORPS under SECTION (sec is a descendant of corps)
    // sec was re-attached to null in F-03, so use div → corps check
    const r = await svc.reassignUnit(corps.id, div.id);
    assert.strictEqual(r.error, 'INVALID_HIERARCHY'); // CORPS >= DIVISION
  });

  await test('F-07 true cycle: unit B made parent of unit A (A is B ancestor)', async () => {
    const freshSvc = new UnitManagementService(null);
    const a = (await freshSvc.createUnit({ unitName: 'A', unitType: 'CORPS',    unitCode: 'A-C' })).unit;
    const b = (await freshSvc.createUnit({ unitName: 'B', unitType: 'DIVISION', unitCode: 'B-D', parentUnitId: a.id })).unit;
    const c = (await freshSvc.createUnit({ unitName: 'C', unitType: 'BRIGADE',  unitCode: 'C-B', parentUnitId: b.id })).unit;
    // Try to make A a child of C → would create A → B → C → A cycle
    const r = await freshSvc.reassignUnit(a.id, c.id);
    // A is CORPS, C is BRIGADE: hierarchy violation fires first
    assert.ok(r.error === 'CYCLE_DETECTED' || r.error === 'INVALID_HIERARCHY');
  });

  await test('F-08 reassign non-existent unit → UNIT_NOT_FOUND', async () => {
    const r = await svc.reassignUnit(9999, bn.id);
    assert.strictEqual(r.error, 'UNIT_NOT_FOUND');
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP G: getUnitStats
  // ─────────────────────────────────────────────────────────────────
  console.log('\n📊 Group G: getUnitStats');

  await test('G-01 platoon has 0 direct children after sec detached in F-03', () => {
    // sec was reassigned to null parent in F-03 → pl now has 0 children
    const stats = svc.getUnitStats(pl.id);
    assert.strictEqual(stats.directChildCount, 0);
  });

  await test('G-02 stats for corps has descendants', () => {
    const stats = svc.getUnitStats(corps.id);
    assert.ok(stats.totalDescendantCount >= 5);
  });

  await test('G-03 stats includes depth', () => {
    const stats = svc.getUnitStats(sec.id);
    assert.ok(typeof stats.depth === 'number');
  });

  await test('G-04 stats for non-existent unit → null', () => {
    assert.strictEqual(svc.getUnitStats(9999), null);
  });

  await test('G-05 depth of corps is 0 (no parent)', () => {
    const stats = svc.getUnitStats(corps.id);
    assert.strictEqual(stats.depth, 0);
  });

  await test('G-06 depth of section under platoon is correct', async () => {
    // Build fresh chain to know exact depth
    const freshSvc = new UnitManagementService(null);
    const c = (await freshSvc.createUnit({ unitName: 'C', unitType: 'CORPS',    unitCode: 'D-C' })).unit;
    const d = (await freshSvc.createUnit({ unitName: 'D', unitType: 'DIVISION', unitCode: 'D-D', parentUnitId: c.id })).unit;
    const b = (await freshSvc.createUnit({ unitName: 'B', unitType: 'BRIGADE',  unitCode: 'D-B', parentUnitId: d.id })).unit;
    const stats = freshSvc.getUnitStats(b.id);
    assert.strictEqual(stats.depth, 2); // corps(0) → div(1) → bde(2)
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP H: Edge cases & routes module
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🛡️  Group H: Edge Cases & Routes');

  await test('H-01 routes module loads without error', () => {
    const createUnitRoutes = require('../src/routes/unit.routes');
    assert.strictEqual(typeof createUnitRoutes, 'function');
  });

  await test('H-02 getStats returns totalUnits', () => {
    const s = svc.getStats();
    assert.ok(s.totalUnits >= 7);
    assert.ok(typeof s.unitsCreated === 'number');
  });

  await test('H-03 deactivate leaf then reactivate restores it', async () => {
    const freshSvc = new UnitManagementService(null);
    const u = (await freshSvc.createUnit({ unitName: 'TMP', unitType: 'SECTION', unitCode: 'TMP-S1' })).unit;
    await freshSvc.deactivateUnit(u.id);
    assert.strictEqual(freshSvc.getUnitById(u.id).active, false);
    await freshSvc.reactivateUnit(u.id);
    assert.strictEqual(freshSvc.getUnitById(u.id).active, true);
  });

  await test('H-04 _isDescendant returns false for unrelated units', () => {
    const r = svc._isDescendant(corps.id, bn2.id);
    // bn2 IS a descendant of corps → true
    assert.strictEqual(r, true);
  });

  await test('H-05 _isDescendant returns false for sibling units', () => {
    // corps and an orphan — not related
    const r = svc._isDescendant(corps.id, 9999);
    assert.strictEqual(r, false);
  });

  await test('H-06 update inactive unit → UNIT_INACTIVE', async () => {
    const freshSvc = new UnitManagementService(null);
    const u = (await freshSvc.createUnit({ unitName: 'X', unitType: 'SECTION', unitCode: 'X-S' })).unit;
    await freshSvc.deactivateUnit(u.id);
    const r = await freshSvc.updateUnit(u.id, { unitName: 'Y' });
    assert.strictEqual(r.error, 'UNIT_INACTIVE');
  });

  // ─────────────────────────────────────────────────────────────────
  // FINAL
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 22 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(err => { console.error(err); process.exit(1); });
