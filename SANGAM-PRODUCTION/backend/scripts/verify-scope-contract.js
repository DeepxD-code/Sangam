'use strict';

/**
 * HTTP Integration Smoke Test — Scope Contract Guard
 *
 * Background: Day 26 discovered that every Day 19-25 route's `scopeFor()`
 * helper called `auth.rbac.getCommandScope(...)` and used the result
 * directly with `.includes()`. RBACService.getCommandScope() actually
 * returns `{ ids: number[], codes: string[] }`, not a plain array.
 *
 * Unit tests using stub RBAC services (which returned plain arrays) never
 * caught this because the stub's contract didn't match the real service.
 *
 * This script boots the REAL Express app with the REAL AuthMiddleware,
 * RBACService, and a signed JWT — then hits every scoped route to confirm
 * no 500 errors occur. This is the only test in the suite that exercises
 * the full HTTP stack end-to-end rather than calling services directly.
 *
 * Run this after ANY change to scope-handling logic in route files.
 */

const jwt  = require('jsonwebtoken');
const http = require('http');
const createApp = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 1, username: 'capt.test', displayName: 'Capt Test',
    role: 'SENIOR_OFFICER', unitId: 10, unitCode: 'A-COY',
    ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function get(port, path, token) {
  return new Promise((resolve, reject) => {
    http.get({ port, path, headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function run() {
  const app    = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, resolve));
  const port  = server.address().port;
  const token = makeToken(); // SENIOR_OFFICER has broad permissions

  // Every scoped GET route across Days 19-25 (the ones that use scopeFor())
  const routes = [
    '/api/supply/items',
    '/api/supply/transfers',
    '/api/supply/blockchain',
    '/api/supply/stats',
    '/api/units',
    '/api/units/hierarchy',
    '/api/users',
    '/api/users/stats',
    '/api/movement/orders',
    '/api/movement/orders/unit/10/active',
    '/api/inventory/sessions?unitId=10',
    '/api/inventory/sessions/active?unitId=10',
    '/api/bulk/limits',
    '/api/compliance/summary',
    '/api/compliance/transfer-register',
    '/api/compliance/discrepancy-report'
  ];

  console.log('\n🔒 HTTP Integration Smoke Test — Scope Contract Guard\n');

  for (const path of routes) {
    try {
      const { status, body } = await get(port, path, token);
      if (status >= 500) {
        console.error(`  ❌ ${path} → ${status} (SERVER ERROR) ${body.slice(0, 150)}`);
        failed++;
      } else {
        console.log(`  ✅ ${path} → ${status}`);
        passed++;
      }
    } catch (err) {
      console.error(`  ❌ ${path} → request failed: ${err.message}`);
      failed++;
    }
  }

  server.close();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Scope Contract Guard Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\n⚠️  One or more routes threw a 500 — check scopeFor() unwraps {ids,codes} correctly.');
    process.exitCode = 1;
  }
}

run().catch(err => { console.error(err); process.exit(1); });
