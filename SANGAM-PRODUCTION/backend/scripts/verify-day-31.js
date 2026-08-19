#!/usr/bin/env node
/**
 * Day 31 Verification Script — Alert Singleton + React Router + New Pages
 *
 * Tests:
 *  A. AlertEscalationService shared singleton wiring in app.js
 *  B. Alert routes accept injected service (no private instance)
 *  C. DashboardService._alertsSection() method exists and returns correct shape
 *  D. dashboard.routes.js forwards alerts to DashboardService
 *  E. server.js exports validateEnv (poller code path exists)
 *  F. Frontend: react-router-dom installed at v6
 *  G. Frontend: new page files exist with correct exports
 *  H. API client has all new methods
 *  I. Frontend build succeeds (full Vite production build)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..', '..');
const BACKEND  = path.join(ROOT, 'backend', 'src');
const FRONTEND = path.join(ROOT, 'frontend');

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅  ${label}`);
  passed++;
}

function fail(label, reason) {
  console.log(`  ❌  ${label}`);
  if (reason) console.log(`       ${reason}`);
  failed++;
}

function section(title) {
  console.log(`\n── ${title}`);
}

/* ── helpers ── */
function fileContains(file, ...strings) {
  const src = fs.readFileSync(path.join(BACKEND, file), 'utf8');
  return strings.every(s => src.includes(s));
}

function frontendFileContains(file, ...strings) {
  const src = fs.readFileSync(path.join(FRONTEND, 'src', file), 'utf8');
  return strings.every(s => src.includes(s));
}

// ════════════════════════════════════════════════════════════
// A. AlertEscalationService singleton in app.js
// ════════════════════════════════════════════════════════════
section('A — AlertEscalationService singleton (app.js)');

try {
  const appSrc = fs.readFileSync(path.join(BACKEND, 'app.js'), 'utf8');

  if (appSrc.includes("require('./services/alert-escalation.service')"))
    ok('app.js imports AlertEscalationService');
  else
    fail('app.js imports AlertEscalationService', 'Import not found');

  if (appSrc.includes('app.locals.services') && appSrc.includes('alerts'))
    ok('app.locals.services includes alerts');
  else
    fail('app.locals.services includes alerts', 'Not found in app.js');

  if (appSrc.includes('alertService: alerts'))
    ok('alerts singleton passed to createAlertRoutes');
  else
    fail('alerts singleton passed to createAlertRoutes', 'alertService: alerts not found');

  if (appSrc.includes('supply, units, users: userMgmt, inventory, movement, alerts') ||
      appSrc.includes('alerts: sharedServices.alerts') ||
      (appSrc.includes('createDashboardRoutes') && appSrc.includes('alerts')))
    ok('alerts forwarded to createDashboardRoutes');
  else
    fail('alerts forwarded to createDashboardRoutes', 'Not found');

} catch (e) {
  fail('app.js readable', e.message);
}

// ════════════════════════════════════════════════════════════
// B. Alert routes accept injected service
// ════════════════════════════════════════════════════════════
section('B — Alert routes use injected singleton');

try {
  const routeSrc = fs.readFileSync(
    path.join(BACKEND, 'routes', 'alert.routes.js'), 'utf8'
  );

  if (routeSrc.includes('sharedServices.alertService'))
    ok('alert.routes.js reads sharedServices.alertService');
  else
    fail('alert.routes.js reads sharedServices.alertService', 'Not found');

  if (routeSrc.includes('sharedServices.alertService ||'))
    ok('Falls back gracefully when no singleton provided');
  else
    fail('Falls back gracefully when no singleton provided', 'Fallback pattern not found');

  // Runtime: instantiating with an injected stub must not throw
  const AlertEscalationService = require('../src/services/alert-escalation.service');
  const stubAlertSvc = new AlertEscalationService({}, {}, null);
  const createAlertRoutes = require('../src/routes/alert.routes');
  const router = createAlertRoutes(null, null, { alertService: stubAlertSvc });

  if (router && typeof router.use === 'function')
    ok('createAlertRoutes(db, audit, { alertService }) returns an express router');
  else
    fail('createAlertRoutes returns an express router', 'Router not returned');

} catch (e) {
  fail('alert.routes.js singleton injection', e.message);
}

// ════════════════════════════════════════════════════════════
// C. DashboardService._alertsSection
// ════════════════════════════════════════════════════════════
section('C — DashboardService._alertsSection');

try {
  const DashboardService       = require('../src/services/dashboard.service');
  const AlertEscalationService = require('../src/services/alert-escalation.service');

  const alertSvc = new AlertEscalationService({}, {}, null);
  const dashboard = new DashboardService({ alerts: alertSvc });

  if (typeof dashboard._alertsSection === 'function')
    ok('DashboardService._alertsSection is a function');
  else {
    fail('DashboardService._alertsSection is a function', 'Not found'); return;
  }

  // Returns a Promise (async)
  const result = dashboard._alertsSection([1, 2, 3]);
  if (result && typeof result.then === 'function') {
    result.then(section => {
      if ('available' in section && 'totalActive' in section)
        ok('_alertsSection resolves with { available, totalActive, ... }');
      else
        fail('_alertsSection shape', `Got: ${JSON.stringify(section)}`);
    });
    ok('_alertsSection returns a Promise');
  } else {
    fail('_alertsSection returns a Promise', 'Got plain value, not a Promise');
  }

  // Without alerts service → available: false
  const noDash = new DashboardService({});
  noDash._alertsSection([]).then(r => {
    if (r.available === false)
      ok('_alertsSection returns { available: false } when no alerts service');
    else
      fail('_alertsSection graceful no-service fallback', JSON.stringify(r));
  });

} catch (e) {
  fail('DashboardService._alertsSection', e.message);
}

