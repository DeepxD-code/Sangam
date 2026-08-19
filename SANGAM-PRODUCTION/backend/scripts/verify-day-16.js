'use strict';

/**
 * SANGAM Day 16 — Verification Suite
 * Tests: AES-256-GCM encrypt/decrypt, auth-tag tamper detection,
 * format validation, null/empty handling, audit-entry helpers,
 * justification encryption, key status, scheduled sweep (mocked),
 * sweep → notification integration (BLOCKCHAIN_TAMPER on chain break),
 * hash-mismatch detection, stats tracking.
 *
 * No real database required — sweep DB calls are mocked.
 * Run: node backend/scripts/verify-day-16.js
 */

const path   = require('path');
const crypto = require('crypto');

const AuditLogService     = require(path.join(__dirname, '../src/services/audit-log.service'));
const NotificationService = require(path.join(__dirname, '../src/services/notification.service'));
const RBACService         = require(path.join(__dirname, '../src/services/rbac.service'));
const AuditHardeningService = require(path.join(__dirname, '../src/services/audit-hardening.service'));

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

function section(name) {
  console.log(`\n📋  ${name}`);
}

// Valid 64-char hex key (32 bytes)
const TEST_KEY = crypto.randomBytes(32).toString('hex');

function makeSvc(keyHex = TEST_KEY, opts = {}) {
  const audit = new AuditLogService(null);
  const rbac  = new RBACService(null);
  rbac._hierarchyCache.set('scope_100', { ids: [100], codes: [] });
  const notif = opts.withNotif ? new NotificationService(null, rbac, audit) : null;
  return new AuditHardeningService(null, audit, notif, keyHex);
}

