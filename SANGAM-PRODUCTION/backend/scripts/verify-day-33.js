/**
 * verify-day-33.js  —  Day 33 acceptance tests
 *
 * A. Modal component exists and has correct structure
 * B. TransferListPage uses Modal for reject with reason
 * C. LoginPage polished (new CSS classes, keyboard handler)
 * D. TopBar.jsx removed
 * E. API client has movement, inventory, user management methods
 * F. CSS has modal + login-polish + btn-approve/reject rules
 * G. Frontend builds without errors
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT  = path.join(__dirname, '../..');
const FRONT = path.join(ROOT, 'frontend/src');

let passed = 0, failed = 0;
const failures = [];

function assert(label, condition, detail = '') {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else {
    console.log(`  ❌  ${label}${detail ? '\n      ' + detail : ''}`);
    failed++; failures.push(label);
  }
}

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function exists(p) { return fs.existsSync(p); }

// ── A. Modal component ───────────────────────────────────────────────────
console.log('\n── A — Modal component');

const modalPath = path.join(FRONT, 'components/Modal.jsx');
assert('Modal.jsx exists', exists(modalPath));

const modal = read(modalPath);
assert('Modal has modal-backdrop class',   modal.includes('modal-backdrop'));
assert('Modal has modal-panel class',      modal.includes('modal-panel'));
assert('Modal has Escape key handler',     modal.includes("'Escape'") || modal.includes('"Escape"'));
assert('Modal has aria-modal',             modal.includes('aria-modal'));
assert('Modal has title prop rendered',    modal.includes('modal-title'));
assert('Modal has actions footer',         modal.includes('modal-footer'));
assert('Modal has size prop (sm/md/lg)',   modal.includes('modal-sm') || modal.includes('modal-${size}'));
assert('Modal exports default function',   modal.includes('export default function Modal'));

// ── B. TransferListPage — reject modal ──────────────────────────────────
console.log('\n── B — TransferListPage reject modal');

const tl = read(path.join(FRONT, 'pages/TransferListPage.jsx'));
assert('TransferListPage imports Modal',        tl.includes("import Modal"));
assert('TransferListPage has rejectModal state', tl.includes('rejectModal'));
assert('TransferListPage has rejectReason state',tl.includes('rejectReason'));
assert('TransferListPage renders <Modal>',       tl.includes('<Modal'));
assert('TransferListPage has form-textarea in modal', tl.includes('form-textarea'));
assert('Reject button opens modal (not direct call)', tl.includes('openRejectModal'));
assert('confirmReject sends reason to API',     tl.includes('rejectReason.trim()'));

// ── C. LoginPage polish ──────────────────────────────────────────────────
console.log('\n── C — LoginPage polish');

const lp = read(path.join(FRONT, 'pages/LoginPage.jsx'));
assert('LoginPage has login-wordmark',        lp.includes('login-wordmark'));
assert('LoginPage has login-classification',  lp.includes('login-classification'));
assert('LoginPage has login-grid-bg',         lp.includes('login-grid-bg'));
assert('LoginPage uses form-input class',     lp.includes('form-input'));
assert('LoginPage has keyboard Enter handler',lp.includes('Enter'));
assert('LoginPage has footer legal text',     lp.includes('Unauthorised') || lp.includes('criminal'));
assert('LoginPage has login-error with icon', lp.includes('login-error-icon') || lp.includes('login-error'));

// ── D. TopBar removed ────────────────────────────────────────────────────
console.log('\n── D — TopBar.jsx removed');

assert('TopBar.jsx deleted',
  !exists(path.join(FRONT, 'components/TopBar.jsx'))
);
const pages = ['DashboardPage','ItemListPage','TransferListPage','TransferCreatePage',
                'BlockchainPage','AlertListPage'];
for (const p of pages) {
  const src = read(path.join(FRONT, 'pages', p + '.jsx'));
  assert(`${p} has no TopBar import`, !src.includes("import TopBar"));
}

// ── E. API client methods ────────────────────────────────────────────────
console.log('\n── E — API client completeness');

const client = read(path.join(FRONT, 'api/client.js'));
const required = [
  'getMovementOrders', 'getMovementOrder', 'createMovementOrder',
  'dispatchMovementOrder', 'cancelMovementOrder',
  'getInventorySessions', 'createInventorySession',
  'recordInventoryCount', 'finalizeInventorySession',
  'getUsers', 'createUser', 'deactivateUser', 'changeUserRole', 'unlockUser',
  'getSupplyCategories',
];
for (const m of required) {
  assert(`client.js has ${m}`, client.includes(m));
}

// ── F. CSS rules ─────────────────────────────────────────────────────────
console.log('\n── F — CSS rules');

const css = read(path.join(FRONT, 'styles/global.css'));
const cssChecks = [
  '.modal-backdrop', '.modal-panel', '.modal-header', '.modal-body', '.modal-footer',
  '.modal-sm', '.modal-close', '.login-wordmark', '.login-grid-bg',
  '.login-classification', '.login-submit', '.login-footer',
  '.btn-approve', '.btn-reject', '.spinner-inline',
];
for (const cls of cssChecks) {
  assert(`CSS has ${cls}`, css.includes(cls));
}

// ── G. Frontend build ────────────────────────────────────────────────────
console.log('\n── G — Frontend build');
try {
  execSync('npm run build', { cwd: path.join(ROOT, 'frontend'), stdio: 'pipe' });
  assert('Vite build succeeds', true);
  assert('dist/index.html exists', exists(path.join(ROOT, 'frontend/dist/index.html')));
} catch (e) {
  assert('Vite build succeeds', false, e.stderr?.toString().slice(0,200));
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(56));
console.log(`📊  Day 33 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f => console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
