/**
 * verify-day-36.js  —  Day 36: Audit Log Page
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT  = path.join(__dirname, '../..');
const FRONT = path.join(ROOT, 'frontend/src');
const BACK  = path.join(ROOT, 'backend/src');

let passed = 0, failed = 0, failures = [];
function assert(label, ok, detail='') {
  if (ok) { console.log(`  ✅  ${label}`); passed++; }
  else { console.log(`  ❌  ${label}${detail?'\n      '+detail:''}`); failed++; failures.push(label); }
}
function read(p) { try { return fs.readFileSync(p,'utf8'); } catch { return ''; } }
function exists(p) { return fs.existsSync(p); }

// ── A. AuditLogPage ──────────────────────────────────────────────────────
console.log('\n── A — AuditLogPage');
const ap = path.join(FRONT,'pages/AuditLogPage.jsx');
assert('AuditLogPage.jsx exists', exists(ap));
const pg = read(ap);
assert('Has admin guard (SYSTEM_ADMIN)', pg.includes('SYSTEM_ADMIN'));
assert('Uses getAuditLog API',           pg.includes('getAuditLog'));
assert('Has severity filter tabs',       pg.includes('SEVERITY_FILTERS'));
assert('Has pagination',                 pg.includes('pagination'));
assert('Has username search filter',     pg.includes('username'));
assert('Shows source (db/buffer)',       pg.includes('source'));
assert('Renders audit-table',            pg.includes('audit-table'));
assert('Shows success/fail indicator',   pg.includes('success'));

// ── B. Backend route ─────────────────────────────────────────────────────
console.log('\n── B — /api/reports/audit-log route');
const rep = read(path.join(BACK,'routes/reporting.routes.js'));
assert('Reporting routes has /audit-log endpoint', rep.includes('/audit-log'));
assert('Requires system:admin permission',         rep.includes('system:admin'));
assert('Falls back to _inMemoryBuffer',            rep.includes('_inMemoryBuffer'));
assert('Returns source field',                     rep.includes("source: 'buffer'") || rep.includes("source: 'db'"));

// ── C. API client ────────────────────────────────────────────────────────
console.log('\n── C — API client');
const client = read(path.join(FRONT,'api/client.js'));
assert('client.js has getAuditLog',          client.includes('getAuditLog'));
assert('getAuditLog calls /api/reports/audit-log', client.includes('/api/reports/audit-log'));

// ── D. App.jsx + Sidebar ─────────────────────────────────────────────────
console.log('\n── D — Routing & Nav');
const app = read(path.join(FRONT,'App.jsx'));
assert('App imports AuditLogPage', app.includes('AuditLogPage'));
assert('App has /audit route',     app.includes("'/audit'") || app.includes('"/audit"'));

const sidebar = read(path.join(FRONT,'components/Sidebar.jsx'));
assert('Sidebar has AUDIT LOG link',      sidebar.includes('/audit'));
assert('Sidebar AUDIT LOG is admin-only', sidebar.includes('adminOnly'));
assert('Sidebar filters adminOnly for rankLevel<5', sidebar.includes('rankLevel < 5') || sidebar.includes('rankLevel<5'));

// ── E. CSS ───────────────────────────────────────────────────────────────
console.log('\n── E — CSS');
const css = read(path.join(FRONT,'styles/global.css'));
assert('CSS has .audit-table',  css.includes('.audit-table'));
assert('CSS has .sev-pill',     css.includes('.sev-pill'));
assert('CSS has .sev-critical', css.includes('.sev-critical'));
assert('CSS has .pagination',   css.includes('.pagination {'));
assert('CSS has .btn-ghost',    css.includes('.btn-ghost {'));

// ── F. Build ─────────────────────────────────────────────────────────────
console.log('\n── F — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT,'frontend'), stdio:'pipe' });
  assert('Vite build succeeds', true);
} catch(e) { assert('Vite build succeeds', false, e.stderr?.toString().slice(0,300)); }

console.log('\n'+'═'.repeat(56));
console.log(`📊  Day 36 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f=>console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
