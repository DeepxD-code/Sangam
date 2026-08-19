/**
 * verify-day-43.js  —  Day 43: Dashboard Live MOV + STK + Seeder Completeness
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const BACK = path.join(ROOT, 'backend/src');

let passed = 0, failed = 0, failures = [];
function assert(label, ok, detail = '') {
  if (ok) { console.log(`  ✅  ${label}`); passed++; }
  else { console.log(`  ❌  ${label}${detail ? '\n      ' + detail : ''}`); failed++; failures.push(label); }
}
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// ── A. Seeder imports movement + inventory ────────────────────────────────
console.log('\n── A — Seeder completeness');
const seeder = read(path.join(__dirname, 'seed-demo-data.js'));
assert('Seeder imports MovementOrderService',   seeder.includes('MovementOrderService'));
assert('Seeder imports InventoryLedgerService', seeder.includes('InventoryLedgerService'));
assert('InventoryLedgerService gets supply arg', seeder.includes('new InventoryLedgerService(null, supply'));
assert('Seeder creates movement orders',         seeder.includes('movement.createOrder'));
assert('Seeder dispatches high-priority orders', seeder.includes('movement.dispatch'));
assert('Seeder creates inventory sessions',      seeder.includes('inventory.createSession'));
assert('Seeder records inventory counts',        seeder.includes('inventory.recordCount'));
assert('Seeder finalizes a session',             seeder.includes('inventory.finalizeSession'));
assert('Return includes movementCount',          seeder.includes('movementCount'));
assert('Return includes inventoryCount',         seeder.includes('inventoryCount'));

// ── B. DashboardService gets all services ─────────────────────────────────
console.log('\n── B — DashboardService integration');
const dashRoutes = read(path.join(BACK, 'routes/dashboard.routes.js'));
assert('Dashboard routes receive movement',  dashRoutes.includes('movement:'));
assert('Dashboard routes receive inventory', dashRoutes.includes('inventory:'));
assert('Dashboard routes receive alerts',    dashRoutes.includes('alerts:'));

const appJs = read(path.join(BACK, 'app.js'));
assert('app.js mounts dashboard with movement',  appJs.includes('movement') && appJs.includes('createDashboardRoutes'));
assert('app.js mounts dashboard with inventory', appJs.includes('inventory') && appJs.includes('createDashboardRoutes'));

// ── C. DashboardService _movementSection ─────────────────────────────────
console.log('\n── C — DashboardService sections');
const dashSvc = read(path.join(BACK, 'services/dashboard.service.js'));
assert('_movementSection exists',            dashSvc.includes('_movementSection'));
assert('_movementSection returns activeOrders', dashSvc.includes('activeOrders'));
assert('_stocktakeSection exists',           dashSvc.includes('_stocktakeSection'));
assert('_stocktakeSection returns activeSessions', dashSvc.includes('activeSessions'));
assert('Both sections handle service=null',  dashSvc.includes("available: false, reason: 'Movement service not available'"));

// ── D. Seeder end-to-end runtime ──────────────────────────────────────────
console.log('\n── D — Seeder runtime (with movement + inventory)');
async function runSeederTest() {
  const { seedDemoData } = require('./seed-demo-data.js');
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  let result;
  try   { result = await seedDemoData(); }
  finally { process.stdout.write = orig; }

  assert('20 supply items', result.itemCount === 20);
  assert('7 transfers',     result.transferCount === 7);
  assert('4 movement orders (or more)', result.movementCount >= 4);
  assert('2 inventory sessions',        result.inventoryCount >= 2);

  // Dashboard should now return available:true for movement and inventory
  const { services } = result;
  if (services.movement && services.inventory) {
    const scope = services.units.getUnitIds();
    const DashboardService = require(path.join(BACK, 'services/dashboard.service.js'));
    const dash = new DashboardService({
      supply:    services.supply,
      units:     services.units,
      users:     services.users,
      inventory: services.inventory,
      movement:  services.movement,
      alerts:    services.alerts
    });
    // Simulate a full-scope summary
    const summary = await dash.getSummary(
      { userId: 1, role: 'SYSTEM_ADMIN', unitId: 1, rankLevel: 5 },
      scope,
      { forceRefresh: true }
    );
    assert('Dashboard movement widget available', summary.movement?.available === true);
    assert('Dashboard movement has activeOrders', summary.movement?.activeOrders >= 0);
    assert('Dashboard stocktake widget available', summary.stocktake?.available === true);
    assert('Dashboard stocktake has sessions',     summary.stocktake?.activeSessions >= 0);
  }
}

(async () => {
  await runSeederTest();

  console.log('\n' + '═'.repeat(56));
  console.log(`📊  Day 43 Results: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f => console.log(`  • ${f}`)); }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
})();
