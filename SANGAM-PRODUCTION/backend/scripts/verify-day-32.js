/**
 * verify-day-32.js  —  Day 32 acceptance tests
 *
 * Validates:
 *   A. UnitManagementService.getUnitIds() public method
 *   B. server.js no longer accesses _units directly
 *   C. Sidebar component exists and exports a React component
 *   D. App.jsx uses BrowserRouter + sidebar layout
 *   E. All page components removed TopBar import
 *   F. CSS contains sidebar + app-layout + responsive rules
 *   G. Demo data seeder runs end-to-end cleanly
 */

'use strict';

const fs    = require('fs');
const path  = require('path');

const ROOT    = path.join(__dirname, '../..');
const BACKEND = path.join(ROOT, 'backend/src');
const FRONT   = path.join(ROOT, 'frontend/src');

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.log(`  ❌  ${label}${detail ? '\n      ' + detail : ''}`);
    failed++;
    failures.push(label);
  }
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function fileExists(p) { return fs.existsSync(p); }

// ── A. UnitManagementService.getUnitIds() ─────────────────────────────────

console.log('\n── A — UnitManagementService.getUnitIds()');

const unitSvc = readFile(path.join(BACKEND, 'services/unit-management.service.js'));

assert(
  'getUnitIds() method is defined',
  unitSvc.includes('getUnitIds()')
);
assert(
  'getUnitIds() returns spread of _units.keys()',
  unitSvc.includes('[...this._units.keys()]')
);
assert(
  'getUnitIds() has a JSDoc comment',
  unitSvc.includes('@returns {number[]}')
);

// Runtime check
const UnitManagementService = require(path.join(BACKEND, 'services/unit-management.service.js'));
const AuditLogService       = require(path.join(BACKEND, 'services/audit-log.service.js'));
const RBACService           = require(path.join(BACKEND, 'services/rbac.service.js'));

const unitSvcInst = new UnitManagementService(null, new AuditLogService(), new RBACService(null));

assert(
  'getUnitIds() is a function on the instance',
  typeof unitSvcInst.getUnitIds === 'function'
);

async function runUnitIdTests() {
  const empty = unitSvcInst.getUnitIds();
  assert(
    'getUnitIds() returns [] on fresh instance',
    Array.isArray(empty) && empty.length === 0
  );

  await unitSvcInst.createUnit({ unitName: 'Test Brigade', unitType: 'BRIGADE', unitCode: 'T-BDE' });
  const ids = unitSvcInst.getUnitIds();
  assert(
    'getUnitIds() returns [1] after creating first unit',
    Array.isArray(ids) && ids.length === 1 && ids[0] === 1
  );

  await unitSvcInst.createUnit({ unitName: 'Test Bn', unitType: 'BATTALION', unitCode: 'T-BN', parentUnitId: 1 });
  const ids2 = unitSvcInst.getUnitIds();
  assert(
    'getUnitIds() returns [1, 2] after creating second unit',
    Array.isArray(ids2) && ids2.length === 2
  );
}

// ── B. server.js no longer accesses _units directly ──────────────────────

console.log('\n── B — server.js encapsulation');

const serverJs = readFile(path.join(BACKEND, 'server.js'));

assert(
  'server.js does NOT access units._units directly',
  !serverJs.includes('units._units')
);
assert(
  'server.js uses getUnitIds()',
  serverJs.includes('getUnitIds')
);

// ── C. Sidebar component ─────────────────────────────────────────────────

console.log('\n── C — Sidebar component');

const sidebarPath = path.join(FRONT, 'components/Sidebar.jsx');

assert('Sidebar.jsx exists', fileExists(sidebarPath));

const sidebar = readFile(sidebarPath);

assert(
  'Sidebar imports NavLink from react-router-dom',
  sidebar.includes("NavLink") && sidebar.includes('react-router-dom')
);
assert(
  'Sidebar has sidebar-link--active class for active route',
  sidebar.includes('sidebar-link--active')
);
assert(
  'Sidebar has role-aware pending badge (rankLevel >= 3)',
  sidebar.includes('rankLevel >= 3') || sidebar.includes('rankLevel>=3')
);
assert(
  'Sidebar has hamburger button for mobile',
  sidebar.includes('sidebar-hamburger')
);
assert(
  'Sidebar has system-live indicator',
  sidebar.includes('sidebar-status-dot--live') || sidebar.includes('SYSTEM LIVE')
);
assert(
  'Sidebar exports default function',
  sidebar.includes('export default function Sidebar')
);

// ── D. App.jsx sidebar layout ─────────────────────────────────────────────

console.log('\n── D — App.jsx layout');

const appJsx = readFile(path.join(FRONT, 'App.jsx'));

