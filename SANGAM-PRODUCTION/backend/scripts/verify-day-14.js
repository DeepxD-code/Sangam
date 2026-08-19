'use strict';

/**
 * SANGAM Day 14 — Verification Suite
 * Tests: password hashing/strength, login (success/failure/lockout/
 * auto-unlock), refresh rotation + reuse detection, logout, password
 * change, admin unlock, rate limiting, and the Day14→13→11 integration
 * loop (account lock → audit SECURITY event → notification).
 *
 * No real database required — DB-dependent AuthService methods are
 * tested against lightweight FIFO and stateful mocks.
 *
 * Run: node backend/scripts/verify-day-14.js
 */

const path = require('path');

const RBACService        = require(path.join(__dirname, '../src/services/rbac.service'));
const AuditLogService     = require(path.join(__dirname, '../src/services/audit-log.service'));
const NotificationService = require(path.join(__dirname, '../src/services/notification.service'));
const AuthMiddleware      = require(path.join(__dirname, '../src/middleware/auth.middleware'));
const AuthService         = require(path.join(__dirname, '../src/services/auth.service'));
const RateLimiter         = require(path.join(__dirname, '../src/services/rate-limiter.service'));

// ============================================================
// Minimal test framework
// ============================================================
let passed = 0;
let failed = 0;
const failures = [];

