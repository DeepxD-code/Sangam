'use strict';

/**
 * HTTP Integration Smoke Test — Notification Wiring Contract Guard
 *
 * Background: Day 58 discovered that notification.routes.js's factory
 * function declared only `(db, sharedAudit)`, silently ignoring the
 * shared NotificationService instance app.js has always passed as a
 * third argument (`createNotificationRoutes(db, audit, notifications)`).
 * JavaScript does not error on extra call arguments a function doesn't
 * declare — they're simply dropped — so the routes quietly constructed
 * their OWN separate NotificationService, with its own separate _store.
 *
 * Every other service that creates notifications (SupplyChainService,
 * MovementOrderService, InventoryLedgerService, DelegationService, ...)
 * was correctly constructed with the SHARED instance. The practical
 * effect: since Day 42, any notification triggered by a real domain
 * action (low stock, transfer pending/approved/rejected, etc.) was
 * written to a store the HTTP notification endpoints never read from —
 * GET /notifications, /unread-count, and /digest would never show it,
 * for any user, regardless of role or scope. Preference reads/writes
 * happened to still "work" in isolation because they don't depend on
 * cross-service data, which is exactly why this went unnoticed: no
 * earlier test exercised the full path of "another service creates a
 * notification via the shared instance" → "read it back over real HTTP".
 *
 * Fixed by declaring and using `sharedNotifications` as a third
 * parameter, matching the working pattern already used by
 * delegation.routes.js, reporting.routes.js, supply.routes.js, and
 * compliance.routes.js.
 *
 * This script boots the REAL app, creates a notification via
 * `app.locals.services.notifications` directly (the same object every
 * other service is constructed with) and confirms it is visible over
 * real HTTP — the only way this bug class can be reliably caught.
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
    userId: 8801, username: 'wiring.guard', role: 'SOLDIER',
    unitId: 1, unitCode: 'TST', ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      port, path: urlPath, method,
      headers: { Authorization: `Bearer ${token}` }
    }, (res) => {
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
  const app    = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const token = makeToken();

  try {
    // The critical assertion: use app.locals.services.notifications
    // directly, exactly as SupplyChainService/MovementOrderService/etc.
    // do internally — NOT a fresh instance, NOT the HTTP POST / route.
    const shared = app.locals.services.notifications;
    check('setup: app.locals.services.notifications exists', !!shared);

    await shared.create({
      type: 'LOW_STOCK', title: 'Wiring guard probe', message: 'probe',
      severity: 'HIGH', targetUserId: 8801
    });

    {
      const r = await request(port, 'GET', '/api/notifications/unread-count', token);
      check('unread-count sees a notification created via the shared instance',
        r.status === 200 && r.json?.unreadCount >= 1, `got ${JSON.stringify(r.json)}`);
    }
    {
      const r = await request(port, 'GET', '/api/notifications', token);
      check('GET /notifications list includes it',
        r.status === 200 && r.json?.notifications?.some(n => n.title === 'Wiring guard probe'));
    }
    {
      const r = await request(port, 'GET', '/api/notifications/digest', token);
      check('GET /notifications/digest includes it', r.status === 200 && r.json?.total >= 1);
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Notification Wiring Contract Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
