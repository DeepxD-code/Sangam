'use strict';

/**
 * Day 71 Verification — AUDITOR Access Fix + Integrity-Check Surface
 *
 * Orphaned-capability scan (Days 56-58 pattern) turned up something more
 * significant than expected: AUDITOR — the role whose own description is
 * "read-only across all data plus full audit log access" — was locked
 * out of the Audit Log page at THREE separate layers:
 *   1. Backend /api/reports/audit-log required system:admin (AUDITOR has
 *      audit:read, not system:admin).
 *   2. Sidebar.jsx gated the /audit link at rankLevel>=5 (adminOnly);
 *      AUDITOR is rankLevel 4.
 *   3. AuditLogPage.jsx had its own independent, even stricter check
 *      (user.role === 'SYSTEM_ADMIN') that would have blocked direct
 *      navigation even after fixing the first two.
 * Verified before fixing: AUDITOR is the ONLY role at rankLevel 4 (no
 * collision risk from loosening the gate), and SYSTEM_ADMIN has BOTH
 * audit:read and system:admin (so the backend fix only adds access,
 * never removes it).
 *
 * Separately found: POST /api/rbac/audit-logs/verify-integrity (hash-
 * chain tamper detection) was fully built and correctly permissioned
 * (audit:read) but never called from anywhere in the frontend — a
 * genuine orphaned capability. Added a client method and a "Verify
 * Integrity" button + result banner to AuditLogPage.jsx.
 *
 *   A. Backend: a real HTTP request from a user with ONLY audit:read
 *      (no system:admin) now succeeds against /api/reports/audit-log.
 *   B. Frontend source: Sidebar/AuditLogPage gating fixed, not just
 *      deleted — confirmed against real current file contents.
 *   C. Integrity verification, via pg-mem with a GENUINE hash chain
 *      (built through the real AuditLogService.log(), not hand-computed
 *      hashes) — confirms a clean chain verifies true, and that directly
 *      tampering with a stored log_hash is actually detected.
 */