async function test(label, fn) {
  try {
    await fn();
    process.stdout.write(`  ✅  ${label}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  ❌  ${label}\n       → ${err.message}\n`);
    failed++;
    failures.push({ label, error: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

async function assertThrows(fn, expectedSubstr) {
  let threw = false;
  try { await fn(); } catch (e) {
    threw = true;
    if (expectedSubstr) assert(e.message.includes(expectedSubstr),
      `Expected error containing "${expectedSubstr}", got "${e.message}"`);
  }
  assert(threw, 'Expected function to throw/reject');
}

function section(name) {
  console.log(`\n📋  ${name}`);
}

// ============================================================
// MOCK DB HELPERS
// ============================================================

/** FIFO queue mock — each call pops the next queued response. */
function makeMockDb(responses = []) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const next = queue.shift();
      return next !== undefined ? next : { rows: [] };
    }
  };
}

/**
 * Stateful single-user mock — simulates the users table for ONE row,
 * applying the same UPDATE patterns AuthService issues. Lets the
 * integration test run multiple sequential login() calls and observe
 * cumulative lockout state.
 */
function makeStatefulUserDb(initialUser) {
  const state = { ...initialUser };
  const calls = [];
  return {
    state, calls,
    query: async (sql, params) => {
      calls.push({ sql, params });

      if (sql.includes('FROM users') && sql.includes('SELECT')) {
        return { rows: [{ ...state }] };
      }
      if (sql.includes('account_locked = true')) {
        state.account_locked = true;
        state.locked_until = params[0];
        return { rows: [] };
      }
      if (sql.includes('failed_login_count = 0')) {
        state.failed_login_count = 0;
        state.account_locked = false;
        state.locked_until = null;
        return { rows: [] };
      }
      if (sql.includes('failed_login_count = $1')) {
        state.failed_login_count = params[0];
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

// ============================================================
// FIXTURES
// ============================================================
function buildRBAC() {
  const rbac = new RBACService(null);
  rbac._hierarchyCache.set('scope_103', { ids: [103], codes: [] });
  return rbac;
}

// ============================================================
// TEST SUITES
// ============================================================
async function run() {
  console.log('\n🔑  SANGAM Day 14 — Auth Login Flow Verification');
  console.log('═'.repeat(56));
  console.log(`Started: ${new Date().toISOString()}\n`);

  // ──────────────────────────────────────────────────────────
  section('1 · Constants');
  // ──────────────────────────────────────────────────────────

  await test('BCRYPT_ROUNDS is 12', () => {
    assert(AuthService.BCRYPT_ROUNDS === 12);
  });
  await test('MAX_FAILED_ATTEMPTS is 5', () => {
    assert(AuthService.MAX_FAILED_ATTEMPTS === 5);
  });
  await test('LOCKOUT_DURATION_MS is 15 minutes', () => {
    assert(AuthService.LOCKOUT_DURATION_MS === 15 * 60 * 1000);
  });
  await test('REFRESH_TOKEN_TTL_MS is 30 days', () => {
    assert(AuthService.REFRESH_TOKEN_TTL_MS === 30 * 24 * 60 * 60 * 1000);
  });

  // ──────────────────────────────────────────────────────────
  section('2 · Password Hashing');
  // ──────────────────────────────────────────────────────────

  await test('hashPassword produces a bcrypt-format hash', async () => {
    const svc = new AuthService(null);
    const hash = await svc.hashPassword('CorrectPass123');
    assert(hash.startsWith('$2'), `Expected bcrypt hash, got: ${hash.slice(0,4)}...`);
    assert(hash !== 'CorrectPass123', 'Hash must not equal plaintext');
  });

  await test('verifyPassword true for correct password', async () => {
    const svc = new AuthService(null);
    const hash = await svc.hashPassword('CorrectPass123');
    assert(await svc.verifyPassword('CorrectPass123', hash) === true);
  });

  await test('verifyPassword false for incorrect password', async () => {
    const svc = new AuthService(null);
    const hash = await svc.hashPassword('CorrectPass123');
    assert(await svc.verifyPassword('WrongPass123', hash) === false);
  });

  await test('verifyPassword false (not throw) for null hash', async () => {
    const svc = new AuthService(null);
    assert(await svc.verifyPassword('anything', null) === false);
  });

  await test('Different pepper → hash from one instance does not verify on another', async () => {
    const a = new AuthService(null, null, 'pepperA');
    const b = new AuthService(null, null, 'pepperB');
    const hash = await a.hashPassword('Secret123');
    assert(await a.verifyPassword('Secret123', hash) === true);
    assert(await b.verifyPassword('Secret123', hash) === false);
  });

  // ──────────────────────────────────────────────────────────
  section('3 · Password Strength Validation');
  // ──────────────────────────────────────────────────────────

  await test('Rejects passwords under 8 characters', () => {
    const svc = new AuthService(null);
    const r = svc.validatePasswordStrength('Ab1');
    assert(r.valid === false);
    assert(r.issues.some(i => i.includes('8 characters')));
  });

  await test('Rejects missing uppercase', () => {
    const svc = new AuthService(null);
    const r = svc.validatePasswordStrength('lowercase123');
    assert(r.valid === false);
    assert(r.issues.some(i => i.includes('uppercase')));
  });

  await test('Rejects missing lowercase', () => {
    const svc = new AuthService(null);
    const r = svc.validatePasswordStrength('UPPERCASE123');
    assert(r.valid === false);
    assert(r.issues.some(i => i.includes('lowercase')));
  });

  await test('Rejects missing digit', () => {
    const svc = new AuthService(null);
    const r = svc.validatePasswordStrength('NoDigitsHere');
    assert(r.valid === false);
    assert(r.issues.some(i => i.includes('digit')));
  });

  await test('Accepts a strong password with zero issues', () => {
    const svc = new AuthService(null);
    const r = svc.validatePasswordStrength('Str0ngPass');
    assert(r.valid === true);
    assert(r.issues.length === 0);
  });

  await test('Handles empty/undefined password without throwing', () => {
    const svc = new AuthService(null);
    const r1 = svc.validatePasswordStrength('');
    const r2 = svc.validatePasswordStrength(undefined);
    assert(r1.valid === false && r1.issues.length > 0);
    assert(r2.valid === false && r2.issues.length > 0);
  });

  // ──────────────────────────────────────────────────────────
  section('4 · DB-required guard');
  // ──────────────────────────────────────────────────────────

  await test('login() throws DATABASE_REQUIRED with no db', async () => {
    const svc = new AuthService(null);
    await assertThrows(() => svc.login({ username: 'x', password: 'y' }), 'DATABASE_REQUIRED');
  });

  await test('refresh() throws DATABASE_REQUIRED with no db', async () => {
    const svc = new AuthService(null);
    await assertThrows(() => svc.refresh('sometoken'), 'DATABASE_REQUIRED');
  });

  // ──────────────────────────────────────────────────────────
  section('5 · Login — User Not Found');
  // ──────────────────────────────────────────────────────────

  await test('Unknown username → generic INVALID_CREDENTIALS', async () => {
    const db = makeMockDb([{ rows: [] }]);
    const audit = new AuditLogService(null);
    const svc = new AuthService(db, audit);

    const r = await svc.login({ username: 'ghost', password: 'whatever' });
    assert(r.success === false);
    assert(r.error === 'INVALID_CREDENTIALS');
    assert(r.message && !r.message.toLowerCase().includes('not found'),
      'Message must not leak whether the username exists');
  });

  await test('AUTH_FAILED audited with reason USER_NOT_FOUND', async () => {
    const db = makeMockDb([{ rows: [] }]);
    const audit = new AuditLogService(null);
    let captured = null;
    audit.on('log', e => { if (e.action === 'AUTH_FAILED') captured = e; });
    const svc = new AuthService(db, audit);

    await svc.login({ username: 'ghost', password: 'whatever' });
    assert(captured !== null);
    const details = JSON.parse(captured.details);
    assert(details.reason === 'USER_NOT_FOUND');
  });

  // ──────────────────────────────────────────────────────────
  section('6 · Login — Success');
  // ──────────────────────────────────────────────────────────

  await test('Correct credentials → tokens issued, account reset', async () => {
    const audit = new AuditLogService(null);
    const hashSvc = new AuthService(null);
    const correctHash = await hashSvc.hashPassword('CorrectPass123');

    const db = makeMockDb([
      { rows: [{
        id: 7, username: 'jco_ram', password_hash: correctHash,
        display_name: 'JCO Ram', role: 'JCO', unit_id: 103, unit_code: 'PL-1-A',
        failed_login_count: 0, account_locked: false, locked_until: null
      }]},
      { rows: [] }, // reset UPDATE
      { rows: [] }  // INSERT refresh_token
    ]);

    const svc = new AuthService(db, audit);
    const r = await svc.login({ username: 'jco_ram', password: 'CorrectPass123', ipAddress: '10.0.0.5' });

    assert(r.success === true);
    assert(typeof r.accessToken === 'string' && r.accessToken.split('.').length === 3);

    const decoded = AuthMiddleware.decodeToken(r.accessToken);
    assert(decoded.userId === 7 && decoded.role === 'JCO' && decoded.unitCode === 'PL-1-A');

    assert(/^[0-9a-f]{128}$/.test(r.refreshToken), 'refreshToken should be 128-char hex');
    assert(r.user.username === 'jco_ram');

    // Reset UPDATE issued
    assert(db.calls[1].sql.includes('failed_login_count = 0'));
    // Refresh token persisted
    assert(db.calls[2].sql.includes('INSERT INTO refresh_tokens'));
  });

  await test('Successful login emits AUTHENTICATE (success) audit entry', async () => {
    const audit = new AuditLogService(null);
    const hashSvc = new AuthService(null);
    const correctHash = await hashSvc.hashPassword('CorrectPass123');

    const db = makeMockDb([
      { rows: [{ id: 7, username: 'jco_ram', password_hash: correctHash,
                  display_name: 'JCO Ram', role: 'JCO', unit_id: 103, unit_code: 'PL-1-A',
                  failed_login_count: 0, account_locked: false, locked_until: null }] },
      { rows: [] }, { rows: [] }
    ]);

    let captured = null;
    audit.on('log', e => { if (e.action === 'AUTHENTICATE') captured = e; });

    const svc = new AuthService(db, audit);
    await svc.login({ username: 'jco_ram', password: 'CorrectPass123' });

    assert(captured !== null && captured.success === true);
  });

  await test('refreshExpiresAt is ~30 days out', async () => {
    const audit = new AuditLogService(null);
    const hashSvc = new AuthService(null);
    const correctHash = await hashSvc.hashPassword('CorrectPass123');
    const db = makeMockDb([
      { rows: [{ id: 7, username: 'u', password_hash: correctHash, display_name: 'U', role: 'JCO',
                  unit_id: 103, unit_code: 'PL-1-A', failed_login_count: 0, account_locked: false, locked_until: null }] },
      { rows: [] }, { rows: [] }
    ]);
    const svc = new AuthService(db, audit);
    const r = await svc.login({ username: 'u', password: 'CorrectPass123' });

    const spanMs = new Date(r.refreshExpiresAt) - Date.now();
    assert(Math.abs(spanMs - AuthService.REFRESH_TOKEN_TTL_MS) < 5000);
  });

  // ──────────────────────────────────────────────────────────
  section('7 · Login — Wrong Password');
  // ──────────────────────────────────────────────────────────

  await test('Wrong password → INVALID_CREDENTIALS, counter incremented', async () => {
    const audit = new AuditLogService(null);
    const hashSvc = new AuthService(null);
    const correctHash = await hashSvc.hashPassword('CorrectPass123');

    const db = makeMockDb([
      { rows: [{ id: 7, username: 'jco_ram', password_hash: correctHash,
                  display_name: 'JCO Ram', role: 'JCO', unit_id: 103, unit_code: 'PL-1-A',
                  failed_login_count: 0, account_locked: false, locked_until: null }] },
      { rows: [] } // increment UPDATE
    ]);

    const svc = new AuthService(db, audit);
    const r = await svc.login({ username: 'jco_ram', password: 'WrongPass999' });

    assert(r.success === false && r.error === 'INVALID_CREDENTIALS');
    assert(db.calls[1].sql.includes('failed_login_count = $1'));
    assert(db.calls[1].params[0] === 1, `Expected count 1, got ${db.calls[1].params[0]}`);
  });

  await test('AUTH_FAILED on wrong password includes role/unitCode (user was found)', async () => {
    const audit = new AuditLogService(null);
    const hashSvc = new AuthService(null);
    const correctHash = await hashSvc.hashPassword('CorrectPass123');
    const db = makeMockDb([
      { rows: [{ id: 7, username: 'jco_ram', password_hash: correctHash,
                  display_name: 'JCO Ram', role: 'JCO', unit_id: 103, unit_code: 'PL-1-A',
                  failed_login_count: 2, account_locked: false, locked_until: null }] },
      { rows: [] }
    ]);

    let captured = null;
    audit.on('log', e => { if (e.action === 'AUTH_FAILED') captured = e; });

    const svc = new AuthService(db, audit);
    await svc.login({ username: 'jco_ram', password: 'WrongPass999' });

    assert(captured.roleName === 'JCO');
    assert(captured.unitCode === 'PL-1-A');
    assert(JSON.parse(captured.details).reason === 'INVALID_PASSWORD');
  });

  // ──────────────────────────────────────────────────────────
  section('8 · Login — Lockout on 5th Failure');
  // ──────────────────────────────────────────────────────────

  await test('5th wrong password locks the account and audits USER_LOCK (SECURITY)', async () => {
    const audit = new AuditLogService(null);
    const hashSvc = new AuthService(null);
    const correctHash = await hashSvc.hashPassword('CorrectPass123');

    const db = makeMockDb([
      { rows: [{ id: 7, username: 'jco_ram', password_hash: correctHash,
                  display_name: 'JCO Ram', role: 'JCO', unit_id: 103, unit_code: 'PL-1-A',
                  failed_login_count: 4, account_locked: false, locked_until: null }] },
      { rows: [] }, // increment to 5
      { rows: [] }  // lock UPDATE
    ]);

    let lockEvent = null;
    audit.on('log', e => { if (e.action === 'USER_LOCK') lockEvent = e; });

    const svc = new AuthService(db, audit);
    const r = await svc.login({ username: 'jco_ram', password: 'WrongPass999' });

    assert(r.error === 'INVALID_CREDENTIALS', '5th attempt itself still reports invalid creds');
    assert(db.calls.some(c => c.sql.includes('account_locked = true')), 'lock UPDATE issued');
    assert(lockEvent !== null);
    assert(lockEvent.severity === 'SECURITY');
    assert(lockEvent.success === false);
  });

  // ──────────────────────────────────────────────────────────
  section('9 · Login — Account Locked (Not Expired)');
  // ──────────────────────────────────────────────────────────

  await test('Locked + not expired → ACCOUNT_LOCKED, no password check performed', async () => {
    const audit = new AuditLogService(null);
    const futureLock = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const db = makeMockDb([
      { rows: [{ id: 7, username: 'jco_ram', password_hash: 'irrelevant',
                  display_name: 'JCO Ram', role: 'JCO', unit_id: 103, unit_code: 'PL-1-A',
                  failed_login_count: 5, account_locked: true, locked_until: futureLock }] }
    ]);

    const svc = new AuthService(db, audit);
    const r = await svc.login({ username: 'jco_ram', password: 'AnyPassword123' });

    assert(r.success === false);
    assert(r.error === 'ACCOUNT_LOCKED');
    assert(r.lockedUntil === futureLock);
    assert(db.calls.length === 1, `Expected only the SELECT, got ${db.calls.length} calls`);
  });

  // ──────────────────────────────────────────────────────────
  section('10 · Login — Lockout Expired (Auto-Unlock)');
  // ──────────────────────────────────────────────────────────

  await test('Expired lock + correct password → auto-unlock then success', async () => {
    const audit = new AuditLogService(null);
    const hashSvc = new AuthService(null);
    const correctHash = await hashSvc.hashPassword('CorrectPass123');
    const pastLock = new Date(Date.now() - 60 * 1000).toISOString();

    const db = makeMockDb([
      { rows: [{ id: 7, username: 'jco_ram', password_hash: correctHash,
                  display_name: 'JCO Ram', role: 'JCO', unit_id: 103, unit_code: 'PL-1-A',
                  failed_login_count: 5, account_locked: true, locked_until: pastLock }] },
      { rows: [] }, // _clearLockout
      { rows: [] }, // success reset
      { rows: [] }  // INSERT refresh token
    ]);

    const svc = new AuthService(db, audit);
    const r = await svc.login({ username: 'jco_ram', password: 'CorrectPass123' });

    assert(r.success === true);
    assert(db.calls[1].sql.includes('failed_login_count = 0')); // clear lockout
    assert(db.calls[3].sql.includes('INSERT INTO refresh_tokens'));
  });

  await test('Expired lock + wrong password → auto-unlock then normal failure (count=1, not re-locked)', async () => {
    const audit = new AuditLogService(null);
    const hashSvc = new AuthService(null);
    const correctHash = await hashSvc.hashPassword('CorrectPass123');
    const pastLock = new Date(Date.now() - 60 * 1000).toISOString();

    const db = makeMockDb([
      { rows: [{ id: 7, username: 'jco_ram', password_hash: correctHash,
                  display_name: 'JCO Ram', role: 'JCO', unit_id: 103, unit_code: 'PL-1-A',
                  failed_login_count: 5, account_locked: true, locked_until: pastLock }] },
      { rows: [] }, // _clearLockout
      { rows: [] }  // increment to 1
    ]);

    const svc = new AuthService(db, audit);
    const r = await svc.login({ username: 'jco_ram', password: 'StillWrong1' });

    assert(r.error === 'INVALID_CREDENTIALS', 'should not be ACCOUNT_LOCKED after auto-unlock');
    assert(db.calls[2].sql.includes('failed_login_count = $1'));
    assert(db.calls[2].params[0] === 1, `Expected count reset to 1, got ${db.calls[2].params[0]}`);
  });

  // ──────────────────────────────────────────────────────────
  section('11 · Refresh Token Rotation');
  // ──────────────────────────────────────────────────────────

  await test('Valid token → rotated, new tokens issued', async () => {
    const audit = new AuditLogService(null);
    const future = new Date(Date.now() + 86400000).toISOString();

    const db = makeMockDb([
      { rows: [{ id: 55, user_id: 7, expires_at: future, revoked: false,
                  username: 'jco_ram', display_name: 'JCO Ram', role: 'JCO',
                  unit_id: 103, unit_code: 'PL-1-A' }] },
      { rows: [] }, // revoke old
      { rows: [] }  // insert new
    ]);

    const svc = new AuthService(db, audit);
    const oldToken = AuthMiddleware.generateRefreshToken();
    const r = await svc.refresh(oldToken, '10.0.0.5');

    assert(r.success === true);
    assert(typeof r.accessToken === 'string');
    assert(r.refreshToken !== oldToken);

    const decoded = AuthMiddleware.decodeToken(r.accessToken);
    assert(decoded.userId === 7 && decoded.unitCode === 'PL-1-A');

    assert(db.calls[1].sql.includes('revoked = true, last_used_at'));
    assert(db.calls[1].params[0] === 55);
    assert(db.calls[2].sql.includes('INSERT INTO refresh_tokens'));
  });

  await test('Unknown token → INVALID_REFRESH_TOKEN, single query only', async () => {
    const audit = new AuditLogService(null);
    const db = makeMockDb([{ rows: [] }]);
    const svc = new AuthService(db, audit);

    const r = await svc.refresh('not-a-real-token');
    assert(r.success === false && r.error === 'INVALID_REFRESH_TOKEN');
    assert(db.calls.length === 1);
  });

  await test('Expired token → REFRESH_TOKEN_EXPIRED, no rotation attempted', async () => {
    const audit = new AuditLogService(null);
    const past = new Date(Date.now() - 1000).toISOString();
    const db = makeMockDb([
      { rows: [{ id: 55, user_id: 7, expires_at: past, revoked: false,
                  username: 'u', display_name: 'U', role: 'JCO', unit_id: 103, unit_code: 'PL-1-A' }] }
    ]);
    const svc = new AuthService(db, audit);

    const r = await svc.refresh('expired-token');
    assert(r.success === false && r.error === 'REFRESH_TOKEN_EXPIRED');
    assert(db.calls.length === 1);
  });

  // ──────────────────────────────────────────────────────────
  section('12 · Refresh Token Reuse → Theft Detection');
  // ──────────────────────────────────────────────────────────

  await test('Revoked token reuse → TOKEN_REUSE_DETECTED + all sessions revoked', async () => {
    const audit = new AuditLogService(null);
    const future = new Date(Date.now() + 86400000).toISOString();

    const db = makeMockDb([
      { rows: [{ id: 55, user_id: 7, expires_at: future, revoked: true,
                  username: 'jco_ram', display_name: 'JCO Ram', role: 'JCO',
                  unit_id: 103, unit_code: 'PL-1-A' }] },
      { rows: [] } // revoke-all
    ]);

    let secEvent = null;
    audit.on('log', e => { if (e.action === 'SECURITY_ALERT') secEvent = e; });

    const svc = new AuthService(db, audit);
    const r = await svc.refresh('stolen-but-rotated-token');

    assert(r.success === false && r.error === 'TOKEN_REUSE_DETECTED');
    assert(db.calls[1].sql.includes('revoked = true WHERE user_id'));
    assert(secEvent !== null && secEvent.severity === 'SECURITY');
  });

  // ──────────────────────────────────────────────────────────
  section('13 · Logout');
  // ──────────────────────────────────────────────────────────

  await test('logout() revokes by token hash', async () => {
    const db = makeMockDb([{ rows: [] }]);
    const svc = new AuthService(db, new AuditLogService(null));
    const token = 'abc123';

    const r = await svc.logout(token);
    assert(r.success === true);
    assert(db.calls[0].sql.includes('token_hash = $1'));
    assert(db.calls[0].params[0] === AuthMiddleware.hashRefreshToken(token));
  });

  await test('logoutAll() revokes by user id', async () => {
    const db = makeMockDb([{ rows: [] }]);
    const svc = new AuthService(db, new AuditLogService(null));

    const r = await svc.logoutAll(42);
    assert(r.success === true);
    assert(db.calls[0].sql.includes('WHERE user_id = $1'));
    assert(db.calls[0].params[0] === 42);
  });

  // ──────────────────────────────────────────────────────────
  section('14 · Change Password');
  // ──────────────────────────────────────────────────────────

  await test('Weak new password → WEAK_PASSWORD, zero DB calls', async () => {
    const db = makeMockDb([]);
    const svc = new AuthService(db, new AuditLogService(null));

    const r = await svc.changePassword(7, 'OldPass123', 'weak');
    assert(r.success === false && r.error === 'WEAK_PASSWORD');
    assert(r.issues.length > 0);
    assert(db.calls.length === 0);
  });

  await test('Wrong current password → INVALID_CURRENT_PASSWORD', async () => {
    const hashSvc = new AuthService(null);
    const oldHash = await hashSvc.hashPassword('ActualOld123');
    const db = makeMockDb([{ rows: [{ password_hash: oldHash }] }]);
    const svc = new AuthService(db, new AuditLogService(null));

    const r = await svc.changePassword(7, 'GuessedOld123', 'NewStrong123');
    assert(r.success === false && r.error === 'INVALID_CURRENT_PASSWORD');
    assert(db.calls.length === 1);
  });

  await test('User not found → USER_NOT_FOUND', async () => {
    const db = makeMockDb([{ rows: [] }]);
    const svc = new AuthService(db, new AuditLogService(null));
    const r = await svc.changePassword(999, 'Whatever123', 'NewStrong123');
    assert(r.success === false && r.error === 'USER_NOT_FOUND');
  });

  await test('Success path: hashes new password and logs out all sessions', async () => {
    const hashSvc = new AuthService(null);
    const oldHash = await hashSvc.hashPassword('ActualOld123');
    const db = makeMockDb([
      { rows: [{ password_hash: oldHash }] }, // SELECT
      { rows: [] }, // UPDATE password_hash
      { rows: [] }  // logoutAll UPDATE
    ]);
    const svc = new AuthService(db, new AuditLogService(null));

    const r = await svc.changePassword(7, 'ActualOld123', 'NewStrong123');
    assert(r.success === true);
    assert(db.calls[1].sql.includes('UPDATE users SET password_hash'));
    assert(db.calls[2].sql.includes('UPDATE refresh_tokens SET revoked = true WHERE user_id'));
  });

  // ──────────────────────────────────────────────────────────
  section('15 · Admin Unlock');
  // ──────────────────────────────────────────────────────────

  await test('unlockAccount clears lockout fields and audits USER_UNLOCK', async () => {
    const db = makeMockDb([{ rows: [] }]);
    const audit = new AuditLogService(null);
    let captured = null;
    audit.on('log', e => { if (e.action === 'USER_UNLOCK') captured = e; });

    const svc = new AuthService(db, audit);
    const r = await svc.unlockAccount(7, 99);

    assert(r.success === true);
    assert(db.calls[0].sql.includes('account_locked = false'));
    assert(db.calls[0].sql.includes('failed_login_count = 0'));
    assert(captured !== null);
    assert(captured.userId === 99, 'audit attributes the action to the unlocking admin');
    assert(JSON.parse(captured.details).unlockedUserId === 7);
  });

  // ──────────────────────────────────────────────────────────
  section('16 · Rate Limiter — Core');
  // ──────────────────────────────────────────────────────────

  await test('Allows up to maxRequests, then blocks', () => {
    const limiter = new RateLimiter();
    const r1 = limiter.check('1.2.3.4', 3, 60000);
    const r2 = limiter.check('1.2.3.4', 3, 60000);
    const r3 = limiter.check('1.2.3.4', 3, 60000);
    const r4 = limiter.check('1.2.3.4', 3, 60000);

    assert(r1.allowed && r2.allowed && r3.allowed);
    assert(r4.allowed === false);
    assert(r4.remaining === 0);
  });

  await test('Different keys are tracked independently', () => {
    const limiter = new RateLimiter();
    limiter.check('A', 1, 60000);
    const aSecond = limiter.check('A', 1, 60000);
    const bFirst  = limiter.check('B', 1, 60000);

    assert(aSecond.allowed === false, 'A exceeded its limit');
    assert(bFirst.allowed === true,   'B is unaffected by A');
  });

  await test('peek() returns null for unknown key, count for active key', () => {
    const limiter = new RateLimiter();
    assert(limiter.peek('nope') === null);

    limiter.check('A', 5, 60000);
    const p = limiter.peek('A');
    assert(p !== null && p.count === 1);
  });

  await test('reset() clears a bucket', () => {
    const limiter = new RateLimiter();
    limiter.check('A', 1, 60000);
    limiter.reset('A');
    assert(limiter.peek('A') === null);
  });

  await test('cleanup() removes only expired buckets', () => {
    const limiter = new RateLimiter();
    limiter.check('fresh', 5, 60000);
    limiter.check('stale', 5, 60000);

    // Force "stale" to look expired
    limiter._buckets.get('stale').resetAt = Date.now() - 1;

    const removed = limiter.cleanup();
    assert(removed === 1);
    assert(limiter.size === 1);
    assert(limiter.peek('fresh') !== null);
  });

  // ──────────────────────────────────────────────────────────
  section('17 · Rate Limiter — Express Middleware');
  // ──────────────────────────────────────────────────────────

  function makeReqRes(ip) {
    const headers = {};
    let statusCode = 200;
    let body = null;
    const req = { ip };
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      status: (c) => { statusCode = c; return res; },
      json: (b) => { body = b; return res; }
    };
    return { req, res, headers: () => headers, status: () => statusCode, body: () => body };
  }

  await test('Middleware calls next() while under limit', () => {
    const limiter = new RateLimiter();
    const mw = limiter.middleware(2, 60000);
    const { req, res } = makeReqRes('9.9.9.9');

    let nextCalls = 0;
    mw(req, res, () => nextCalls++);
    mw(req, res, () => nextCalls++);

    assert(nextCalls === 2);
  });

  await test('Middleware returns 429 with Retry-After once limit exceeded', () => {
    const limiter = new RateLimiter();
    const mw = limiter.middleware(2, 60000);
    const { req, res, headers, status, body } = makeReqRes('9.9.9.9');

    let nextCalls = 0;
    mw(req, res, () => nextCalls++);
    mw(req, res, () => nextCalls++);
    mw(req, res, () => nextCalls++); // 3rd exceeds

    assert(nextCalls === 2, '3rd call should NOT reach next()');
    assert(status() === 429);
    assert(headers()['Retry-After'] !== undefined);
    assert(body().error === 'RATE_LIMIT_EXCEEDED');
  });

  // ──────────────────────────────────────────────────────────
  section('18 · Integration — Lockout → Audit → Notification (Day14→13→11)');
  // ──────────────────────────────────────────────────────────

  await test('5 failed logins lock the account AND produce an acknowledgeable SECURITY_ALERT', async () => {
    const rbac  = buildRBAC();
    const audit = new AuditLogService(null);
    const notif = new NotificationService(null, rbac, audit);

    const hashSvc = new AuthService(null);
    const someOtherHash = await hashSvc.hashPassword('TheRealPassword1');

    const db = makeStatefulUserDb({
      id: 42, username: 'soldier_x', password_hash: someOtherHash,
      display_name: 'Soldier X', role: 'SOLDIER', unit_id: 103, unit_code: 'PL-1-A',
      failed_login_count: 0, account_locked: false, locked_until: null
    });

    const svc = new AuthService(db, audit);

    const received = [];
    notif.on('notification', n => received.push(n));

    let lastResult;
    for (let i = 0; i < AuthService.MAX_FAILED_ATTEMPTS; i++) {
      lastResult = await svc.login({ username: 'soldier_x', password: 'WrongEveryTime' });
    }
    await new Promise(r => setImmediate(r));

    assert(lastResult.error === 'INVALID_CREDENTIALS', '5th attempt itself reports invalid creds');
    assert(db.state.account_locked === true, 'account should now be locked');
    assert(db.state.failed_login_count === AuthService.MAX_FAILED_ATTEMPTS);

    const lockAlert = received.find(n =>
      n.type === 'SECURITY_ALERT' && n.message.startsWith('USER_LOCK')
    );
    assert(lockAlert !== undefined, 'expected a SECURITY_ALERT notification for USER_LOCK');
    assert(lockAlert.requiresAck === true);
    assert(lockAlert.minRankLevel === 8, 'matches SENIOR_OFFICER+ visibility');

    // Sanity: each AUTH_FAILED also produced its own SECURITY_ALERT
    const totalSecurityAlerts = received.filter(n => n.type === 'SECURITY_ALERT').length;
    assert(totalSecurityAlerts >= AuthService.MAX_FAILED_ATTEMPTS,
      `Expected ≥${AuthService.MAX_FAILED_ATTEMPTS} SECURITY_ALERTs, got ${totalSecurityAlerts}`);
  });

  await test('6th attempt after lock → ACCOUNT_LOCKED without re-incrementing', async () => {
    const audit = new AuditLogService(null);
    const hashSvc = new AuthService(null);
    const someOtherHash = await hashSvc.hashPassword('TheRealPassword1');

    const db = makeStatefulUserDb({
      id: 43, username: 'soldier_y', password_hash: someOtherHash,
      display_name: 'Soldier Y', role: 'SOLDIER', unit_id: 103, unit_code: 'PL-1-A',
      failed_login_count: 0, account_locked: false, locked_until: null
    });

    const svc = new AuthService(db, audit);

    for (let i = 0; i < AuthService.MAX_FAILED_ATTEMPTS; i++) {
      await svc.login({ username: 'soldier_y', password: 'WrongEveryTime' });
    }

    const sixth = await svc.login({ username: 'soldier_y', password: 'WrongEveryTime' });
    assert(sixth.error === 'ACCOUNT_LOCKED');
    assert(db.state.failed_login_count === AuthService.MAX_FAILED_ATTEMPTS,
      'counter should not increment once already locked');
  });

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(56));
  console.log(`📊  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed === 0) {
    console.log('\n🔑  ALL TESTS PASSED — Day 14 auth login layer verified!\n');
    console.log('Capabilities delivered:');
    console.log('  🔐  bcrypt + pepper password hashing, strength validation');
    console.log('  🚪  Login with generic invalid-credentials messaging');
    console.log('  🔒  5-strike lockout, 15-min auto-unlock, admin override');
    console.log('  🔄  Refresh token rotation with reuse/theft detection');
    console.log('  🚪  Logout (single + all-sessions), password change');
    console.log('  🛡️   Per-IP rate limiting (in-memory, no Redis)');
    console.log('  🔗  End-to-end: lockout → SECURITY audit → ack-required alert');
  } else {
    console.log(`\n⚠️   ${failed} test(s) failed:\n`);
    failures.forEach(f => console.log(`  • ${f.label}\n    ${f.error}`));
    process.exitCode = 1;
  }
  console.log('');
}

run().catch(err => {
  console.error('Suite crashed:', err);
  process.exit(1);
});
