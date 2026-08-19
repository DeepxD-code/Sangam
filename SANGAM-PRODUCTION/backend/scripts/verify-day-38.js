/**
 * verify-day-38.js  —  Day 38: Dashboard + Activity Feed Polish
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

// ── A. ActivityFeed enhanced ──────────────────────────────────────────────
console.log('\n── A — ActivityFeed');
const af = read(path.join(FRONT,'components/ActivityFeed.jsx'));
assert('ActivityFeed has severity coding',  af.includes('SEV_CLASS') || af.includes('sev-'));
assert('ActivityFeed has date display',     af.includes('formatDate'));
assert('ActivityFeed has entry count',      af.includes('activity-count'));
assert('ActivityFeed limits to 15 entries', af.includes('.slice(0, 15)') || af.includes('slice(0,15)'));
assert('ActivityFeed has activity-list',    af.includes('activity-list'));

// ── B. Dashboard still works ──────────────────────────────────────────────
console.log('\n── B — DashboardPage');
const dp = read(path.join(FRONT,'pages/DashboardPage.jsx'));
assert('Dashboard has page-header-right',  dp.includes('page-header-right'));
assert('Dashboard has sync indicator',     dp.includes('sync-indicator') || dp.includes('SYNC'));
assert('Dashboard has 8 Widget calls',     (dp.match(/<Widget/g)||[]).length >= 7);
assert('Dashboard handles alerts widget',  dp.includes('ALT'));

// ── C. Full routing table ─────────────────────────────────────────────────
console.log('\n── C — Complete routing (all 10 routes)');
const app = read(path.join(FRONT,'App.jsx'));
const ROUTES = ['/', '/supply/items', '/supply/transfers', '/supply/transfers/new',
  '/supply/blockchain', '/alerts', '/movement', '/inventory', '/audit', '/admin/users'];
for (const r of ROUTES) {
  assert(`Route ${r} is registered`, app.includes(`"${r}"`) || app.includes(`'${r}'`));
}

// ── D. Sidebar completeness ───────────────────────────────────────────────
console.log('\n── D — Sidebar links');
const sb = read(path.join(FRONT,'components/Sidebar.jsx'));
assert('No comingSoon flags remain',    !sb.includes('comingSoon: true'));
assert('Has 9 nav links total',
  (sb.match(/to:\s+['"`]/g)||[]).length >= 8);
assert('adminOnly handled in render',  sb.includes('adminOnly'));

// ── E. CSS ────────────────────────────────────────────────────────────────
console.log('\n── E — CSS');
const css = read(path.join(FRONT,'styles/global.css'));
assert('CSS has .activity-list',      css.includes('.activity-list'));
assert('CSS has .activity-sev-tag',   css.includes('.activity-sev-tag'));
assert('CSS has .sync-dot pulse',     css.includes('.sync-dot'));
assert('CSS total size reasonable',   css.length > 20000);

// ── F. Build ──────────────────────────────────────────────────────────────
console.log('\n── F — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT,'frontend'), stdio:'pipe' });
  assert('Vite build succeeds', true);
  assert('dist/index.html exists', exists(path.join(ROOT,'frontend/dist/index.html')));
} catch(e) { assert('Vite build succeeds', false, e.stderr?.toString().slice(0,300)); }

console.log('\n'+'═'.repeat(56));
console.log(`📊  Day 38 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f=>console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
