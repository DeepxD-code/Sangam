/**
 * verify-day-41.js  —  Day 41: Transfer Detail Modal + Timeline
 */
'use strict';
const fs = require('fs');
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

// ── A. TransferDetailModal component ─────────────────────────────────────
console.log('\n── A — TransferDetailModal');
const tdm = path.join(FRONT, 'components/TransferDetailModal.jsx');
assert('TransferDetailModal.jsx exists', exists(tdm));
const tm = read(tdm);
assert('Uses Modal component',            tm.includes("import Modal"));
assert('Has blockchain proof section',    tm.includes('blockIndex'));
assert('Has timeline events',             tm.includes('td-timeline'));
assert('Has navigate to blockchain',      tm.includes("'/supply/blockchain'"));
assert('Has shortHash for block hash',    tm.includes('shortHash'));
assert('Has rejection reason display',    tm.includes('rejectionReason'));
assert('Has officer-only approve action', tm.includes('isOfficer'));
assert('Fetches transfer on open',        tm.includes('getTransfer'));
assert('Exports default',                 tm.includes('export default function TransferDetailModal'));

// ── B. TransferListPage integration ──────────────────────────────────────
console.log('\n── B — TransferListPage wired');
const tl = read(path.join(FRONT, 'pages/TransferListPage.jsx'));
assert('Imports TransferDetailModal',       tl.includes('TransferDetailModal'));
assert('Has detailId state',               tl.includes('detailId'));
assert('Row click sets detailId',           tl.includes('setDetailId'));
assert('Renders <TransferDetailModal',      tl.includes('<TransferDetailModal'));
assert('Click bypasses action buttons',     tl.includes("closest('.action-cell") || tl.includes("closest('.action-cell,.btn"));

// ── C. API client ─────────────────────────────────────────────────────────
console.log('\n── C — API client');
const client = read(path.join(FRONT, 'api/client.js'));
assert('client.js has getTransfer(id)',     client.includes('async getTransfer(id)'));
assert('getTransfer hits /transfers/:id',   client.includes('/api/supply/transfers/${id}') || client.includes('/api/supply/transfers/'));

// ── D. Supply chain service ───────────────────────────────────────────────
console.log('\n── D — Backend: blockIndex stored on transfer');
const sc = read(path.join(BACK, 'services/supply-chain.service.js'));
assert('Stores blockIndex on transfer', sc.includes('transfer.blockIndex = block.blockIndex'));
assert('Stores blockHash on transfer',  sc.includes('transfer.blockHash  = block.blockHash'));

// ── E. CSS ────────────────────────────────────────────────────────────────
console.log('\n── E — CSS');
const css = read(path.join(FRONT, 'styles/global.css'));
assert('CSS has .tr-clickable',        css.includes('.tr-clickable'));
assert('CSS has .transfer-detail',     css.includes('.transfer-detail'));
assert('CSS has .td-timeline',         css.includes('.td-timeline'));
assert('CSS has .td-event',            css.includes('.td-event {'));
assert('CSS has .td-proof',            css.includes('.td-proof {'));
assert('CSS has .td-blockchain-btn',   css.includes('.td-blockchain-btn'));

// ── F. Build ──────────────────────────────────────────────────────────────
console.log('\n── F — Build');
try {
  execSync('npm run build', { cwd: path.join(ROOT, 'frontend'), stdio: 'pipe' });
  assert('Vite build succeeds', true);
  assert('dist/index.html exists', exists(path.join(ROOT, 'frontend/dist/index.html')));
} catch (e) {
  assert('Vite build succeeds', false, e.stderr?.toString().slice(0, 300));
}

console.log('\n' + '═'.repeat(56));
console.log(`📊  Day 41 Results: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\n⚠️   Failed:'); failures.forEach(f => console.log(`  • ${f}`)); }
console.log('');
process.exit(failed > 0 ? 1 : 0);