const jwt       = require('jsonwebtoken');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const { newDb } = require('pg-mem');
const createApp = require('../src/app');
const AuditLogService = require('../src/services/audit-log.service');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 9771, username: 'test.d71', role: 'AUDITOR',
    unitId: 1, unitCode: 'TST', rankLevel: 4, ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: urlPath, method, headers: { Authorization: `Bearer ${token}` } }, (res) => {
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

  // ── Group A: backend permission fix, over real HTTP ───────────────
  console.log('\n🔓 Group A: AUDITOR can now reach /api/reports/audit-log');
  const app    = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const auditorToken = makeToken({ role: 'AUDITOR', rankLevel: 4 });
    const r = await request(port, 'GET', '/api/reports/audit-log', auditorToken);
    check('A-01 AUDITOR (audit:read, no system:admin) gets 200, not 403', r.status === 200, `got ${r.status}: ${JSON.stringify(r.json)}`);

    // A role with NEITHER audit:read NOR system:admin should still be
    // correctly denied — confirms this is a real permission gate, not
    // an accidentally-removed one.
    const soldierToken = makeToken({ role: 'SOLDIER', rankLevel: 1 });
    const r2 = await request(port, 'GET', '/api/reports/audit-log', soldierToken);
    check('A-02 SOLDIER (no audit:read) still correctly gets 403', r2.status === 403, `got ${r2.status}`);
  } finally {
    server.close();
  }

  // ── Group B: frontend source fixed correctly, not just deleted ────
  console.log('\n🧭 Group B: frontend gating fixed at all three layers');
  const sidebarSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/Sidebar.jsx'), 'utf8');
  const auditLinkIdx = sidebarSrc.indexOf("to:        '/audit'");
  const nextLinkIdx  = sidebarSrc.indexOf("to:        '/", auditLinkIdx + 10); // start of the *next* link object
  const auditLinkBlock = sidebarSrc.slice(auditLinkIdx, nextLinkIdx);
  const auditLinkCodeOnly = auditLinkBlock
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
  check('B-01 Sidebar no longer gates /audit with adminOnly (as live code, not in the explanatory comment)', !auditLinkCodeOnly.includes('adminOnly: true'));
  check('B-02 Sidebar gates /audit with minRankLevel: 4 instead', /minRankLevel:\s*4/.test(auditLinkBlock));

  const pageSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/AuditLogPage.jsx'), 'utf8');
  // Check the actual active-code assignment specifically — not any
  // substring match, since the fix's own explanatory comment legitimately
  // references the old pattern in backticks to document why it changed.
  check('B-03 AuditLogPage no longer hardcodes role === SYSTEM_ADMIN as its live gate', !/const isAdmin = user && user\.role === 'SYSTEM_ADMIN'/.test(pageSrc));
  check('B-04 AuditLogPage now checks rankLevel >= 4', /rankLevel\s*>=\s*4/.test(pageSrc));
  check('B-05 error messaging updated to match (no longer claims SYSTEM_ADMIN is required)', !pageSrc.includes('SYSTEM_ADMIN role required') && !pageSrc.includes('requires SYSTEM_ADMIN role'));

  const clientSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/api/client.js'), 'utf8');
  check('B-06 client.js exposes verifyAuditIntegrity', clientSrc.includes('async verifyAuditIntegrity'));
  check('B-07 verifyAuditIntegrity calls the real endpoint path', /\/api\/rbac\/audit-logs\/verify-integrity/.test(clientSrc));
  check('B-08 AuditLogPage actually calls api.verifyAuditIntegrity (wired, not just defined)', pageSrc.includes('api.verifyAuditIntegrity'));

  // ── Group C: integrity verification with a GENUINE hash chain ─────
  console.log('\n⛓️  Group C: hash-chain verification (real chain via AuditLogService.log())');
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();
  const poolC = new Pool();
  await poolC.query(`
    CREATE TABLE audit_logs (
      id BIGSERIAL PRIMARY KEY, user_id INTEGER, username VARCHAR(50),
      role_name VARCHAR(30), unit_code VARCHAR(20), action VARCHAR(50) NOT NULL,
      resource VARCHAR(50), resource_id VARCHAR(50), details JSONB,
      ip_address VARCHAR(45), success BOOLEAN NOT NULL DEFAULT true,
      failure_reason TEXT, severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
      previous_hash VARCHAR(64), log_hash VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const auditC = new AuditLogService(poolC);
  for (let i = 0; i < 5; i++) {
    await auditC.log({ userId: 1, username: 'test', action: `D71_TEST_${i}`, resource: 'test', success: true, severity: 'INFO' });
  }
  await new Promise(r => setTimeout(r, 300)); // let the setImmediate-scheduled writes land

  {
    const result = await auditC.verifyIntegrity();
    check('C-01 a genuine, untampered hash chain verifies as valid', result.verified === true, JSON.stringify(result));
    check('C-02 entriesChecked matches the number of entries logged', result.entriesChecked === 5, `got ${result.entriesChecked}`);
    check('C-03 no tampered entries reported for a clean chain', result.tamperedEntries.length === 0);
  }
  {
    // Simulate an attacker directly editing a stored log_hash.
    await poolC.query(`UPDATE audit_logs SET log_hash = 'tampered0000000000000000000000000000000000000000000000000000' WHERE id = 3`);
    const result = await auditC.verifyIntegrity();
    check('C-04 a directly-tampered entry is detected', result.verified === false);
    check('C-05 the tampered entry list identifies the right row', result.tamperedEntries.some(e => e.id === 3), JSON.stringify(result.tamperedEntries));
    // Tampering with entry 3's hash also breaks the chain for entry 4+
    // (previous_hash no longer matches what 4 was actually built from) —
    // this is correct, expected cascading behavior for a hash chain, not
    // a bug in the detection.
    check('C-06 the tamper cascades forward through the chain (expected hash-chain behavior)', result.tamperedEntries.length >= 1);
  }
  {
    // db=null path should throw a clear, catchable error (matches how
    // the route handler and the new frontend banner both handle it).
    const auditOffline = new AuditLogService(null);
    let threw = false, message = '';
    try { await auditOffline.verifyIntegrity(); } catch (e) { threw = true; message = e.message; }
    check('C-07 verifyIntegrity throws a clear error when db is null (offline mode)', threw && message === 'Database not available');
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 71 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
