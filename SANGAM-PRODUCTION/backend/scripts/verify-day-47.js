'use strict';

/**
 * Day 47 Verification — Unit Detail Page (drill-down from dashboard)
 *
 * The backend already had GET /:id, /:id/hierarchy, /:id/stats, PUT /:id,
 * and the admin toggles — Day 47 is primarily a frontend build (UnitsPage
 * tree view + UnitDetailPage aggregate view), plus one small backend
 * addition: GET /api/users now accepts a unitId filter (mirroring the
 * pattern GET /api/supply/items already had) so the detail page can pull
 * a single unit's roster instead of its whole command scope. This script
 * proves that addition over real HTTP, then does static/build checks for
 * everything else Day 47 touched.
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

function request(port, method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: urlPath, method,
      headers: { Authorization: `Bearer ${token}` } }, (res) => {
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
  const app = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const services = app.locals.services;

  try {
    console.log('\n🏗  Group A: fixtures');
    const unitA = (await services.units.createUnit({
      unitName: 'Day47 Coy A', unitType: 'COMPANY', unitCode: 'D47-A'
    })).unit;
    const unitB = (await services.units.createUnit({
      unitName: 'Day47 Coy B', unitType: 'COMPANY', unitCode: 'D47-B'
    })).unit;
    const userA1 = (await services.users.createUser({
      username: 'd47.a1', displayName: 'Day47 A1', role: 'SOLDIER', unitId: unitA.id
    })).user;
    const userB1 = (await services.users.createUser({
      username: 'd47.b1', displayName: 'Day47 B1', role: 'SOLDIER', unitId: unitB.id
    })).user;
    check('fixtures created', !!(unitA?.id && unitB?.id && userA1?.id && userB1?.id));

    const token = makeToken({ unitId: unitA.id, unitCode: unitA.unitCode });

    console.log('\n🔎 Group B: GET /api/units/:id, /stats, /hierarchy (pre-existing, still intact)');
    {
      const r = await request(port, 'GET', `/api/units/${unitA.id}`, token);
      check('GET /api/units/:id → 200 with matching unit', r.status === 200 && r.json?.unit?.id === unitA.id);
    }
    {
      const r = await request(port, 'GET', `/api/units/${unitA.id}/stats`, token);
      check('GET /api/units/:id/stats → 200 with directChildCount field',
        r.status === 200 && typeof r.json?.stats?.directChildCount === 'number');
    }
    {
      const r = await request(port, 'GET', `/api/units/${unitA.id}/hierarchy`, token);
      check('GET /api/units/:id/hierarchy → 200 with tree', r.status === 200 && !!r.json?.tree);
    }
    {
      const r = await request(port, 'GET', '/api/units/hierarchy', token);
      check('GET /api/units/hierarchy → 200 with tree array', r.status === 200 && Array.isArray(r.json?.tree));
    }

    console.log('\n🆕 Group C: GET /api/users?unitId= (new filter added for the roster panel)');
    {
      const r = await request(port, 'GET', `/api/users?unitId=${unitA.id}`, token);
      const ids = (r.json?.users || []).map(u => u.id);
      check('unitId filter returns only unitA\'s user', r.status === 200 && ids.includes(userA1.id) && !ids.includes(userB1.id),
        `got ids: ${JSON.stringify(ids)}`);
    }
    {
      const unitBToken = makeToken({ userId: 9003, unitId: unitB.id, unitCode: unitB.unitCode });
      const r = await request(port, 'GET', `/api/users?unitId=${unitB.id}`, unitBToken);
      const ids = (r.json?.users || []).map(u => u.id);
      check('unitId filter returns only unitB\'s user', r.status === 200 && ids.includes(userB1.id) && !ids.includes(userA1.id),
        `got ids: ${JSON.stringify(ids)}`);
    }
    {
      // Out-of-scope unitId must still be rejected, same guard supply/items already has
      const otherToken = makeToken({ userId: 9002, unitId: unitB.id, unitCode: unitB.unitCode });
      const r = await request(port, 'GET', `/api/users?unitId=${unitA.id}`, otherToken);
      check('unitId filter still enforces scope (403 for out-of-scope unit)', r.status === 403,
        `got ${r.status}`);
    }

    console.log('\n🔎 Group D: GET /api/supply/items?unitId= and movement active-by-unit (pre-existing, used by new page)');
    {
      const r = await request(port, 'GET', `/api/supply/items?unitId=${unitA.id}`, token);
      check('GET /api/supply/items?unitId= → 200', r.status === 200 && Array.isArray(r.json?.items));
    }
    {
      const r = await request(port, 'GET', `/api/movement/orders/unit/${unitA.id}/active`, token);
      check('GET /api/movement/orders/unit/:unitId/active → 200', r.status === 200 && Array.isArray(r.json?.orders));
    }

  } finally {
    server.close();
  }

  console.log('\n🗂  Group E: frontend files exist and are wired up');
  const FRONT = path.join(__dirname, '../../frontend/src');
  const unitsPagePath  = path.join(FRONT, 'pages/UnitsPage.jsx');
  const detailPagePath = path.join(FRONT, 'pages/UnitDetailPage.jsx');
  check('UnitsPage.jsx exists', fs.existsSync(unitsPagePath));
  check('UnitDetailPage.jsx exists', fs.existsSync(detailPagePath));

  const appJsx = fs.readFileSync(path.join(FRONT, 'App.jsx'), 'utf8');
  check('App.jsx routes /units', /path="\/units"/.test(appJsx));
  check('App.jsx routes /units/:id', /path="\/units\/:id"/.test(appJsx));

  const sidebarJsx = fs.readFileSync(path.join(FRONT, 'components/Sidebar.jsx'), 'utf8');
  check('Sidebar.jsx links to /units', /to:\s*'\/units'/.test(sidebarJsx));

  const clientJs = fs.readFileSync(path.join(FRONT, 'api/client.js'), 'utf8');
  for (const fn of ['getUnit(', 'getUnitStats(', 'getUnitSubtree(', 'getUnitsHierarchy(',
                     'updateUnit(', 'deactivateUnit(', 'reactivateUnit(', 'getActiveOrdersForUnit(']) {
    check(`client.js defines ${fn.replace('(', '()')}`, clientJs.includes(fn));
  }
  const dupCategories = (clientJs.match(/async getSupplyCategories/g) || []).length;
  check('client.js has no duplicate getSupplyCategories definition', dupCategories === 1, `found ${dupCategories}`);

  console.log('\n🏗  Group F: frontend production build succeeds');
  try {
    execSync('npm run build', { cwd: path.join(__dirname, '../../frontend'), stdio: 'pipe' });
    check('vite build succeeds with the new pages included', true);
  } catch (e) {
    check('vite build succeeds with the new pages included', false, e.stdout?.toString().slice(-500));
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 47 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
