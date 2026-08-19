/**
 * verify-day-42.js  —  Day 42: Notification Bell
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

// ── A. NotificationBell component ─────────────────────────────────────────
console.log('\n── A — NotificationBell');
const nb = path.join(FRONT, 'components/NotificationBell.jsx');
assert('NotificationBell.jsx exists', exists(nb));
const nc = read(nb);
assert('Uses getUnreadCount API',          nc.includes('getUnreadCount'));
assert('Uses getNotifications API',        nc.includes('getNotifications'));
assert('Uses markAllNotificationsRead',    nc.includes('markAllNotificationsRead'));
assert('Uses markNotificationRead',        nc.includes('markNotificationRead'));
assert('Polls every 30s',                  nc.includes('30_000') || nc.includes('30000'));
assert('Has outside-click close handler',  nc.includes('mousedown'));
assert('Has unread badge',                 nc.includes('notif-bell-badge'));
assert('Has notif-panel dropdown',         nc.includes('notif-panel'));
assert('Severity icons map',               nc.includes('SEV_ICON'));
assert('Exports default NotificationBell', nc.includes('export default function NotificationBell'));

// ── B. Sidebar integration ────────────────────────────────────────────────
console.log('\n── B — Sidebar wired');
const sb = read(path.join(FRONT, 'components/Sidebar.jsx'));
assert('Sidebar imports NotificationBell', sb.includes("import NotificationBell"));
assert('Sidebar renders <NotificationBell', sb.includes('<NotificationBell'));
assert('Passes user prop',                  sb.includes('user={user}'));

// ── C. API client ─────────────────────────────────────────────────────────
console.log('\n── C — API client');
const client = read(path.join(FRONT, 'api/client.js'));
assert('getNotifications exists',        client.includes('async getNotifications('));
assert('getUnreadCount exists',          client.includes('async getUnreadCount('));
assert('markNotificationRead exists',    client.includes('async markNotificationRead('));
assert('markAllNotificationsRead exists',client.includes('async markAllNotificationsRead('));

// ── D. CSS ────────────────────────────────────────────────────────────────
console.log('\n── D — CSS');
const css = read(path.join(FRONT, 'styles/global.css'));
assert('CSS has .notif-bell-wrap',   css.includes('.notif-bell-wrap'));
assert('CSS has .notif-bell-badge',  css.includes('.notif-bell-badge'));
assert('CSS has .notif-panel',       css.includes('.notif-panel {'));
assert('CSS has .notif-item',        css.includes('.notif-item {'));
assert('CSS has .notif-unread',      css.includes('.notif-unread'));

// ── E. Build ──────────────────────────────────────────────────────────────
console.log('\n── E — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT, 'frontend'), stdio: 'pipe' });
  assert('Vite build succeeds', true);
  assert('dist/index.html exists', exists(path.join(ROOT, 'frontend/dist/index.html')));
} catch (e) {
  assert('Vite build succeeds', false, e.stderr?.toString().slice(0, 300));
}

console.log('\n' + '═'.repeat(56));
console.log(`📊  Day 42 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f => console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
