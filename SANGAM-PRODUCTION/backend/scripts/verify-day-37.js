/**
 * verify-day-37.js  —  Day 37: User Management Page
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

// ── A. UserManagementPage ────────────────────────────────────────────────
console.log('\n── A — UserManagementPage');
const up = path.join(FRONT,'pages/UserManagementPage.jsx');
assert('UserManagementPage.jsx exists', exists(up));
const pg = read(up);
assert('Has admin guard',                pg.includes('SYSTEM_ADMIN'));
assert('Uses getUsers API',              pg.includes('getUsers'));
assert('Uses createUser API',            pg.includes('createUser'));
assert('Uses deactivateUser API',        pg.includes('deactivateUser'));
assert('Uses reactivateUser API',        pg.includes('reactivateUser'));
assert('Uses changeUserRole API',        pg.includes('changeUserRole'));
assert('Uses unlockUser API',            pg.includes('unlockUser'));
assert('Has create user modal',          pg.includes('createModal'));
assert('Has role change modal',          pg.includes('roleModal'));
assert('Guards self-deactivation',       pg.includes("u.id !== user?.userId") || pg.includes("u.id === user?.userId"));
assert('Has VALID_ROLES list',           pg.includes('VALID_ROLES'));

// ── B. App.jsx + Sidebar ─────────────────────────────────────────────────
console.log('\n── B — Routing');
const app = read(path.join(FRONT,'App.jsx'));
assert('App imports UserManagementPage', app.includes('UserManagementPage'));
assert('App has /admin/users route',    app.includes('/admin/users'));

const sb = read(path.join(FRONT,'components/Sidebar.jsx'));
assert('Sidebar has /admin/users link',  sb.includes('/admin/users'));
assert('Users link is adminOnly',        sb.includes("adminOnly: true") || sb.includes('adminOnly:true'));

// ── C. API client corrections ────────────────────────────────────────────
console.log('\n── C — API client');
const client = read(path.join(FRONT,'api/client.js'));
assert('getUsers uses search param',         client.includes("p.set('search'"));
assert('changeUserRole uses assign-role',    client.includes('assign-role'));
assert('getAuditLog exists',                 client.includes('getAuditLog'));
assert('getActiveInventorySession exists',   client.includes('getActiveInventorySession'));

// ── D. CSS ───────────────────────────────────────────────────────────────
console.log('\n── D — CSS');
const css = read(path.join(FRONT,'styles/global.css'));
assert('CSS has .user-rank-tag',      css.includes('.user-rank-tag'));
assert('CSS has .user-inactive-row',  css.includes('.user-inactive-row'));
assert('CSS has .input-error',        css.includes('.input-error'));

// ── E. Build ─────────────────────────────────────────────────────────────
console.log('\n── E — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT,'frontend'), stdio:'pipe' });
  assert('Vite build succeeds', true);
  assert('dist/index.html exists', exists(path.join(ROOT,'frontend/dist/index.html')));
} catch(e) { assert('Vite build succeeds', false, e.stderr?.toString().slice(0,300)); }

console.log('\n'+'═'.repeat(56));
console.log(`📊  Day 37 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f=>console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
