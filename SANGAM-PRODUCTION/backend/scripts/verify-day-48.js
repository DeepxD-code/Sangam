'use strict';

/**
 * Day 48 Verification — Blockchain Block Detail Panel (click to expand)
 *
 * The backend already exposed GET /api/supply/blockchain/:blockIndex and,
 * more importantly, getBlocks()/getBlockByIndex() already return the full
 * block object (no separate "summary vs detail" split) — so Day 48 is a
 * pure frontend feature: click-to-expand on each block card, plus a
 * cross-link from a TRANSFER block back to TransferListPage's detail
 * modal via router state. This script proves the full data round-trip
 * (create item → transfer → approve → block recorded with transferId)
 * still works end to end, then statically confirms the frontend wiring.
 */

const jwt  = require('jsonwebtoken');
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const createApp = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 9001, username: 'test.actor', role: 'SYSTEM_ADMIN',
    unitId: 1, unitCode: 'TST', ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, path: urlPath, method,
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  const app = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const services = app.locals.services;

  try {
    console.log('\n🏗  Group A: real transfer → approve → block round trip');
    const unitA = (await services.units.createUnit({ unitName: 'D48 A', unitType: 'COMPANY', unitCode: 'D48-A' })).unit;
    const unitB = (await services.units.createUnit({ unitName: 'D48 B', unitType: 'COMPANY', unitCode: 'D48-B' })).unit;
    const item  = (await services.supply.createItem({
      itemCode: 'D48-001', itemName: 'Test Radio Set', category: 'COMMS',
      unitId: unitA.id, quantity: 20, lowStockThreshold: 2
    })).item;

    const token = makeToken({ unitId: unitA.id, unitCode: unitA.unitCode });

    const transferRes = await request(port, 'POST', '/api/supply/transfers', token, {
      itemId: item.id, fromUnitId: unitA.id, toUnitId: unitB.id, quantity: 5, notes: 'Day48 test'
    });
    check('transfer created', transferRes.status === 201, `got ${transferRes.status}: ${JSON.stringify(transferRes.json)}`);
    const transferId = transferRes.json?.transfer?.id;

    const approveRes = await request(port, 'POST', `/api/supply/transfers/${transferId}/approve`, token);
    check('transfer approved (blockIndex assigned)', approveRes.status === 200 && typeof approveRes.json?.transfer?.blockIndex === 'number',
      `got ${approveRes.status}: ${JSON.stringify(approveRes.json)}`);
    const blockIndex = approveRes.json?.transfer?.blockIndex;

    console.log('\n🔗 Group B: block detail round-trips the same data the list view already has');
    const listRes = await request(port, 'GET', '/api/supply/blockchain?limit=50', token);
    check('GET /api/supply/blockchain → 200 with blocks array', listRes.status === 200 && Array.isArray(listRes.json?.blocks));
    const blockFromList = (listRes.json?.blocks || []).find(b => b.blockIndex === blockIndex);
    check('block for this transfer is present in the list', !!blockFromList);

    const detailRes = await request(port, 'GET', `/api/supply/blockchain/${blockIndex}`, token);
    check('GET /api/supply/blockchain/:blockIndex → 200', detailRes.status === 200 && !!detailRes.json?.block);
    check('detail block matches list block (same hash)',
      detailRes.json?.block?.blockHash === blockFromList?.blockHash);
    check('block.transactionData.transferId links back to the source transfer',
      detailRes.json?.block?.transactionData?.transferId === transferId,
      `got ${JSON.stringify(detailRes.json?.block?.transactionData)}`);

    console.log('\n🔍 Group C: 404 for a non-existent block index (expand panel must handle this gracefully)');
    const missingRes = await request(port, 'GET', '/api/supply/blockchain/999999', token);
    check('non-existent block → 404', missingRes.status === 404);

  } finally {
    server.close();
  }

  console.log('\n🗂  Group D: frontend wiring — expand panel + cross-link');
  const FRONT = path.join(__dirname, '../../frontend/src');
  const blockchainJsx = fs.readFileSync(path.join(FRONT, 'pages/BlockchainPage.jsx'), 'utf8');
  check('BlockchainPage tracks expanded block state', /expanded.*useState\(new Set/.test(blockchainJsx));
  check('BlockchainPage renders a detail panel', blockchainJsx.includes('block-detail-panel'));
  check('BlockchainPage cross-links to the source transfer via router state',
    blockchainJsx.includes('openTransferId'));

  const transferListJsx = fs.readFileSync(path.join(FRONT, 'pages/TransferListPage.jsx'), 'utf8');
  check('TransferListPage reads openTransferId from router state', transferListJsx.includes('location.state?.openTransferId'));
  check('TransferListPage imports useLocation', /useLocation/.test(transferListJsx));

  console.log('\n🏗  Group E: frontend production build succeeds');
  try {
    execSync('npm run build', { cwd: path.join(__dirname, '../../frontend'), stdio: 'pipe' });
    check('vite build succeeds', true);
  } catch (e) {
    check('vite build succeeds', false, e.stdout?.toString().slice(-500));
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 48 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
