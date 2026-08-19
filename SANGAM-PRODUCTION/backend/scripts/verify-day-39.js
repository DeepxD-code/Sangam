/**
 * verify-day-39.js  —  Day 39: Demo Banner + Print Styles
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT  = path.join(__dirname, '../..');
const FRONT = path.join(ROOT, 'frontend/src');

let passed = 0, failed = 0, failures = [];
function assert(label, ok, detail='') {
  if (ok) { console.log(`  ✅  ${label}`); passed++; }
  else { console.log(`  ❌  ${label}${detail?'\n      '+detail:''}`); failed++; failures.push(label); }
}
function read(p) { try { return fs.readFileSync(p,'utf8'); } catch { return ''; } }
function exists(p) { return fs.existsSync(p); }

// ── A. DemoBanner component ───────────────────────────────────────────────
console.log('\n── A — DemoBanner component');
const db = path.join(FRONT,'components/DemoBanner.jsx');
assert('DemoBanner.jsx exists', exists(db));
const dbc = read(db);
assert('Has isDemoUser export',         dbc.includes('export function isDemoUser'));
assert('Has DEMO_USERS list',           dbc.includes('DEMO_USERS'));
assert('Has 5 demo users',             (dbc.match(/user:/g)||[]).length >= 5);
assert('Has collapsible toggle',        dbc.includes('expanded'));
assert('Has credential rows',           dbc.includes('demo-cred-row'));
assert('Active user highlighted',       dbc.includes('demo-cred-active'));
assert('Exports default DemoBanner',    dbc.includes('export default function DemoBanner'));

// ── B. Sidebar integration ────────────────────────────────────────────────
console.log('\n── B — Sidebar DemoBanner');
const sb = read(path.join(FRONT,'components/Sidebar.jsx'));
assert('Sidebar imports DemoBanner',    sb.includes("import DemoBanner"));
assert('Sidebar renders <DemoBanner',   sb.includes('<DemoBanner'));
assert('DemoBanner receives user prop', sb.includes('user={user}'));

// ── C. CSS ────────────────────────────────────────────────────────────────
console.log('\n── C — CSS');
const css = read(path.join(FRONT,'styles/global.css'));
assert('CSS has .demo-banner',          css.includes('.demo-banner {'));
assert('CSS has .demo-banner-toggle',   css.includes('.demo-banner-toggle'));
assert('CSS has .demo-creds',           css.includes('.demo-creds {'));
assert('CSS has .demo-cred-row',        css.includes('.demo-cred-row'));
assert('CSS has @media print',          css.includes('@media print'));
assert('Print hides sidebar',           css.includes('.sidebar') && css.includes('@media print'));
assert('CSS has .feedback-banner',      css.includes('.feedback-banner {'));
assert('CSS has .verify-banner',        css.includes('.verify-banner {'));
assert('CSS has .blockchain-list',      css.includes('.blockchain-list {'));
assert('CSS has .block-card',           css.includes('.block-card {'));

// ── D. Full component inventory ───────────────────────────────────────────
console.log('\n── D — Component inventory');
const COMPONENTS = ['Modal.jsx','Sidebar.jsx','DemoBanner.jsx',
  'Widget.jsx','ActivityFeed.jsx','BlockchainSeal.jsx'];
for (const c of COMPONENTS) {
  assert(`${c} exists`, exists(path.join(FRONT,'components',c)));
}

const PAGES = ['LoginPage.jsx','DashboardPage.jsx','ItemListPage.jsx',
  'TransferListPage.jsx','TransferCreatePage.jsx','BlockchainPage.jsx',
  'AlertListPage.jsx','MovementOrderPage.jsx','InventoryPage.jsx',
  'AuditLogPage.jsx','UserManagementPage.jsx'];
for (const p of PAGES) {
  assert(`${p} exists`, exists(path.join(FRONT,'pages',p)));
}

// ── E. Build ──────────────────────────────────────────────────────────────
console.log('\n── E — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT,'frontend'), stdio:'pipe' });
  assert('Vite build succeeds', true);
  assert('dist/index.html exists', exists(path.join(ROOT,'frontend/dist/index.html')));
  const js = fs.readdirSync(path.join(ROOT,'frontend/dist/assets'))
    .filter(f => f.endsWith('.js'));
  assert('JS bundle produced', js.length > 0);
  const css2 = fs.readdirSync(path.join(ROOT,'frontend/dist/assets'))
    .filter(f => f.endsWith('.css'));
  assert('CSS bundle produced', css2.length > 0);
} catch(e) { assert('Vite build succeeds', false, e.stderr?.toString().slice(0,300)); }

console.log('\n'+'═'.repeat(56));
console.log(`📊  Day 39 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f=>console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
