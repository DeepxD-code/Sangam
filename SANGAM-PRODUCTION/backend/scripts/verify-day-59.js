'use strict';

/**
 * Day 59 Verification — Health Contract & Demo Seeder Idempotency
 *
 * Day 59 covered three items:
 *   1. Dashboard tour-prompt banner — pure frontend UI (onStartTour was
 *      already being passed to every page via pageProps but DashboardPage
 *      never consumed it). Verified via `vite build` succeeding and code
 *      review; not independently HTTP-testable.
 *   2. ReportsPage DB-availability warning — the four CSV export types
 *      query Postgres directly and silently produced empty files with no
 *      explanation when db is null (this app's primary, default mode).
 *      Fixed by checking GET /health once on mount. This script verifies
 *      the health contract ReportsPage now depends on.
 *   3. Demo seeder idempotency + a real startup path — discovered that
 *      `npm run seed:demo` could never actually populate a real running
 *      server (its CLI path builds disposable, disconnected services that
 *      vanish on exit), and that re-running seedDemoData() against the
 *      same services would duplicate every unit/item/user. Fixed with an
 *      opt-in SEED_DEMO_DATA=true hook in server.js (NOT independently
 *      testable here — it requires a real Postgres connection this sandbox
 *      doesn't have; verified by code review + syntax check only, and
 *      flagged for verification in a real environment) and an idempotency
 *      guard in seedDemoData() itself, which IS fully testable here.
 */

const jwt       = require('jsonwebtoken');
const http      = require('http');
const createApp = require('../src/app');
const { seedDemoData } = require('../scripts/seed-demo-data.js');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 9301, username: 'test.actor', role: 'SYSTEM_ADMIN',
    unitId: 1, unitCode: 'TST', ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: urlPath, method,
      headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  process.env.JWT_SECRET = JWT_SECRET;

  // ── Group A: Health contract (ReportsPage's DB-availability check) ──
  console.log('\n🏥 Group A: Health contract in offline mode');
  {
    const app    = createApp(null, {}, { logLevel: false });
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    // /health requires no auth
    const r = await request(port, 'GET', '/health', null);
    check('A-01 /health reachable without a token', r.status === 503 || r.status === 200);
    check('A-02 db.connected is false when db=null', r.json?.db?.connected === false, JSON.stringify(r.json));
    check('A-03 status code is 503 when db is null (by design — see health.routes.js)', r.status === 503);
    check('A-04 db.latencyMs is null when disconnected', r.json?.db?.latencyMs === null);
    check('A-05 shape includes version/nodeEnv/uptime', typeof r.json?.version === 'string' && typeof r.json?.uptime === 'number');

    server.close();
  }

  // ── Group B: Demo seeder idempotency ─────────────────────────────────
  console.log('\n🌱 Group B: seedDemoData() idempotency (the server.js SEED_DEMO_DATA=true path calls this exact function)');
  {
    const app = createApp(null, {}, { logLevel: false });

    const first = await seedDemoData(app.locals.services);
    check('B-01 first call succeeds normally (not alreadySeeded)', first?.alreadySeeded !== true);
    check('B-02 first call reports item/transfer counts', first.itemCount > 0 && first.transferCount > 0, JSON.stringify({ itemCount: first.itemCount, transferCount: first.transferCount }));

    const unitCountAfterFirst = app.locals.services.units.getUnitIds().length;
    check('B-03 units were actually created', unitCountAfterFirst > 0);

    // The critical assertion: call it again on the SAME services, exactly
    // as would happen if a startup hook or process manager ever
    // accidentally re-triggered SEED_DEMO_DATA=true seeding within the
    // same process lifetime.
    const second = await seedDemoData(app.locals.services);
    check('B-04 second call detects prior seeding', second?.alreadySeeded === true, JSON.stringify(second));

    const unitCountAfterSecond = app.locals.services.units.getUnitIds().length;
    check('B-05 unit count unchanged after second call (no duplication)', unitCountAfterSecond === unitCountAfterFirst,
      `first=${unitCountAfterFirst}, second=${unitCountAfterSecond}`);
  }
  {
    // A fresh, separate services object should seed normally — the guard
    // is per-services-instance (via a real UNIT_CODE_EXISTS check against
    // that instance's own state), not a global flag.
    const app2 = createApp(null, {}, { logLevel: false });
    const result = await seedDemoData(app2.locals.services);
    check('B-06 a different, fresh services instance seeds normally (guard is instance-scoped, not global)',
      result?.alreadySeeded !== true && result.itemCount > 0);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 59 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
