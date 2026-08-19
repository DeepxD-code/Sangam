'use strict';

/**
 * HTTP Integration Smoke Test — RBAC Contract Guard
 *
 * Background: while building Days 56-57, this project's own documentation
 * (code comments, not functional logic) twice mis-stated which roles hold
 * a given permission — once claiming JCO holds reports:advanced (it's
 * actually LOGISTICS_OFFICER), once claiming SENIOR_OFFICER holds
 * audit:export (it actually only holds audit:read — a DIFFERENT,
 * overlapping-but-not-identical permission). Both errors were caught by
 * manually re-reading rbac.service.js, not by any test — because no
 * existing test happened to exercise the specific role/permission pair
 * where reality diverged from the (wrong) assumption.
 *
 * This script closes that gap two ways:
 *   1. Computes the ROLE_PERMISSIONS matrix's structure PROGRAMMATICALLY
 *      (never hardcodes a role→permission snapshot that could go stale),
 *      and asserts structural invariants: every listed permission is a
 *      real PERMISSIONS constant (catches typos), SYSTEM_ADMIN holds
 *      every permission, and rank levels are unique.
 *   2. Real HTTP tests for the specific SENIOR_OFFICER distinction that
 *      was wrong in comments, plus a full reports:advanced sweep across
 *      every role (not just the two that happened to get used in Day 56),
 *      plus JWT edge cases (missing / expired / malformed / tampered)
 *      that had no coverage anywhere before this.
 */

const jwt        = require('jsonwebtoken');
const http        = require('http');
const createApp    = require('../src/app');
const RBACService  = require('../src/services/rbac.service');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function signToken(payload, options) {
  return jwt.sign(payload, JWT_SECRET, options);
}

