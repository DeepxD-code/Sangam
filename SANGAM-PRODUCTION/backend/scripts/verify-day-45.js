/**
 * verify-day-45.js  —  Day 45: CSV Export + Search Persistence
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
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function exists(p) { return fs.existsSync(p); }

// ── A. useSearchState hook ───────────────────────────────────────────────
console.log('\n── A — useSearchState hook');
const hookPath = path.join(FRONT, 'hooks/useSearchState.js');
assert('hooks/useSearchState.js exists', exists(hookPath));
const hook = read(hookPath);
assert('Reads from sessionStorage',       hook.includes('sessionStorage.getItem'));
assert('Writes to sessionStorage',        hook.includes('sessionStorage.setItem'));
assert('Has sangam: namespace prefix',    hook.includes('sangam:search:'));
assert('Merges stored with defaults',     hook.includes('{ ...defaultState, ...stored }'));
assert('Exports useSearchState',          hook.includes('export function useSearchState'));
assert('Exports clearSearchState',        hook.includes('export function clearSearchState'));
assert('sessionStorage errors caught',    (hook.match(/catch/g) || []).length >= 2);

// ── B. Pages use useSearchState ──────────────────────────────────────────
console.log('\n── B — Pages with persistent filters');
const PAGES_WITH_FILTERS = [
  ['ItemListPage.jsx',    'items'],
  ['TransferListPage.jsx','transfers'],
  ['AlertListPage.jsx',   'alerts'],
];
for (const [page, key] of PAGES_WITH_FILTERS) {
  const src = read(path.join(FRONT, 'pages', page));
  assert(`${page} imports useSearchState`,        src.includes("from '../hooks/useSearchState.js'"));
  assert(`${page} uses useSearchState('${key}')`, src.includes(`useSearchState('${key}'`));
}

// No unused imports
const itemPage = read(path.join(FRONT, 'pages/ItemListPage.jsx'));
assert('ItemListPage has no unused clearSearchState import',
  !itemPage.includes('clearSearchState'));

// ── C. ReportsPage ───────────────────────────────────────────────────────
console.log('\n── C — ReportsPage');
const rp = path.join(FRONT, 'pages/ReportsPage.jsx');
assert('ReportsPage.jsx exists', exists(rp));
const rpSrc = read(rp);
assert('Has 4 report types defined',        (rpSrc.match(/type:/g) || []).length >= 4);
assert('Has stock-levels report',            rpSrc.includes('stock-levels'));
assert('Has transfers report',               rpSrc.includes("'transfers'"));
assert('Has unit-roster report',             rpSrc.includes('unit-roster'));
assert('Has mesh-health report',             rpSrc.includes('mesh-health'));
assert('Has date range inputs',              rpSrc.includes('startDate') && rpSrc.includes('endDate'));
assert('Calls api.exportCSV',                rpSrc.includes('api.exportCSV'));
assert('Shows downloading state',            rpSrc.includes('Downloading'));
assert('Has feedback banner',                rpSrc.includes('feedback-banner'));
assert('Has report-grid CSS class',          rpSrc.includes('report-grid'));

// ── D. API client exportCSV ──────────────────────────────────────────────
console.log('\n── D — API client');
const client = read(path.join(FRONT, 'api/client.js'));
assert('exportCSV exists',                   client.includes('async exportCSV('));
assert('Creates blob for download',          client.includes('res.blob()'));
assert('Creates object URL',                 client.includes('createObjectURL'));
assert('Revokes object URL (no mem leak)',   client.includes('revokeObjectURL'));
assert('Sets download filename',             client.includes('.download ='));
assert('Sends auth header',                  client.includes('Authorization'));

// ── E. Backend export endpoint ───────────────────────────────────────────
console.log('\n── E — Backend');
const repRoutes = read(path.join(BACK, 'routes/reporting.routes.js'));
assert('Export endpoint exists',             repRoutes.includes("'/export/:type'") || repRoutes.includes('export/:type'));
assert('Requires reports:export permission', repRoutes.includes("'reports:export'"));
assert('Returns CSV content-type',           repRoutes.includes('text/csv'));
assert('Sets Content-Disposition header',    repRoutes.includes('Content-Disposition'));
assert('All 4 types handled',                repRoutes.includes('stock-levels') &&
  repRoutes.includes('unit-roster') && repRoutes.includes('mesh-health'));

// ── F. App.jsx routing ───────────────────────────────────────────────────
console.log('\n── F — Routing');
const app = read(path.join(FRONT, 'App.jsx'));
assert('App imports ReportsPage',            app.includes('ReportsPage'));
assert('Route /reports registered',          app.includes("'/reports'") || app.includes('"/reports"'));
assert('Route /profile/password registered', app.includes('/profile/password'));

// ── G. Sidebar REPORTS link ──────────────────────────────────────────────
console.log('\n── G — Sidebar');
const sb = read(path.join(FRONT, 'components/Sidebar.jsx'));
assert('Sidebar has /reports link',          sb.includes("'/reports'") || sb.includes('"/reports"'));
assert('Sidebar has REPORTS label',          sb.includes('REPORTS'));
assert('Sidebar has /profile/password link', sb.includes('/profile/password'));

// ── H. CSS ───────────────────────────────────────────────────────────────
console.log('\n── H — CSS');
const css = read(path.join(FRONT, 'styles/global.css'));
assert('CSS has .report-grid',               css.includes('.report-grid {'));
assert('CSS has .report-card',               css.includes('.report-card {'));
assert('CSS has .report-export-btn',         css.includes('.report-export-btn'));
assert('CSS has .report-date-range',         css.includes('.report-date-range'));
assert('CSS has .report-note',               css.includes('.report-note'));

// ── I. Build ─────────────────────────────────────────────────────────────
console.log('\n── I — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT, 'frontend'), stdio: 'pipe' });
  assert('Vite build succeeds', true);

  const distDir = path.join(ROOT, 'frontend/dist/assets');
  const files = fs.readdirSync(distDir);
  const jsFile  = files.find(f => f.endsWith('.js'));
  const cssFile = files.find(f => f.endsWith('.css'));
  assert('JS bundle present',    !!jsFile);
  assert('CSS bundle present',   !!cssFile);
  const jsSize = fs.statSync(path.join(distDir, jsFile)).size;
  assert('JS bundle < 320KB',    jsSize < 320 * 1024, `${Math.round(jsSize/1024)}KB`);
} catch (e) {
  assert('Vite build succeeds', false, e.stderr?.toString().slice(0, 300));
}

// ── J. Full prior suite still green ──────────────────────────────────────
console.log('\n── J — Prior tests regression check');
try {
  const result = execSync(
    'node backend/scripts/verify-day-40.js && node backend/scripts/verify-day-41.js && node backend/scripts/verify-day-42.js && node backend/scripts/verify-day-43.js && node backend/scripts/verify-day-44.js',
    { cwd: ROOT, stdio: 'pipe' }
  );
  assert('Days 40-44 still pass', true);
} catch (e) {
  assert('Days 40-44 still pass', false, e.stdout?.toString().slice(0, 200));
}

console.log('\n' + '═'.repeat(56));
console.log(`📊  Day 45 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f => console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