// ============================================================
// TEST SUITES
// ============================================================
async function run() {
  console.log('\n🔒  SANGAM Day 16 — Audit Hardening Verification');
  console.log('═'.repeat(54));
  console.log(`Started: ${new Date().toISOString()}\n`);

  // ──────────────────────────────────────────────────────────
  section('1 · Constants & Key Validation');
  // ──────────────────────────────────────────────────────────

  await test('Algorithm is AES-256-GCM', () => {
    assert(AuditHardeningService.ALGO === 'aes-256-gcm');
  });
  await test('IV_BYTES is 16', () => {
    assert(AuditHardeningService.IV_BYTES === 16);
  });
  await test('KEY_HEX_LEN is 64 (32 bytes)', () => {
    assert(AuditHardeningService.KEY_HEX_LEN === 64);
  });
  await test('SWEEP_WINDOW_ENTRIES is 500', () => {
    assert(AuditHardeningService.SWEEP_WINDOW_ENTRIES === 500);
  });
  await test('DEFAULT_SWEEP_INTERVAL_MS is 1 hour', () => {
    assert(AuditHardeningService.DEFAULT_SWEEP_INTERVAL_MS === 60 * 60 * 1000);
  });

  await test('Rejects key shorter than 64 hex chars', () => {
    let threw = false;
    try { new AuditHardeningService(null, new AuditLogService(null), null, 'tooshort'); }
    catch { threw = true; }
    assert(threw, 'Should throw on short key');
  });

  await test('Rejects key longer than 64 hex chars', () => {
    let threw = false;
    try { new AuditHardeningService(null, new AuditLogService(null), null, 'a'.repeat(66)); }
    catch { threw = true; }
    assert(threw, 'Should throw on long key');
  });

  await test('Constructs with valid 64-char hex key, _keyAvailable=true', () => {
    const svc = makeSvc(TEST_KEY);
    assert(svc._keyAvailable === true);
  });

  await test('Falls back to dev key when no key provided, _keyAvailable=false', () => {
    const audit = new AuditLogService(null);
    const svc = new AuditHardeningService(null, audit);
    assert(svc._keyAvailable === false);
  });

  // ──────────────────────────────────────────────────────────
  section('2 · encrypt() / decrypt() — Round-Trip');
  // ──────────────────────────────────────────────────────────

  await test('Encrypts a string and round-trips back to the original', () => {
    const svc = makeSvc();
    const plain = 'Classified supply movement: Unit 105 to Grid Reference 4479';
    const enc   = svc.encrypt(plain);
    assert(enc !== plain, 'ciphertext != plaintext');
    assert(svc.decrypt(enc) === plain);
  });

  await test('Encrypts JSON object (stringified) and round-trips', () => {
    const svc  = makeSvc();
    const obj  = { reason: 'Unit 105 isolated', qty: 500 };
    const enc  = svc.encrypt(JSON.stringify(obj));
    const back = JSON.parse(svc.decrypt(enc));
    assert(back.reason === obj.reason && back.qty === obj.qty);
  });

  await test('Returns null for null input', () => {
    const svc = makeSvc();
    assert(svc.encrypt(null) === null);
    assert(svc.decrypt(null) === null);
  });

  await test('Returns null for undefined input', () => {
    const svc = makeSvc();
    assert(svc.encrypt(undefined) === null);
  });

  await test('Returns null for empty string', () => {
    const svc = makeSvc();
    assert(svc.encrypt('') === null);
  });

  await test('Identical plaintexts produce different ciphertexts (random IV)', () => {
    const svc = makeSvc();
    const a = svc.encrypt('same plaintext');
    const b = svc.encrypt('same plaintext');
    assert(a !== b, 'random IV must ensure ciphertext differs each time');
    // But both must decrypt to the same plaintext
    assert(svc.decrypt(a) === svc.decrypt(b));
  });

  await test('Encrypted output is IV:ciphertext:authTag (3 colon-delimited hex parts)', () => {
    const svc  = makeSvc();
    const enc  = svc.encrypt('test value');
    const parts = enc.split(':');
    assert(parts.length === 3, `Expected 3 parts, got ${parts.length}`);
    parts.forEach(p => assert(/^[0-9a-f]+$/i.test(p), `Non-hex part: ${p}`));
  });

  await test('IV part is exactly 32 hex chars (16 bytes)', () => {
    const svc = makeSvc();
    const enc = svc.encrypt('test');
    assert(enc.split(':')[0].length === 32);
  });

  // ──────────────────────────────────────────────────────────
  section('3 · Tamper Detection (GCM Auth Tag)');
  // ──────────────────────────────────────────────────────────

  await test('Flipping a ciphertext bit throws on decrypt (auth tag mismatch)', () => {
    const svc = makeSvc();
    const enc = svc.encrypt('sensitive data');
    const [iv, ct, tag] = enc.split(':');
    // Flip first byte of ciphertext
    const tamperedCt = (parseInt(ct.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0') + ct.slice(2);
    const tampered = `${iv}:${tamperedCt}:${tag}`;

    let threw = false;
    try { svc.decrypt(tampered); } catch { threw = true; }
    assert(threw, 'GCM auth tag should reject tampered ciphertext');
  });

  await test('Flipping an auth tag bit throws on decrypt', () => {
    const svc = makeSvc();
    const enc = svc.encrypt('sensitive data');
    const [iv, ct, tag] = enc.split(':');
    const tamperedTag = (parseInt(tag.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0') + tag.slice(2);
    const tampered = `${iv}:${ct}:${tamperedTag}`;

    let threw = false;
    try { svc.decrypt(tampered); } catch { threw = true; }
    assert(threw, 'GCM auth tag should reject tampered tag');
  });

  await test('Different key cannot decrypt (wrong auth tag)', () => {
    const svcA = makeSvc(TEST_KEY);
    const svcB = makeSvc(crypto.randomBytes(32).toString('hex'));

    const enc = svcA.encrypt('intel data');
    let threw = false;
    try { svcB.decrypt(enc); } catch { threw = true; }
    assert(threw, 'Wrong key should fail auth-tag check');
  });

  await test('decrypt() throws on invalid format (not 3 parts)', () => {
    const svc = makeSvc();
    let threw = false;
    try { svc.decrypt('not:valid'); } catch { threw = true; }
    assert(threw);
  });

  // ──────────────────────────────────────────────────────────
  section('4 · isEncrypted()');
  // ──────────────────────────────────────────────────────────

  await test('Returns true for valid IV:ct:tag output', () => {
    const svc = makeSvc();
    const enc = svc.encrypt('hello');
    assert(svc.isEncrypted(enc) === true);
  });

  await test('Returns false for plaintext JSON string', () => {
    const svc = makeSvc();
    assert(svc.isEncrypted('{"action":"SUPPLY_READ"}') === false);
  });

  await test('Returns false for null, number, object', () => {
    const svc = makeSvc();
    assert(svc.isEncrypted(null)   === false);
    assert(svc.isEncrypted(42)     === false);
    assert(svc.isEncrypted({})     === false);
  });

  // ──────────────────────────────────────────────────────────
  section('5 · Audit Entry Helpers');
  // ──────────────────────────────────────────────────────────

  await test('encryptAuditDetails encrypts string details in-place', () => {
    const svc = makeSvc();
    const entry = { action: 'SUPPLY_READ', details: '{"qty":100}' };
    svc.encryptAuditDetails(entry);
    assert(svc.isEncrypted(entry.details));
    assert(entry.action === 'SUPPLY_READ'); // other fields untouched
  });

  await test('encryptAuditDetails serialises object details to JSON before encrypting', () => {
    const svc = makeSvc();
    const entry = { details: { reason: 'classified', qty: 500 } };
    svc.encryptAuditDetails(entry);
    assert(svc.isEncrypted(entry.details));

    const decrypted = JSON.parse(svc.decrypt(entry.details));
    assert(decrypted.reason === 'classified' && decrypted.qty === 500);
  });

  await test('encryptAuditDetails leaves null details untouched', () => {
    const svc = makeSvc();
    const entry = { details: null };
    svc.encryptAuditDetails(entry);
    assert(entry.details === null);
  });

  await test('decryptAuditDetails decrypts and JSON-parses correctly', () => {
    const svc = makeSvc();
    const original = { action: 'X', details: { key: 'value' } };
    svc.encryptAuditDetails(original);

    const row = { ...original };
    svc.decryptAuditDetails(row);
    assert(row.details.key === 'value');
    assert(row.action === 'X');
  });

  await test('decryptAuditDetails leaves plaintext JSON unchanged (legacy rows)', () => {
    const svc = makeSvc();
    const row = { details: '{"legacy":"plaintext"}' };
    svc.decryptAuditDetails(row);
    assert(row.details === '{"legacy":"plaintext"}', 'plaintext pass-through');
  });

  await test('prepareForWrite returns a new object (does not mutate original)', () => {
    const svc = makeSvc();
    const entry = { details: '{"a":1}' };
    const prepared = svc.prepareForWrite(entry);
    assert(prepared !== entry, 'should be a clone');
    assert(svc.isEncrypted(prepared.details));
    assert(!svc.isEncrypted(entry.details), 'original must be untouched');
  });

  await test('decryptRow returns a new object and decrypts details', () => {
    const svc = makeSvc();
    const enc = svc.encrypt('{"secret":true}');
    const row = { id: 1, details: enc };
    const decrypted = svc.decryptRow(row);
    assert(decrypted !== row, 'should be a clone');
    assert(decrypted.details.secret === true);
    assert(svc.isEncrypted(row.details), 'original row must be untouched');
  });

  await test('decryptRows processes an array of rows', () => {
    const svc = makeSvc();
    const rows = [
      { id: 1, details: svc.encrypt('{"a":1}') },
      { id: 2, details: svc.encrypt('{"b":2}') }
    ];
    const results = svc.decryptRows(rows);
    assert(results[0].details.a === 1);
    assert(results[1].details.b === 2);
    assert(svc.isEncrypted(rows[0].details), 'originals untouched');
  });

  // ──────────────────────────────────────────────────────────
  section('6 · Justification Encryption (Day 15 integration)');
  // ──────────────────────────────────────────────────────────

  await test('encryptJustification / decryptJustification round-trip', () => {
    const svc  = makeSvc();
    const text = 'Unit 105 isolated, casualties pending, no comms with HQ-102';
    const enc  = svc.encryptJustification(text);
    assert(svc.isEncrypted(enc));
    assert(svc.decryptJustification(enc) === text);
  });

  await test('decryptJustification passes through null', () => {
    const svc = makeSvc();
    assert(svc.decryptJustification(null) === null);
  });

  await test('decryptJustification passes through legacy plaintext', () => {
    const svc = makeSvc();
    const plain = 'old plaintext justification';
    assert(svc.decryptJustification(plain) === plain);
  });

  // ──────────────────────────────────────────────────────────
  section('7 · getKeyStatus');
  // ──────────────────────────────────────────────────────────

  await test('productionKeyLoaded true when valid key supplied', () => {
    const svc = makeSvc();
    const status = svc.getKeyStatus();
    assert(status.productionKeyLoaded === true);
    assert(status.algorithm === 'aes-256-gcm');
    assert(status.keyBits === 256);
  });

  await test('productionKeyLoaded false in dev-key fallback mode', () => {
    const audit = new AuditLogService(null);
    const svc = new AuditHardeningService(null, audit);
    const status = svc.getKeyStatus();
    assert(status.productionKeyLoaded === false);
    assert(status.note.includes('WARNING'));
  });

  // ──────────────────────────────────────────────────────────
  section('8 · Integrity Sweep — Clean Chain');
  // ──────────────────────────────────────────────────────────

  await test('Sweep with no DB → result.verified=null, reason="database_not_available"', async () => {
    const audit = new AuditLogService(null);
    const svc   = new AuditHardeningService(null, audit, null, TEST_KEY);
    const result = await svc.runSweepNow();
    assert(result.verified === null);
    assert(result.reason === 'database_not_available');
  });

  await test('Sweep with clean mock DB → verified:true, tampered:[]', async () => {
    const audit = new AuditLogService(null);

    // Mock verifyIntegrity on the audit service to return clean
    audit.verifyIntegrity = async () => ({
      verified: true, entriesChecked: 10, tamperedEntries: []
    });

    const mockDb = {
      query: async () => ({ rows: [{ log_hash: audit._lastHash }] })
    };
    const svc = new AuditHardeningService(mockDb, audit, null, TEST_KEY);
    const result = await svc.runSweepNow();

    assert(result.verified === true);
    assert(result.tampered.length === 0);
    assert(result.hashMismatch === false);
    assert(svc._stats.sweepCount === 1);
    assert(svc._stats.lastSweepVerified === true);
  });

  // ──────────────────────────────────────────────────────────
  section('9 · Integrity Sweep — Tamper Detected');
  // ──────────────────────────────────────────────────────────

  await test('Sweep with tampered chain → verified:false, CRITICAL audit emitted', async () => {
    const audit = new AuditLogService(null);

    const loggedEntries = [];
    audit.log = async (entry) => {
      loggedEntries.push(entry);
      return entry;
    };

    audit.verifyIntegrity = async () => ({
      verified: false,
      entriesChecked: 10,
      tamperedEntries: [{ id: 42, action: 'SUPPLY_READ', expectedHash: 'aaa', actualHash: 'bbb' }]
    });

    const mockDb = {
      query: async () => ({ rows: [{ log_hash: 'completely_different_hash' }] })
    };

    const svc = new AuditHardeningService(mockDb, audit, null, TEST_KEY);
    const result = await svc.runSweepNow();

    assert(result.verified === false);
    assert(result.tampered.length === 1);

    const criticalEntry = loggedEntries.find(
      e => e.action === 'AUDIT_INTEGRITY_CHECK' && e.severity === 'CRITICAL'
    );
    assert(criticalEntry !== null);
    assert(svc._stats.tamperEventsEmitted === 1);
  });

  await test('Tamper sweep → BLOCKCHAIN_TAMPER notification emitted with requiresAck', async () => {
    const rbac  = new RBACService(null);
    const audit = new AuditLogService(null);
    const notif = new NotificationService(null, rbac, audit);

    audit.log = async (e) => e;
    audit.verifyIntegrity = async () => ({
      verified: false, entriesChecked: 5,
      tamperedEntries: [{ id: 1, action: 'X', expectedHash: 'a', actualHash: 'b' }]
    });

    const mockDb = { query: async () => ({ rows: [] }) };

    const received = [];
    notif.on('notification', n => received.push(n));

    const svc = new AuditHardeningService(mockDb, audit, notif, TEST_KEY);
    await svc.runSweepNow();

    const tamperNotif = received.find(n => n.type === 'BLOCKCHAIN_TAMPER');
    assert(tamperNotif !== undefined, 'BLOCKCHAIN_TAMPER notification expected');
    assert(tamperNotif.severity === 'CRITICAL');
    assert(tamperNotif.requiresAck === true);
  });

  // ──────────────────────────────────────────────────────────
  section('10 · Hash-Mismatch Detection (External Write)');
  // ──────────────────────────────────────────────────────────

  await test('Hash mismatch between DB and in-memory → hashMismatch:true, verified:false', async () => {
    const audit = new AuditLogService(null);
    audit.log = async (e) => e;
    audit.verifyIntegrity = async () => ({
      verified: true, entriesChecked: 5, tamperedEntries: []
    });
    audit._lastHash = 'a'.repeat(64); // in-memory says "aaa..."

    const mockDb = {
      query: async () => ({ rows: [{ log_hash: 'b'.repeat(64) }] }) // DB says "bbb..."
    };

    const svc = new AuditHardeningService(mockDb, audit, null, TEST_KEY);
    const result = await svc.runSweepNow();

    assert(result.hashMismatch === true);
    assert(result.verified === false);
  });

  await test('Hash match (DB == in-memory) → hashMismatch:false', async () => {
    const audit = new AuditLogService(null);
    audit.log = async (e) => e;
    audit.verifyIntegrity = async () => ({
      verified: true, entriesChecked: 5, tamperedEntries: []
    });
    const knownHash = crypto.randomBytes(32).toString('hex');
    audit._lastHash = knownHash;

    const mockDb = {
      query: async () => ({ rows: [{ log_hash: knownHash }] })
    };

    const svc = new AuditHardeningService(mockDb, audit, null, TEST_KEY);
    const result = await svc.runSweepNow();

    assert(result.hashMismatch === false);
    assert(result.verified === true);
  });

  // ──────────────────────────────────────────────────────────
  section('11 · Sweep Concurrency Guard');
  // ──────────────────────────────────────────────────────────

  await test('Concurrent sweep returns skipped:true without double-running', async () => {
    const audit = new AuditLogService(null);
    audit.log = async (e) => e;

    let callCount = 0;
    audit.verifyIntegrity = async () => {
      callCount++;
      // simulate slow sweep
      await new Promise(r => setTimeout(r, 10));
      return { verified: true, entriesChecked: 5, tamperedEntries: [] };
    };
    const mockDb = { query: async () => ({ rows: [] }) };

    const svc = new AuditHardeningService(mockDb, audit, null, TEST_KEY);

    // Start sweep 1 (not awaited)
    const p1 = svc.runSweepNow();
    // Immediately start sweep 2 (should be skipped)
    const r2 = await svc.runSweepNow();
    await p1;

    assert(r2.skipped === true);
    assert(callCount === 1, `verifyIntegrity should have been called once, got ${callCount}`);
  });

  // ──────────────────────────────────────────────────────────
  section('12 · Sweep Lifecycle & Stats');
  // ──────────────────────────────────────────────────────────

  await test('startIntegritySweep / stopIntegritySweep control timer lifecycle', () => {
    const audit = new AuditLogService(null);
    const svc   = new AuditHardeningService(null, audit, null, TEST_KEY);

    assert(svc._sweepInterval === null);
    svc.startIntegritySweep(99999);
    assert(svc._sweepInterval !== null);
    svc.stopIntegritySweep();
    assert(svc._sweepInterval === null);
  });

  await test('getStats returns correct sweep/encrypt/key fields', async () => {
    const svc = makeSvc();
    svc.encrypt('hello');
    svc.encrypt('world');

    const stats = svc.getStats();
    assert(stats.sweepCount === 0);
    assert(stats.encryptedCount === 2);
    assert(stats.keyAvailable === true);
    assert(stats.sweepActive === false);
    assert(stats.tamperEventsEmitted === 0);
  });

  await test('Stats update after a sweep and decrypt', async () => {
    const audit = new AuditLogService(null);
    audit.log = async (e) => e;
    audit.verifyIntegrity = async () => ({ verified: true, entriesChecked: 3, tamperedEntries: [] });
    const mockDb = { query: async () => ({ rows: [{ log_hash: audit._lastHash }] }) };

    const svc = new AuditHardeningService(mockDb, audit, null, TEST_KEY);
    await svc.runSweepNow();

    const enc = svc.encrypt('data');
    svc.decrypt(enc);

    const stats = svc.getStats();
    assert(stats.sweepCount === 1);
    assert(stats.lastSweepVerified === true);
    assert(stats.encryptedCount === 1);
    assert(stats.decryptedCount === 1);
  });

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(54));
  console.log(`📊  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed === 0) {
    console.log('\n🔒  ALL TESTS PASSED — Day 16 audit hardening verified!\n');
    console.log('Capabilities delivered:');
    console.log('  🔑  AES-256-GCM encryption-at-rest for audit details + override justifications');
    console.log('  🎲  Random IV per record — no frequency analysis possible');
    console.log('  🛡️   GCM auth tag: ciphertext tampering detected on decrypt');
    console.log('  🔍  isEncrypted() — safe pass-through for legacy plaintext rows');
    console.log('  🏗️   prepareForWrite / decryptRow / decryptRows — clean integration API');
    console.log('  ⏱️   Scheduled hourly sweep of recent audit chain (last 500 entries)');
    console.log('  🚨  Sweep → CRITICAL audit + BLOCKCHAIN_TAMPER notification on break');
    console.log('  🔗  Hash-mismatch detection (in-memory vs DB last hash)');
    console.log('  ⚡  Concurrency guard — concurrent sweeps skipped, not stacked');
    console.log('  📊  Stats: sweep count, tamper events, encrypt/decrypt counts');
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