function request(port, method, urlPath, token, opts = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token !== null) headers.Authorization = opts.rawHeader || `Bearer ${token}`;
    const req = http.request({ port, path: urlPath, method, headers }, (res) => {
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

  // ── Group A: Programmatic permission-matrix sanity ───────────────────
  console.log('\n🧮 Group A: ROLE_PERMISSIONS structural invariants (computed, not hardcoded)');
  const roles       = Object.keys(RBACService.ROLES);
  const allPerms     = Object.values(RBACService.PERMISSIONS);
  const permSet      = new Set(allPerms);

  {
    let allValid = true, badRole = null, badPerm = null;
    for (const role of roles) {
      for (const p of RBACService.ROLE_PERMISSIONS[role]) {
        if (!permSet.has(p)) { allValid = false; badRole = role; badPerm = p; break; }
      }
      if (!allValid) break;
    }
    check('A-01 every permission listed in every role is a real PERMISSIONS constant (no typos)',
      allValid, `${badRole} lists unknown permission "${badPerm}"`);
  }
  {
    const adminPerms = new Set(RBACService.ROLE_PERMISSIONS.SYSTEM_ADMIN);
    const missing = allPerms.filter(p => !adminPerms.has(p));
    check('A-02 SYSTEM_ADMIN holds every permission that exists', missing.length === 0, `missing: ${missing.join(', ')}`);
  }
  {
    const ranks = roles.map(r => RBACService.ROLES[r].rankLevel);
    check('A-03 every role has a unique rankLevel', new Set(ranks).size === ranks.length, JSON.stringify(ranks));
  }
  {
    // Compute the full non-monotonic set live, print it for visibility,
    // and just assert it's non-empty (i.e. this is a genuine, structural
    // property of this permission model, not a one-off fluke) — the
    // SPECIFIC boundaries are verified for real over HTTP in Group C.
    const byRank = roles.slice().sort((a, b) => RBACService.ROLES[a].rankLevel - RBACService.ROLES[b].rankLevel);
    const nonMonotonic = [];
    for (const perm of allPerms) {
      const holders = byRank.filter(r => RBACService.ROLE_PERMISSIONS[r].includes(perm));
      if (holders.length === 0) continue;
      const minRank = Math.min(...holders.map(r => RBACService.ROLES[r].rankLevel));
      const expected = byRank.filter(r => RBACService.ROLES[r].rankLevel >= minRank);
      const isMonotonic = expected.length === holders.length && expected.every(r => holders.includes(r));
      if (!isMonotonic) nonMonotonic.push(perm);
    }
    console.log(`  ℹ non-monotonic permissions (computed live): ${nonMonotonic.join(', ')}`);
    check('A-04 non-monotonic permissions exist (a rankLevel-only client gate would be wrong for these)', nonMonotonic.length > 0);
    check('A-05 audit:export is in the non-monotonic set', nonMonotonic.includes('audit:export'));
    check('A-06 reports:advanced is in the non-monotonic set', nonMonotonic.includes('reports:advanced'));
  }

  // ── Group B: JWT edge cases (previously zero coverage anywhere) ──────
  console.log('\n🔑 Group B: JWT edge cases');
  const app    = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  {
    const r = await request(port, 'GET', '/api/units', null);
    check('B-01 no Authorization header → 401 AUTHENTICATION_REQUIRED', r.status === 401 && r.json?.error === 'AUTHENTICATION_REQUIRED');
  }
  {
    const expired = signToken({ userId: 1, username: 'x', role: 'SYSTEM_ADMIN', unitId: 1, unitCode: 'X' }, { expiresIn: '-10s' });
    const r = await request(port, 'GET', '/api/units', expired);
    check('B-02 expired token → 401 TOKEN_EXPIRED', r.status === 401 && r.json?.error === 'TOKEN_EXPIRED', `got ${JSON.stringify(r.json)}`);
  }
  {
    const r = await request(port, 'GET', '/api/units', 'this-is-not-a-jwt-at-all');
    check('B-03 garbage string token → 401 INVALID_TOKEN', r.status === 401 && r.json?.error === 'INVALID_TOKEN', `got ${JSON.stringify(r.json)}`);
  }
  {
    const valid = signToken({ userId: 1, username: 'x', role: 'SYSTEM_ADMIN', unitId: 1, unitCode: 'X' }, { expiresIn: '1h' });
    const tampered = valid.slice(0, -4) + 'abcd'; // corrupt the signature segment
    const r = await request(port, 'GET', '/api/units', tampered);
    check('B-04 tampered signature → 401 INVALID_TOKEN', r.status === 401 && r.json?.error === 'INVALID_TOKEN', `got ${JSON.stringify(r.json)}`);
  }
  {
    // Signed with the WRONG secret entirely — different failure path than
    // corrupting a valid signature, same expected outcome.
    const wrongSecret = jwt.sign({ userId: 1, username: 'x', role: 'SYSTEM_ADMIN', unitId: 1, unitCode: 'X' }, 'a-completely-different-secret-that-is-also-32-plus-chars', { expiresIn: '1h' });
    const r = await request(port, 'GET', '/api/units', wrongSecret);
    check('B-05 token signed with wrong secret → 401 INVALID_TOKEN', r.status === 401 && r.json?.error === 'INVALID_TOKEN');
  }

  // ── Group C: the specific SENIOR_OFFICER distinction (audit:export vs audit:read) ──
  console.log('\n🎖️  Group C: SENIOR_OFFICER — audit:read yes, audit:export no (the Day 60 finding)');
  const seniorOfficer = signToken({ userId: 9401, username: 'senior', role: 'SENIOR_OFFICER', unitId: 1, unitCode: 'X' }, { expiresIn: '1h' });
  {
    const r = await request(port, 'GET', '/api/compliance/audit-export', seniorOfficer);
    check('C-01 SENIOR_OFFICER → 403 on audit:export-gated endpoint', r.status === 403, `got ${r.status}: ${JSON.stringify(r.json)}`);
  }
  {
    const r = await request(port, 'GET', '/api/delegation/overrides/pending-review', seniorOfficer);
    check('C-02 SENIOR_OFFICER → 200 on audit:read-gated endpoint', r.status === 200, `got ${r.status}: ${JSON.stringify(r.json)}`);
  }

  // ── Group D: reports:advanced — full sweep, not just the 2 roles Day 56 happened to use ──
  console.log('\n📚 Group D: reports:advanced full role sweep (computed expectation vs real HTTP)');
  for (const role of roles) {
    const expected = RBACService.ROLE_PERMISSIONS[role].includes('reports:advanced');
    const token = signToken({ userId: 9500 + roles.indexOf(role), username: 'sweep', role, unitId: 1, unitCode: 'X' }, { expiresIn: '1h' });
    const r = await request(port, 'GET', '/api/compliance/discrepancy-report', token);
    const actual = r.status === 200;
    check(`D-${role}: expected ${expected ? '200 (has reports:advanced)' : '403 (lacks it)'}, got ${r.status}`,
      actual === expected, `role=${role}`);
  }

  server.close();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`RBAC Contract Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
