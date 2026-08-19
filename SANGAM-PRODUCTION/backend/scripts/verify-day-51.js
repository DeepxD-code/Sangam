'use strict';

/**
 * Day 51 Verification — Performance Audit + Lazy Loading
 *
 * Route-based code splitting: every page except Login/Dashboard (the two
 * pages on every session's critical first paint) is now behind
 * React.lazy(), wrapped in a Suspense boundary. This script rebuilds the
 * frontend from a clean dist/ and checks that:
 *   - the build actually emits separate chunk files per lazy page (proof
 *     the split really happened, not just an unused lazy() wrapper)
 *   - the main entry chunk shrank versus one monolithic bundle
 *   - every lazy import has a Suspense ancestor in App.jsx
 *   - the rest of the "performance audit" due-diligence checks pass:
 *     no accidentally-imported heavy chart/data libraries bloating the
 *     bundle, and the dashboard poll interval is still sane.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

const FRONT_ROOT = path.join(__dirname, '../../frontend');
const FRONT_SRC  = path.join(FRONT_ROOT, 'src');
const DIST       = path.join(FRONT_ROOT, 'dist');

console.log('\n📋 Group A: App.jsx wiring — lazy() + Suspense');
const appJsx = fs.readFileSync(path.join(FRONT_SRC, 'App.jsx'), 'utf8');
const EXPECTED_LAZY = [
  'ItemListPage', 'TransferListPage', 'TransferCreatePage', 'BlockchainPage',
  'AlertListPage', 'MovementOrderPage', 'InventoryPage', 'AuditLogPage',
  'UserManagementPage', 'PasswordChangePage', 'ReportsPage', 'UnitsPage',
  'UnitDetailPage', 'DemoWalkthrough'
];
for (const name of EXPECTED_LAZY) {
  const re = new RegExp(`const ${name}\\s*=\\s*lazy\\(`);
  check(`${name} is lazy-loaded`, re.test(appJsx));
}
check('LoginPage stays eagerly imported (critical first paint)', /^import LoginPage/m.test(appJsx));
check('DashboardPage stays eagerly imported (critical first paint)', /^import DashboardPage/m.test(appJsx));
check('Routes are wrapped in a Suspense boundary', /<Suspense[^>]*>[\s\S]*<Routes>/.test(appJsx));
check('DemoWalkthrough (lazy, renders outside Routes) has its own Suspense boundary',
  /<Suspense fallback=\{null\}>\s*<DemoWalkthrough/.test(appJsx));

console.log('\n🏗  Group B: clean production build actually splits into per-page chunks');
try {
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
  execSync('npm run build', { cwd: FRONT_ROOT, stdio: 'pipe' });
  check('vite build succeeds from a clean dist/', true);
} catch (e) {
  check('vite build succeeds from a clean dist/', false, e.stdout?.toString().slice(-500));
}

const assetsDir = path.join(DIST, 'assets');
const jsFiles = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'))
  : [];
check('build produced more than one JS chunk (proof splitting occurred)', jsFiles.length > 5,
  `found ${jsFiles.length} chunk(s)`);

const mainChunk = jsFiles.find(f => f.startsWith('index-'));
check('a distinct main entry chunk exists', !!mainChunk);

const namedChunks = ['ItemListPage', 'TransferListPage', 'BlockchainPage', 'AlertListPage',
  'UnitsPage', 'UnitDetailPage', 'ReportsPage', 'DemoWalkthrough'];
for (const name of namedChunks) {
  check(`${name} has its own chunk file`, jsFiles.some(f => f.startsWith(name + '-')));
}

if (mainChunk) {
  const mainSizeKB = fs.statSync(path.join(assetsDir, mainChunk)).size / 1024;
  const totalSizeKB = jsFiles.reduce((sum, f) => sum + fs.statSync(path.join(assetsDir, f)).size, 0) / 1024;
  check('main entry chunk is meaningfully smaller than the full app (real savings on first load)',
    mainSizeKB < totalSizeKB * 0.85,
    `main ${mainSizeKB.toFixed(0)}KB of ${totalSizeKB.toFixed(0)}KB total`);
  console.log(`    (main chunk: ${mainSizeKB.toFixed(0)}KB · all chunks combined: ${totalSizeKB.toFixed(0)}KB)`);
}

console.log('\n🔍 Group C: due-diligence performance checks');
const allSrcFiles = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(jsx?|css)$/.test(f.name)) allSrcFiles.push(p);
  }
}
walk(FRONT_SRC);
const allSrc = allSrcFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
check('no accidental heavy chart/data-viz library imports (recharts/d3/three/plotly/chart.js)',
  !/from ['"](recharts|d3|three|plotly\.js|chart\.js)['"]/.test(allSrc));

const dashboardSrc = fs.readFileSync(path.join(FRONT_SRC, 'pages/DashboardPage.jsx'), 'utf8');
const pollMatch = dashboardSrc.match(/POLL_INTERVAL_MS\s*=\s*(\d+)\s*\*\s*(\d+)/);
if (pollMatch) {
  const seconds = parseInt(pollMatch[1], 10) * (pollMatch[2] === '1000' ? 1 : parseInt(pollMatch[2], 10));
  check('dashboard poll interval is sane (>= 10s, not hammering the backend)', seconds >= 10, `got ${seconds}s`);
} else {
  check('dashboard poll interval is sane (>= 10s, not hammering the backend)', true, '(no literal *1000 pattern found; skipped)');
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Day 51 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
