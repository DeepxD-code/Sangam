'use strict';

/**
 * Day 61 Verification — Rate Limiting Beyond Login
 *
 * Before Day 61, RateLimiter (Day 22) was applied only to /auth/login.
 * This adds it to the four bulk-operation endpoints (each can create or
 * modify many records per call — a higher-impact abuse surface than any
 * single-record endpoint) and emergency override creation (a
 * security-sensitive "break glass" path that should be rare by design).
 * Both keyed by authenticated user, not IP.
 *
 * This script confirms the limiter actually trips (429 after the
 * threshold), that it's per-user (a different user isn't blocked by
 * someone else's usage), and that it doesn't interfere with normal,
 * within-limit usage (already indirectly confirmed by Day 21 and Day 57
 * still passing in full after this change, but tested explicitly here
 * too).
 */

const jwt       = require('jsonwebtoken');
const http      = require('http');
const createApp = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 9701, username: 'test.actor', role: 'SYSTEM_ADMIN',
    unitId: 1, unitCode: 'TST', ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      port, path: urlPath, method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  process.env.JWT_SECRET = JWT_SECRET;
  const app    = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const unitA = (await app.locals.services.units.createUnit({
      unitName: 'D61 Alpha Company', unitType: 'COMPANY', unitCode: 'D61-A'
    })).unit;

    // ── Group A: Bulk operations rate limit (20 / 5min / user) ──────
    console.log('\n🚦 Group A: Bulk operations rate limit');
    const bulkUser = makeToken({ userId: 9801, unitId: unitA.id, unitCode: unitA.unitCode, role: 'SYSTEM_ADMIN' });

    let last429 = null;
    let allowedCount = 0;
    let firstStatus = null;
    for (let i = 0; i < 22; i++) {
      const r = await request(port, 'POST', '/api/bulk/update-quantity', bulkUser, {
        updates: [{ itemId: 999999, quantity: 5 }] // itemId need not exist — bulk ops use partial-success semantics (207 either way); only the rate limiter should ever block this
      });
      if (i === 0) firstStatus = r.status;
      if (r.status === 429) { last429 = r; break; }
      allowedCount++;
    }
    // Sanity check first, so a mis-routed URL or wrong body shape can't
    // silently pass as "22 requests allowed" the way it did during Day 61
    // development — this loop only breaks on 429, so any other status
    // just counts as "allowed" unless something explicitly checks it's
    // the real success status (207 Multi-Status for this endpoint).
    check('A-00 sanity: the endpoint is actually reachable (got 207, not 404/other)', firstStatus === 207, `first request returned ${firstStatus}`);
    check('A-01 first 20 requests are allowed through (not 429)', allowedCount === 20, `allowed ${allowedCount} before a 429`);
    check('A-02 the 21st request is rejected with 429', !!last429, 'never hit a 429 within 22 attempts');
    check('A-03 429 body has RATE_LIMIT_EXCEEDED', last429?.json?.error === 'RATE_LIMIT_EXCEEDED');
    check('A-04 Retry-After header present', !!last429?.headers?.['retry-after']);

    // ── Group B: rate limiting is per-user, not global ──────────────
    console.log('\n👥 Group B: rate limit is per-user');
    const otherUser = makeToken({ userId: 9802, unitId: unitA.id, unitCode: unitA.unitCode, role: 'SYSTEM_ADMIN' });
    const rOther = await request(port, 'POST', '/api/bulk/update-quantity', otherUser, { updates: [{ itemId: 999999, quantity: 5 }] });
    check('B-01 a different user is NOT blocked by the first user hitting the limit', rOther.status !== 429, `got ${rOther.status}`);

    // ── Group C: emergency override rate limit (5 / hour / user) ────
    console.log('\n🚨 Group C: emergency override rate limit');
    const overrideUser = makeToken({ userId: 9803, unitId: unitA.id, unitCode: unitA.unitCode, role: 'SOLDIER' });
    let overrideCount = 0, override429 = null;
    for (let i = 0; i < 7; i++) {
      const r = await request(port, 'POST', '/api/delegation/overrides', overrideUser, {
        permission: 'supply:read', justification: `D61 rate limit test attempt ${i}`
      });
      if (r.status === 429) { override429 = r; break; }
      overrideCount++;
    }
    check('C-01 first 5 override attempts allowed through', overrideCount === 5, `allowed ${overrideCount} before a 429`);
    check('C-02 the 6th is rejected with 429', !!override429, 'never hit a 429 within 7 attempts');
    check('C-03 a DIFFERENT user issuing an override is unaffected', (
      await request(port, 'POST', '/api/delegation/overrides', makeToken({ userId: 9804, unitId: unitA.id, unitCode: unitA.unitCode, role: 'SOLDIER' }), {
        permission: 'supply:read', justification: 'D61 different-user control check'
      })
    ).status !== 429);

    // ── Group D: login's original limiter is untouched ──────────────
    console.log('\n🔐 Group D: login rate limiting still works (regression check)');
    let loginAllowed = 0, login429 = null;
    for (let i = 0; i < 12; i++) {
      const r = await request(port, 'POST', '/api/auth/login', null, { username: 'nonexistent.user', password: 'wrong' });
      if (r.status === 429) { login429 = r; break; }
      loginAllowed++;
    }
    check('D-01 login rate limiting (Day 22, unmodified) still trips correctly', !!login429, `allowed ${loginAllowed} attempts without a 429`);

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 61 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