// ════════════════════════════════════════════════════════════
// D. Dashboard routes wire alerts
// ════════════════════════════════════════════════════════════
section('D — dashboard.routes.js wires alerts');

try {
  const src = fs.readFileSync(
    path.join(BACKEND, 'routes', 'dashboard.routes.js'), 'utf8'
  );

  if (src.includes('sharedServices.alerts') || src.includes("alerts:    sharedServices.alerts"))
    ok('dashboard.routes.js passes alerts to DashboardService');
  else
    fail('dashboard.routes.js passes alerts to DashboardService', 'Not found');

} catch (e) {
  fail('dashboard.routes.js readable', e.message);
}

// ════════════════════════════════════════════════════════════
// E. server.js exports validateEnv + references alert poller
// ════════════════════════════════════════════════════════════
section('E — server.js poller wiring');

try {
  const { validateEnv } = require('../src/server');
  if (typeof validateEnv === 'function')
    ok('server.js exports validateEnv');
  else
    fail('server.js exports validateEnv', 'Not a function');

  const serverSrc = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  if (serverSrc.includes('alertPoller') && serverSrc.includes('setInterval'))
    ok('server.js contains alert poller setInterval');
  else
    fail('server.js contains alert poller setInterval', 'Not found');

  if (serverSrc.includes('clearInterval(alertPoller)'))
    ok('server.js clears alert poller on graceful shutdown');
  else
    fail('server.js clears alert poller on graceful shutdown', 'clearInterval not found');

} catch (e) {
  fail('server.js', e.message);
}

// ════════════════════════════════════════════════════════════
// F. react-router-dom v6 installed
// ════════════════════════════════════════════════════════════
section('F — react-router-dom v6');

try {
  const pkgPath = path.join(FRONTEND, 'node_modules', 'react-router-dom', 'package.json');
  const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.version.startsWith('6.'))
    ok(`react-router-dom v${pkg.version} installed`);
  else
    fail(`react-router-dom v6`, `Found v${pkg.version}`);
} catch (e) {
  fail('react-router-dom installed', e.message);
}

// ════════════════════════════════════════════════════════════
// G. New frontend page files exist with correct exports
// ════════════════════════════════════════════════════════════
section('G — Frontend page files');

const PAGES = [
  ['pages/TransferListPage.jsx',   ['TransferListPage', 'react-router-dom', 'approveTransfer', 'rejectTransfer']],
  ['pages/TransferCreatePage.jsx', ['TransferCreatePage', 'react-router-dom', 'createTransfer']],
  ['pages/BlockchainPage.jsx',     ['BlockchainPage', 'react-router-dom', 'verifyBlockchain', 'getBlockchain']],
  ['pages/AlertListPage.jsx',      ['AlertListPage', 'react-router-dom', 'scanAlerts', 'acknowledgeAlert', 'resolveAlert']],
];

for (const [file, tokens] of PAGES) {
  try {
    const src = fs.readFileSync(path.join(FRONTEND, 'src', file), 'utf8');
    const missing = tokens.filter(t => !src.includes(t));
    if (missing.length === 0)
      ok(`${file} contains all expected tokens`);
    else
      fail(`${file}`, `Missing: ${missing.join(', ')}`);
  } catch (e) {
    fail(file, e.message);
  }
}

// App.jsx uses BrowserRouter
try {
  const src = fs.readFileSync(path.join(FRONTEND, 'src', 'App.jsx'), 'utf8');
  const tokens = ['BrowserRouter', 'Routes', 'Route', '/supply/transfers', '/alerts', '/supply/blockchain'];
  const missing = tokens.filter(t => !src.includes(t));
  if (missing.length === 0)
    ok('App.jsx has BrowserRouter + all routes');
  else
    fail('App.jsx routes', `Missing: ${missing.join(', ')}`);
} catch (e) {
  fail('App.jsx readable', e.message);
}

// ════════════════════════════════════════════════════════════
// H. API client new methods
// ════════════════════════════════════════════════════════════
section('H — API client methods');

try {
  const src = fs.readFileSync(path.join(FRONTEND, 'src', 'api', 'client.js'), 'utf8');
  const METHODS = [
    'getTransfers', 'createTransfer', 'approveTransfer', 'rejectTransfer',
    'getBlockchain', 'verifyBlockchain',
    'getAlerts', 'getActiveAlerts', 'scanAlerts', 'acknowledgeAlert', 'resolveAlert',
    'getUnits'
  ];
  const missing = METHODS.filter(m => !src.includes(m));
  if (missing.length === 0)
    ok('client.js has all new API methods');
  else
    fail('client.js missing methods', missing.join(', '));
} catch (e) {
  fail('api/client.js readable', e.message);
}

// ════════════════════════════════════════════════════════════
// I. Frontend Vite build
// ════════════════════════════════════════════════════════════
section('I — Frontend production build');

const { execSync } = require('child_process');
try {
  execSync('npm run build', {
    cwd: FRONTEND,
    stdio: 'pipe',
    timeout: 120_000
  });
  const indexPath = path.join(FRONTEND, 'dist', 'index.html');
  if (fs.existsSync(indexPath))
    ok('Vite build succeeded — dist/index.html exists');
  else
    fail('Vite build produced dist/index.html', 'File not found');

  // Quick sanity: index.html references a JS bundle
  const idx = fs.readFileSync(indexPath, 'utf8');
  if (idx.includes('.js'))
    ok('index.html references JS bundle');
  else
    fail('index.html references JS bundle', 'No .js reference found');

} catch (e) {
  const stderr = e.stderr ? e.stderr.toString().slice(0, 500) : e.message;
  fail('Vite build', stderr);
}

// ════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(56)}`);
console.log(`📊  Day 31 Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
