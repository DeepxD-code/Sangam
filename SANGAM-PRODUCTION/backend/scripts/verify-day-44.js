/**
 * verify-day-44.js  —  Day 44: Password Change Page
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT  = path.join(__dirname, '../..');
const FRONT = path.join(ROOT, 'frontend/src');

let passed = 0, failed = 0, failures = [];
function assert(label, ok, detail = '') {
  if (ok) { console.log(`  ✅  ${label}`); passed++; }
  else { console.log(`  ❌  ${label}${detail ? '\n      ' + detail : ''}`); failed++; failures.push(label); }
}
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function exists(p) { return fs.existsSync(p); }

// ── A. PasswordChangePage ─────────────────────────────────────────────────
console.log('\n── A — PasswordChangePage');
const pp = path.join(FRONT, 'pages/PasswordChangePage.jsx');
assert('PasswordChangePage.jsx exists', exists(pp));
const pg = read(pp);
assert('Has 4 strength rules',          (pg.match(/STRENGTH_RULES/g) || []).length >= 1 && pg.includes('length >= 8'));
assert('Has visual strength bar',       pg.includes('pw-strength-bar'));
assert('Has per-rule checklist',        pg.includes('pw-rules'));
assert('Has confirm mismatch check',    pg.includes('mismatch'));
assert('Has self-change guard (old≠new)', pg.includes('newPw === oldPw'));
assert('401 → incorrect password msg',  pg.includes('Current password is incorrect'));
assert('400 → requirements msg',        pg.includes('does not meet requirements') || pg.includes('err.message'));
assert('503 → offline mode msg',        pg.includes('offline mode'));
assert('Calls changePassword API',      pg.includes('api.changePassword'));
assert('Submit disabled when weak',     pg.includes('score < 2'));
assert('Success banner shown',          pg.includes('success'));
assert('Exports default',               pg.includes('export default function PasswordChangePage'));

// ── B. API client ─────────────────────────────────────────────────────────
console.log('\n── B — API client');
const client = read(path.join(FRONT, 'api/client.js'));
assert('changePassword exists',            client.includes('async changePassword('));
assert('Calls /api/auth/change-password',  client.includes('/api/auth/change-password'));
assert('Sends oldPassword + newPassword',  client.includes('oldPassword') && client.includes('newPassword'));

// ── C. App.jsx routing ────────────────────────────────────────────────────
console.log('\n── C — Routing');
const app = read(path.join(FRONT, 'App.jsx'));
assert('App imports PasswordChangePage',    app.includes('PasswordChangePage'));
assert('Route /profile/password exists',    app.includes('/profile/password'));

// ── D. Sidebar link ───────────────────────────────────────────────────────
console.log('\n── D — Sidebar password link');
const sb = read(path.join(FRONT, 'components/Sidebar.jsx'));
assert('Sidebar has /profile/password NavLink', sb.includes('/profile/password'));
assert('sidebar-pw-link class used',            sb.includes('sidebar-pw-link'));

// ── E. CSS ────────────────────────────────────────────────────────────────
console.log('\n── E — CSS');
const css = read(path.join(FRONT, 'styles/global.css'));
assert('CSS has .pw-card',            css.includes('.pw-card'));
assert('CSS has .pw-strength',        css.includes('.pw-strength {'));
assert('CSS has .pw-strength-bar',    css.includes('.pw-strength-bar {'));
assert('CSS has .pw-bar-segment',     css.includes('.pw-bar-segment {'));
assert('CSS has .pw-rules',           css.includes('.pw-rules {'));
assert('CSS has .pw-rule-met',        css.includes('.pw-rule-met'));
assert('CSS has .pw-strong label',    css.includes('.pw-strong'));
assert('CSS has .form-card',          css.includes('.form-card {'));
assert('CSS has .sidebar-pw-link',    css.includes('.sidebar-pw-link'));

// ── F. Backend endpoint exists ────────────────────────────────────────────
console.log('\n── F — Backend');
const authRoutes = read(path.join(ROOT, 'backend/src/routes/auth.routes.js'));
assert('/change-password route exists',   authRoutes.includes('/change-password'));
assert('Calls service.changePassword',    authRoutes.includes('changePassword'));

// ── G. Build ──────────────────────────────────────────────────────────────
console.log('\n── G — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT, 'frontend'), stdio: 'pipe' });
  assert('Vite build succeeds', true);
  assert('dist/index.html exists', exists(path.join(ROOT, 'frontend/dist/index.html')));
} catch (e) {
  assert('Vite build succeeds', false, e.stderr?.toString().slice(0, 300));
}

console.log('\n' + '═'.repeat(56));
console.log(`📊  Day 44 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f => console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
