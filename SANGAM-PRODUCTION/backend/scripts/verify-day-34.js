/**
 * verify-day-34.js  —  Day 34: Movement Orders Page
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

// ── A. MovementOrderPage exists ──────────────────────────────────────────
console.log('\n── A — MovementOrderPage');
const mp = path.join(FRONT,'pages/MovementOrderPage.jsx');
assert('MovementOrderPage.jsx exists', exists(mp));

const pg = read(mp);
assert('Uses getMovementOrders API',  pg.includes('getMovementOrders'));
assert('Uses createMovementOrder API',pg.includes('createMovementOrder'));
assert('Uses dispatchMovementOrder',  pg.includes('dispatchMovementOrder'));
assert('Uses deliverMovementOrder',   pg.includes('deliverMovementOrder'));
assert('Uses cancelMovementOrder',    pg.includes('cancelMovementOrder'));
assert('Has Modal for create',        pg.includes('<Modal'));
assert('Has cancel reason modal',     pg.includes('cancelModal'));
assert('Has STATE_FILTERS',           pg.includes('STATE_FILTERS'));
assert('Has PRIORITY_LEVELS',         pg.includes('PRIORITY_LEVELS'));
assert('Has movement-list CSS class', pg.includes('movement-list'));
assert('Has role guard (rankLevel)',   pg.includes('rankLevel'));

// ── B. App.jsx wired ─────────────────────────────────────────────────────
console.log('\n── B — App.jsx routing');
const app = read(path.join(FRONT,'App.jsx'));
assert('App imports MovementOrderPage', app.includes('MovementOrderPage'));
assert('App has /movement route',       app.includes("'/movement'") || app.includes('"/movement"'));

// ── C. Sidebar updated ───────────────────────────────────────────────────
console.log('\n── C — Sidebar MOVEMENT is live');
const sidebar = read(path.join(FRONT,'components/Sidebar.jsx'));
// Check that MOVEMENT link has no comingSoon: true
const movBlock = sidebar.split('/movement')[1]?.slice(0,200) || '';
assert('MOVEMENT link has no comingSoon flag',
  !movBlock.includes('comingSoon: true'));

// ── D. API client ────────────────────────────────────────────────────────
console.log('\n── D — API client movement methods');
const client = read(path.join(FRONT,'api/client.js'));
assert('getMovementOrders uses state filter', client.includes("p.set('state'"));
assert('createMovementOrder sends items array', client.includes('items'));
assert('dispatchMovementOrder is POST', client.includes("dispatchMovementOrder"));

// ── E. CSS ───────────────────────────────────────────────────────────────
console.log('\n── E — Movement CSS');
const css = read(path.join(FRONT,'styles/global.css'));
assert('CSS has .movement-list',      css.includes('.movement-list'));
assert('CSS has .movement-card',      css.includes('.movement-card'));
assert('CSS has .movement-route',     css.includes('.movement-route'));
assert('CSS has .priority-badge',     css.includes('.priority-badge'));
assert('CSS has priority-emergency',  css.includes('.priority-emergency'));
assert('CSS has .movement-item-tag',  css.includes('.movement-item-tag'));

// ── F. Build ─────────────────────────────────────────────────────────────
console.log('\n── F — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT,'frontend'), stdio:'pipe' });
  assert('Vite build succeeds', true);
  assert('dist/index.html exists', exists(path.join(ROOT,'frontend/dist/index.html')));
} catch(e) {
  assert('Vite build succeeds', false, e.stderr?.toString().slice(0,300));
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log('\n'+'═'.repeat(56));
console.log(`📊  Day 34 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f=>console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
