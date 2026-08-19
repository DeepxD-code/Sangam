/**
 * verify-day-40.js  —  Day 40: Full Integration Verification
 *
 * End-to-end check of the complete SANGAM sprint (Days 32–40):
 *   A. Complete backend service layer (17 services)
 *   B. Complete frontend page inventory (11 pages, 6 components)
 *   C. App routing completeness (10 routes)
 *   D. API client completeness (all methods)
 *   E. Seeder end-to-end (creates and validates full dataset)
 *   F. CSS completeness (all critical classes)
 *   G. User object normalization (userId always present)
 *   H. No dead imports (TopBar gone)
 *   I. Production build
 *   J. Scope-contract guards still pass
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT  = path.join(__dirname, '../..');
const FRONT = path.join(ROOT, 'frontend/src');
const BACK  = path.join(ROOT, 'backend/src');

let passed = 0, failed = 0, failures = [];
function assert(label, ok, detail = '') {
  if (ok) { console.log(`  ✅  ${label}`); passed++; }
  else { console.log(`  ❌  ${label}${detail ? '\n      ' + detail : ''}`); failed++; failures.push(label); }
}
function read(p)   { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function exists(p) { return fs.existsSync(p); }

// ── A. Backend services ───────────────────────────────────────────────────
console.log('\n── A — Backend service layer (17 services)');
const SERVICES = [
  'alert-escalation.service.js', 'audit-hardening.service.js', 'audit-log.service.js',
  'auth.service.js', 'bulk-operations.service.js', 'compliance.service.js',
  'dashboard.service.js', 'delegation.service.js', 'inventory-ledger.service.js',
  'movement-order.service.js', 'notification.service.js', 'rate-limiter.service.js',
  'rbac.service.js', 'reporting.service.js', 'supply-chain.service.js',
  'unit-management.service.js', 'user-management.service.js'
];
assert(`All 17 services present`,
  SERVICES.every(s => exists(path.join(BACK, 'services', s))),
  SERVICES.filter(s => !exists(path.join(BACK, 'services', s))).join(', ')
);

// Verify getUnitIds() still on UnitManagementService
const unitSvc = read(path.join(BACK, 'services/unit-management.service.js'));
assert('UnitManagementService.getUnitIds() present', unitSvc.includes('getUnitIds()'));

// Verify server.js uses getUnitIds not _units
const serverJs = read(path.join(BACK, 'server.js'));
assert('server.js uses getUnitIds() (no ._units access)', !serverJs.includes('units._units'));

// Verify audit log route present
const repRoutes = read(path.join(BACK, 'routes/reporting.routes.js'));
assert('Audit log endpoint in reporting routes', repRoutes.includes('/audit-log'));

// ── B. Frontend page + component inventory ────────────────────────────────
console.log('\n── B — Frontend pages and components');
const PAGES = [
  'LoginPage.jsx', 'DashboardPage.jsx', 'ItemListPage.jsx',
  'TransferListPage.jsx', 'TransferCreatePage.jsx', 'BlockchainPage.jsx',
  'AlertListPage.jsx', 'MovementOrderPage.jsx', 'InventoryPage.jsx',
  'AuditLogPage.jsx', 'UserManagementPage.jsx'
];
const COMPONENTS = [
  'Sidebar.jsx', 'Modal.jsx', 'DemoBanner.jsx',
  'Widget.jsx', 'ActivityFeed.jsx', 'BlockchainSeal.jsx'
];
assert(`All 11 pages present`,
  PAGES.every(p => exists(path.join(FRONT, 'pages', p))),
  PAGES.filter(p => !exists(path.join(FRONT, 'pages', p))).join(', ')
);
assert(`All 6 components present`,
  COMPONENTS.every(c => exists(path.join(FRONT, 'components', c))),
  COMPONENTS.filter(c => !exists(path.join(FRONT, 'components', c))).join(', ')
);
assert('TopBar.jsx removed', !exists(path.join(FRONT, 'components/TopBar.jsx')));

// ── C. App routing (10 routes) ────────────────────────────────────────────
console.log('\n── C — App routing completeness');
const appJsx = read(path.join(FRONT, 'App.jsx'));
const ROUTES = [
  '/', '/supply/items', '/supply/transfers', '/supply/transfers/new',
  '/supply/blockchain', '/alerts', '/movement', '/inventory',
  '/audit', '/admin/users'
];
for (const r of ROUTES) {
  assert(`Route "${r}"`, appJsx.includes(`"${r}"`) || appJsx.includes(`'${r}'`));
}
assert('App normalizes userId from login/getMe', appJsx.includes('normalizeUser'));
assert('App polls pendingCount for officers',   appJsx.includes('refreshPending'));

// ── D. API client completeness ────────────────────────────────────────────
console.log('\n── D — API client methods');
const client = read(path.join(FRONT, 'api/client.js'));
const CLIENT_METHODS = [
  'login', 'logout', 'getMe',
  'getDashboardSummary',
  'getSupplyItems', 'getSupplyCategories',
  'getTransfers', 'approveTransfer', 'rejectTransfer', 'createTransfer',
  'getBlockchain', 'verifyBlockchain',
  'getAlerts', 'scanAlerts', 'acknowledgeAlert', 'resolveAlert',
  'getUnits',
  'getMovementOrders', 'createMovementOrder', 'dispatchMovementOrder',
  'deliverMovementOrder', 'cancelMovementOrder',
  'getInventorySessions', 'getActiveInventorySession', 'createInventorySession',
  'recordInventoryCount', 'finalizeInventorySession', 'getInventorySession',
  'getUsers', 'createUser', 'deactivateUser', 'reactivateUser',
  'changeUserRole', 'unlockUser',
  'getAuditLog',
];
for (const m of CLIENT_METHODS) {
  assert(`client.js has ${m}`, client.includes(`async ${m}(`));
}

// ── E. Seeder end-to-end ──────────────────────────────────────────────────
console.log('\n── E — Seeder end-to-end');

async function runSeederTest() {
  const { seedDemoData } = require('./seed-demo-data.js');
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  let result;
  try   { result = await seedDemoData(); }
  finally { process.stdout.write = orig; }

  assert('Seeder: 5 units created',     result && Object.keys(result.unitIds).length === 5);
  assert('Seeder: 5 users created',     result && Object.keys(result.userIds).length === 5);
  assert('Seeder: 20 items created',    result && result.itemCount === 20);
  assert('Seeder: 7 transfers created', result && result.transferCount === 7);

  // Verify getUnitIds on the service created by seeder
  const { services } = result;
  const ids = services.units.getUnitIds();
  assert('Seeder services: getUnitIds() returns 5 IDs', Array.isArray(ids) && ids.length === 5);
}

// ── F. CSS completeness ───────────────────────────────────────────────────
console.log('\n── F — CSS completeness');
const css = read(path.join(FRONT, 'styles/global.css'));
const CSS_CLASSES = [
  // Layout
  '.app-layout', '.app-main', '.sidebar', '.page-content', '.page-title',
  // Sidebar
  '.sidebar-link--active', '.sidebar-badge', '.sidebar-hamburger',
  // Forms
  '.form-label', '.form-input', '.form-select', '.form-textarea',
  '.field-error', '.form-actions', '.input-error',
  // Modals
  '.modal-backdrop', '.modal-panel', '.modal-footer',
  // Buttons
  '.btn-approve', '.btn-reject', '.btn-ghost', '.btn-sm',
  // Feature CSS
  '.movement-list', '.movement-card', '.stocktake-list', '.stocktake-card',
  '.audit-table', '.sev-pill', '.pagination',
  '.demo-banner', '.demo-cred-row',
  '.feedback-banner', '.verify-banner', '.blockchain-list', '.block-card',
  // Login
  '.login-screen', '.login-card', '.login-wordmark',
  // Print
  '@media print',
  // Responsive
  'max-width: 768px', 'max-width: 480px',
];
for (const cls of CSS_CLASSES) {
  assert(`CSS has ${cls}`, css.includes(cls));
}

// ── G. User normalization in App.jsx ──────────────────────────────────────
console.log('\n── G — User object normalization');
assert('normalizeUser handles id→userId', appJsx.includes('userId: u.userId ?? u.id'));
assert('LoginPage uses normalizeUser',    appJsx.includes('normalizeUser(u)'));
assert('getMe uses normalizeUser',        appJsx.includes('normalizeUser(result.user)'));

// ── H. No dead TopBar imports ─────────────────────────────────────────────
console.log('\n── H — No dead TopBar imports');
const ALL_PAGES = [...PAGES, ...COMPONENTS];
for (const f of ALL_PAGES) {
  const dir = PAGES.includes(f) ? 'pages' : 'components';
  const src = read(path.join(FRONT, dir, f));
  assert(`${f}: no "import TopBar"`, !src.includes('import TopBar'));
}

// ── I. Production build ───────────────────────────────────────────────────
console.log('\n── I — Production build');
try {
  execSync('npm run build', { cwd: path.join(ROOT, 'frontend'), stdio: 'pipe' });
  assert('Vite build succeeds', true);

  const distAssets = fs.readdirSync(path.join(ROOT, 'frontend/dist/assets'));
  const jsFile  = distAssets.find(f => f.endsWith('.js'));
  const cssFile = distAssets.find(f => f.endsWith('.css'));
  assert('JS bundle present',  !!jsFile);
  assert('CSS bundle present', !!cssFile);

  const jsSize  = fs.statSync(path.join(ROOT, 'frontend/dist/assets', jsFile)).size;
  const cssSize = fs.statSync(path.join(ROOT, 'frontend/dist/assets', cssFile)).size;
  assert('JS bundle < 300KB (gzip candidate)', jsSize < 300 * 1024);
  assert('CSS bundle < 80KB',                  cssSize < 80  * 1024);
} catch (e) {
  assert('Vite build succeeds', false, e.stderr?.toString().slice(0, 300));
}

// ── J. Scope contract guards ──────────────────────────────────────────────
console.log('\n── J — Scope contract guards');
try {
  execSync('node backend/scripts/verify-scope-contract.js', { cwd: ROOT, stdio: 'pipe' });
  assert('Scope contract guard passes', true);
} catch (e) {
  assert('Scope contract guard passes', false, e.stdout?.toString().slice(0, 200));
}

// ── Run async + summary ───────────────────────────────────────────────────
(async () => {
  await runSeederTest();

  console.log('\n' + '═'.repeat(56));
  console.log(`📊  Day 40 Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n⚠️   Failed tests:');
    failures.forEach(f => console.log(`  • ${f}`));
  } else {
    console.log('\n  🎖  SANGAM Days 32–40 — ALL SYSTEMS GREEN');
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
})();
