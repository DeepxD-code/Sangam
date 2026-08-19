/**
 * verify-day-35.js  —  Day 35: Inventory / Stock-Take Page
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

// ── A. InventoryPage ─────────────────────────────────────────────────────
console.log('\n── A — InventoryPage');
const ip = path.join(FRONT,'pages/InventoryPage.jsx');
assert('InventoryPage.jsx exists', exists(ip));
const pg = read(ip);
assert('Uses getInventorySessions',     pg.includes('getInventorySessions'));
assert('Uses createInventorySession',   pg.includes('createInventorySession'));
assert('Uses finalizeInventorySession', pg.includes('finalizeInventorySession'));
assert('Uses getInventorySession',      pg.includes('getInventorySession'));
assert('Has unit selector',             pg.includes('Select unit'));
assert('Has state filter tabs',         pg.includes('STATE_FILTERS'));
assert('Has session detail modal',      pg.includes('detailModal'));
assert('Has create session modal',      pg.includes('createModal'));
assert('Has discrepancy display',       pg.includes('discrepanc') || pg.includes('DISCREPANC'));
assert('Has stocktake-card CSS class',  pg.includes('stocktake-card'));

// ── B. App.jsx wired ─────────────────────────────────────────────────────
console.log('\n── B — App.jsx routing');
const app = read(path.join(FRONT,'App.jsx'));
assert('App imports InventoryPage', app.includes('InventoryPage'));
assert('App has /inventory route',  app.includes("'/inventory'") || app.includes('"/inventory"'));

// ── C. Sidebar — no more SOON flags ──────────────────────────────────────
console.log('\n── C — Sidebar all live (no SOON)');
const sidebar = read(path.join(FRONT,'components/Sidebar.jsx'));
assert('Sidebar has no comingSoon flags', !sidebar.includes('comingSoon: true'));

// ── D. API client ────────────────────────────────────────────────────────
console.log('\n── D — API client inventory methods');
const client = read(path.join(FRONT,'api/client.js'));
assert('getInventorySessions uses unitId query param', client.includes("p.set('unitId'"));
assert('getActiveInventorySession exists',             client.includes('getActiveInventorySession'));
assert('finalizeInventorySession exists',              client.includes('finalizeInventorySession'));

// ── E. CSS ───────────────────────────────────────────────────────────────
console.log('\n── E — Inventory CSS');
const css = read(path.join(FRONT,'styles/global.css'));
assert('CSS has .stocktake-list',    css.includes('.stocktake-list'));
assert('CSS has .stocktake-card',    css.includes('.stocktake-card'));
assert('CSS has .stocktake-header',  css.includes('.stocktake-header'));
assert('CSS has .detail-label',      css.includes('.detail-label'));
assert('CSS has .stocktake-detail-grid', css.includes('.stocktake-detail-grid'));

// ── F. Build ─────────────────────────────────────────────────────────────
console.log('\n── F — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT,'frontend'), stdio:'pipe' });
  assert('Vite build succeeds', true);
  assert('dist/index.html exists', exists(path.join(ROOT,'frontend/dist/index.html')));
} catch(e) {
  assert('Vite build succeeds', false, e.stderr?.toString().slice(0,300));
}

console.log('\n'+'═'.repeat(56));
console.log(`📊  Day 35 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f=>console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
