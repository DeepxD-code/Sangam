'use strict';

/**
 * Day 55 Verification — Final Demo-Readiness Pass
 *
 * Closes the reclaimed hardening block (Days 52-55, which replaced the
 * original "stakeholder feedback iteration" placeholder since no live
 * stakeholder session had happened yet to generate real feedback).
 *
 * Two parts:
 *   A. Static checks for the new About/System Info page (Day 55's own
 *      concrete addition — a demo quick-reference + tour launcher).
 *   B. A full END-TO-END vertical-slice smoke test over real HTTP: the
 *      same story a live stakeholder walkthrough follows — stand up a
 *      unit, staff it, stock it, transfer between units (writing a real
 *      blockchain block), verify the chain, raise + resolve an alert,
 *      and pull a CSV report — all in one continuous flow, as the
 *      final confidence check before Day 60's demo.
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
    userId: 9001, username: 'demo.actor', role: 'SYSTEM_ADMIN',
    unitId: 1, unitCode: 'TST', ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ port, path: urlPath, method,
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* CSV/non-JSON responses are fine */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

console.log('\n🗂  Group A: About / System Info page (Day 55)');
const FRONT = path.join(__dirname, '../../frontend/src');
check('AboutPage.jsx exists', fs.existsSync(path.join(FRONT, 'pages/AboutPage.jsx')));
const appJsx = fs.readFileSync(path.join(FRONT, 'App.jsx'), 'utf8');
check('App.jsx routes /about', /path="\/about"/.test(appJsx));
check('App.jsx passes onStartTour through pageProps (so About can launch the tour)', appJsx.includes('onStartTour: () => setTourActive(true)'));
const sidebarJsx = fs.readFileSync(path.join(FRONT, 'components/Sidebar.jsx'), 'utf8');
check('Sidebar links to /about', /to:\s*'\/about'/.test(sidebarJsx));

async function run() {
  const app = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const token = makeToken();

  try {
    console.log('\n🎬 Group B: full vertical-slice smoke test (the live-demo story, end to end)');

    // 1. Command structure
    const hq = await request(port, 'POST', '/api/units', token, {
      unitName: 'Demo Battalion HQ', unitType: 'BATTALION', unitCode: 'DEMO-HQ'
    });
    check('1. stand up a unit', hq.status === 201, `got ${hq.status}`);
    const fwd = await request(port, 'POST', '/api/units', token, {
      unitName: 'Demo Forward Post', unitType: 'COMPANY', unitCode: 'DEMO-FWD',
      parentUnitId: hq.json?.unit?.id
    });
    check('1b. stand up a subordinate unit', fwd.status === 201, `got ${fwd.status}`);

    // 2. Staff it
    const demoToken = makeToken({ unitId: hq.json?.unit?.id, unitCode: 'DEMO-HQ' });
    const soldier = await request(port, 'POST', '/api/users', demoToken, {
      username: 'demo.soldier', displayName: 'Demo Soldier', role: 'SOLDIER', unitId: hq.json?.unit?.id
    });
    check('2. staff the unit with a user', soldier.status === 201, `got ${soldier.status}: ${JSON.stringify(soldier.json)}`);

    // 3. Stock it
    const item = await request(port, 'POST', '/api/supply/items', demoToken, {
      itemCode: 'DEMO-RIFLE-01', itemName: 'Demo Service Rifle', category: 'EQUIPMENT',
      unitId: hq.json?.unit?.id, quantity: 40, lowStockThreshold: 5
    });
    check('3. stock a supply item', item.status === 201, `got ${item.status}`);

    // 4. Unit detail aggregation (what UnitDetailPage actually calls)
    const detail = await request(port, 'GET', `/api/units/${hq.json?.unit?.id}`, demoToken);
    const stats  = await request(port, 'GET', `/api/units/${hq.json?.unit?.id}/stats`, demoToken);
    const roster = await request(port, 'GET', `/api/users?unitId=${hq.json?.unit?.id}`, demoToken);
    check('4. unit detail page data all loads together', detail.status === 200 && stats.status === 200 && roster.status === 200);

    // 5. Transfer between units → blockchain block
    const transfer = await request(port, 'POST', '/api/supply/transfers', demoToken, {
      itemId: item.json?.item?.id, fromUnitId: hq.json?.unit?.id, toUnitId: fwd.json?.unit?.id,
      quantity: 10, notes: 'Demo smoke test transfer'
    });
    check('5. request a transfer', transfer.status === 201, `got ${transfer.status}: ${JSON.stringify(transfer.json)}`);
    const approve = await request(port, 'POST', `/api/supply/transfers/${transfer.json?.transfer?.id}/approve`, demoToken);
    check('5b. approve the transfer → block written', approve.status === 200 && typeof approve.json?.transfer?.blockIndex === 'number');

    // 6. Verify the chain
    const verify = await request(port, 'POST', '/api/supply/blockchain/verify', demoToken);
    check('6. verify the blockchain is intact', verify.status === 200 && verify.json?.verified === true,
      `got ${verify.status}: ${JSON.stringify(verify.json)}`);

    // 7. Alert lifecycle
    const alert = app.locals.services.alerts._raise({
      key: 'demo-smoke-alert', type: 'LOW_STOCK', severity: 'HIGH',
      unitId: hq.json?.unit?.id, title: 'Demo alert', detail: 'Smoke test alert', meta: { itemId: item.json?.item?.id }
    }, Date.now());
    const ack = await request(port, 'POST', `/api/alerts/${alert.id}/acknowledge`, demoToken);
    const resolve = await request(port, 'POST', `/api/alerts/${alert.id}/resolve`, demoToken, { note: 'handled' });
    check('7. alert acknowledge → resolve lifecycle', ack.status === 200 && resolve.status === 200 && resolve.json?.alert?.status === 'RESOLVED');

    // 8. Reporting
    const report = await request(port, 'GET', '/api/reports/export/stock-levels', demoToken);
    check('8. export a CSV report', report.status === 200, `got ${report.status}`);

  } finally {
    server.close();
  }

  console.log('\n🏗  Group C: frontend production build succeeds (final check)');
  try {
    execSync('npm run build', { cwd: path.join(__dirname, '../../frontend'), stdio: 'pipe' });
    check('vite build succeeds', true);
  } catch (e) {
    check('vite build succeeds', false, e.stdout?.toString().slice(-500));
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 55 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
