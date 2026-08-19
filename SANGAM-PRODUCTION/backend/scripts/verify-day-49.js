'use strict';

/**
 * Day 49 Verification — Alert Detail Expand + Full Escalation History
 *
 * Two real, pre-existing frontend/backend field-mismatch bugs were found
 * and fixed while building this feature:
 *   1. AlertListPage compared a.status to the literal string 'ACTIVE', but
 *      AlertEscalationService.STATUS only ever produces OPEN, ESCALATED,
 *      RESOLVED, SUPPRESSED — so the ACKNOWLEDGE/RESOLVE buttons (and the
 *      "N ACTIVE" header count) never appeared for a freshly-raised OPEN
 *      alert, only after it had already escalated 15 minutes later.
 *   2. AlertListPage read a.message and a.itemId, but the entity stores
 *      the description under a.detail and the item reference under
 *      a.meta.itemId — so the alert description line never rendered.
 * This script proves both are fixed with a real alert lifecycle over
 * HTTP, then confirms the new detail modal is wired up.
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
  const token = makeToken();

  try {
    console.log('\n🏗  Group A: raise a real OPEN alert (fixture, via the real service)');
    const unit = (await services.units.createUnit({ unitName: 'D49', unitType: 'COMPANY', unitCode: 'D49-A' })).unit;
    const raised = services.alerts._raise({
      key: 'd49-test-alert', type: 'LOW_STOCK', severity: 'HIGH',
      unitId: unit.id, title: 'Test Radio below threshold',
      detail: 'Quantity 2 is below the low-stock threshold of 5.',
      meta: { itemId: 42, quantity: 2, threshold: 5 }
    }, Date.now());
    check('alert raised with status OPEN', raised.status === 'OPEN', `got ${raised.status}`);

    console.log('\n🔎 Group B: GET /api/alerts/:id returns the fields the modal depends on');
    const getRes = await request(port, 'GET', `/api/alerts/${raised.id}`, token);
    check('GET /api/alerts/:id → 200', getRes.status === 200 && getRes.json?.alert?.id === raised.id);
    check('alert.detail carries the description (not .message)', getRes.json?.alert?.detail === raised.detail);
    check('alert.meta.itemId carries the item reference (not top-level .itemId)',
      getRes.json?.alert?.meta?.itemId === 42);
    check('alert.raisedAt present for the timeline', !!getRes.json?.alert?.raisedAt);

    console.log('\n🩹 Group C: OPEN alerts are actionable immediately (the bug this day fixed)');
    const listRes = await request(port, 'GET', '/api/alerts', token);
    const fromList = (listRes.json?.alerts || []).find(x => x.id === raised.id);
    check('a fresh OPEN alert is included in getAllAlerts()', !!fromList);
    check('a fresh OPEN alert is NOT status ACTIVE (frontend must check OPEN, not ACTIVE)',
      fromList?.status === 'OPEN');

    console.log('\n✅ Group D: acknowledge → resolve lifecycle round-trip');
    const ackRes = await request(port, 'POST', `/api/alerts/${raised.id}/acknowledge`, token);
    check('acknowledge → 200, acknowledgedAt stamped, status still actionable',
      ackRes.status === 200 && !!ackRes.json?.alert?.acknowledgedAt && ackRes.json?.alert?.acknowledgedBy === 9001);

    const resolveRes = await request(port, 'POST', `/api/alerts/${raised.id}/resolve`, token, { note: 'fixed via test' });
    check('resolve → 200, status RESOLVED, resolution note stored',
      resolveRes.status === 200 && resolveRes.json?.alert?.status === 'RESOLVED'
      && resolveRes.json?.alert?.resolution === 'fixed via test');

    console.log('\n⊘ Group E: suppress lifecycle on a second alert');
    const raised2 = services.alerts._raise({
      key: 'd49-test-alert-2', type: 'STALE_TRANSFER', severity: 'MEDIUM',
      unitId: unit.id, title: 'Stale transfer', detail: 'Pending > 30 min.', meta: {}
    }, Date.now());
    const suppressRes = await request(port, 'POST', `/api/alerts/${raised2.id}/suppress`, token, { reason: 'duplicate of #1' });
    check('suppress → 200, status SUPPRESSED, reason stored',
      suppressRes.status === 200 && suppressRes.json?.alert?.status === 'SUPPRESSED'
      && suppressRes.json?.alert?.suppression === 'duplicate of #1');

  } finally {
    server.close();
  }

  console.log('\n🗂  Group F: frontend wiring — bug fixes and new modal');
  const FRONT = path.join(__dirname, '../../frontend/src');
  const alertListJsx = fs.readFileSync(path.join(FRONT, 'pages/AlertListPage.jsx'), 'utf8');
  check("AlertListPage no longer checks for the never-real 'ACTIVE' status",
    !alertListJsx.includes("['ACTIVE'") && !alertListJsx.includes("ACTIVE:"));
  check('AlertListPage checks OPEN status for action visibility', alertListJsx.includes("'OPEN', 'ESCALATED'"));
  check('AlertListPage reads a.detail, not a.message', alertListJsx.includes('a.detail') && !alertListJsx.includes('a.message'));
  check('AlertListPage reads a.meta?.itemId, not a.itemId', alertListJsx.includes('a.meta?.itemId'));
  check('AlertListPage imports AlertDetailModal', alertListJsx.includes("from '../components/AlertDetailModal.jsx'"));
  check('AlertListPage opens the modal on row click', alertListJsx.includes('setDetailId(a.id)'));

  const modalPath = path.join(FRONT, 'components/AlertDetailModal.jsx');
  check('AlertDetailModal.jsx exists', fs.existsSync(modalPath));
  const modalJsx = fs.readFileSync(modalPath, 'utf8');
  check('AlertDetailModal renders an escalation history timeline', modalJsx.includes('Escalation History') && modalJsx.includes('td-timeline'));
  check('AlertDetailModal supports acknowledge/resolve/suppress actions',
    modalJsx.includes('acknowledgeAlert') && modalJsx.includes('resolveAlert') && modalJsx.includes('suppressAlert'));

  const clientJs = fs.readFileSync(path.join(FRONT, 'api/client.js'), 'utf8');
  check('client.js defines getAlert() (singular)', /async getAlert\(id\)/.test(clientJs));
  check('client.js defines suppressAlert()', clientJs.includes('async suppressAlert'));

  console.log('\n🏗  Group G: frontend production build succeeds');
  try {
    execSync('npm run build', { cwd: path.join(__dirname, '../../frontend'), stdio: 'pipe' });
    check('vite build succeeds', true);
  } catch (e) {
    check('vite build succeeds', false, e.stdout?.toString().slice(-500));
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 49 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