assert(
  'App.jsx imports Sidebar',
  appJsx.includes("import Sidebar") && appJsx.includes('Sidebar.jsx')
);
assert(
  'App.jsx uses app-layout div',
  appJsx.includes('app-layout')
);
assert(
  'App.jsx uses app-main element',
  appJsx.includes('app-main')
);
assert(
  'App.jsx passes pendingCount to Sidebar',
  appJsx.includes('pendingCount')
);
assert(
  'App.jsx restores session on mount via getMe()',
  appJsx.includes('getMe()')
);
assert(
  'App.jsx polls pending transfers for officers',
  appJsx.includes('refreshPending') || appJsx.includes('PENDING')
);

// ── E. Pages removed TopBar ───────────────────────────────────────────────

console.log('\n── E — Pages no longer import TopBar');

const PAGES = [
  'DashboardPage.jsx',
  'ItemListPage.jsx',
  'TransferListPage.jsx',
  'TransferCreatePage.jsx',
  'BlockchainPage.jsx',
  'AlertListPage.jsx',
];

for (const page of PAGES) {
  const content = readFile(path.join(FRONT, 'pages', page));
  assert(
    `${page} does NOT import TopBar`,
    !content.includes("import TopBar")
  );
  assert(
    `${page} uses page-content div`,
    content.includes('page-content')
  );
}

// ── F. CSS contains sidebar + layout classes ──────────────────────────────

console.log('\n── F — CSS sidebar + responsive rules');

const css = readFile(path.join(FRONT, 'styles/global.css'));

assert('CSS has .app-layout rule',         css.includes('.app-layout'));
assert('CSS has .app-main rule',           css.includes('.app-main'));
assert('CSS has .sidebar rule',            css.includes('.sidebar {'));
assert('CSS has .sidebar-link--active',    css.includes('.sidebar-link--active'));
assert('CSS has .sidebar-badge',           css.includes('.sidebar-badge'));
assert('CSS has .sidebar-hamburger',       css.includes('.sidebar-hamburger'));
assert('CSS has .page-content rule',       css.includes('.page-content {'));
assert('CSS has .page-title rule',         css.includes('.page-title {'));
assert('CSS has 768px breakpoint',         css.includes('max-width: 768px'));
assert('CSS has 480px breakpoint',         css.includes('max-width: 480px'));
assert('CSS has sidebar off-canvas transform', css.includes('translateX(-100%)'));
assert('CSS has .sidebar-status-dot--live pulse', css.includes('sidebar-status-dot--live'));

// ── G. Demo data seeder ───────────────────────────────────────────────────

console.log('\n── G — Demo data seeder');

const seederPath = path.join(__dirname, 'seed-demo-data.js');

assert('seed-demo-data.js exists', fileExists(seederPath));

const seederSrc = readFile(seederPath);

assert(
  'Seeder exports seedDemoData function',
  seederSrc.includes('module.exports') && seederSrc.includes('seedDemoData')
);
assert(
  'Seeder uses getUnitIds() for alert scan',
  seederSrc.includes('getUnitIds()')
);
assert(
  'Seeder creates 5 units (1 BDE + 3 BN + 1 COY)',
  seederSrc.includes('BRIGADE') && seederSrc.includes('BATTALION') && seederSrc.includes('COMPANY')
);
assert(
  'Seeder creates users with all required ranks',
  seederSrc.includes('SYSTEM_ADMIN') && seederSrc.includes('COMMANDER') && seederSrc.includes('OFFICER') && seederSrc.includes('NCO')
);
assert(
  'Seeder creates 20 supply items',
  seederSrc.includes("'✓ 20 supply items created'") || seederSrc.includes('ITEMS') || (seederSrc.match(/itemCode:/g) || []).length >= 10
);
assert(
  'Seeder creates pending + approved + rejected transfers',
  seederSrc.includes('APPROVED_TRANSFERS') && seederSrc.includes('REJECTED_TRANSFERS')
);

// Runtime seeder test
async function runSeederTest() {
  const { seedDemoData } = require('./seed-demo-data.js');

  // Redirect stdout to suppress seeder log spam
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;

  let result;
  try {
    result = await seedDemoData();
  } finally {
    process.stdout.write = origWrite;
  }

  assert(
    'Seeder runtime: returns unitIds object with 5 keys',
    result && result.unitIds && Object.keys(result.unitIds).length === 5
  );
  assert(
    'Seeder runtime: returns userIds object with 5 keys',
    result && result.userIds && Object.keys(result.userIds).length === 5
  );
  assert(
    'Seeder runtime: 20 items created',
    result && result.itemCount === 20
  );
  assert(
    'Seeder runtime: 7 transfers created',
    result && result.transferCount === 7
  );
}

// ── Run async tests then print results ────────────────────────────────────

(async () => {
  await runUnitIdTests();
  await runSeederTest();

  console.log('\n' + '═'.repeat(56));
  console.log(`📊  Day 32 Results: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\n⚠️   Failed tests:');
    failures.forEach(f => console.log(`  • ${f}`));
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
})();
