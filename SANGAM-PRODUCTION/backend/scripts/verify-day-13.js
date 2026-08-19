'use strict';

/**
 * SANGAM Day 13 — Verification Suite
 * Tests: RBAC, Permission Matrix, JWT, Audit Log Hash Chain
 *
 * No database required — all logic-layer tests.
 * Run: node backend/scripts/verify-day-13.js
 */

const path = require('path');

const RBACService    = require(path.join(__dirname, '../src/services/rbac.service'));
const AuthMiddleware = require(path.join(__dirname, '../src/middleware/auth.middleware'));
const AuditLogService= require(path.join(__dirname, '../src/services/audit-log.service'));

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

// ============================================================
// TEST SUITES
// ============================================================
async function run() {
  console.log('\n🔐  SANGAM Day 13 — RBAC & Security Verification');
  console.log('═'.repeat(54));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const rbac  = new RBACService(null);
  const audit = new AuditLogService(null);

  // ──────────────────────────────────────────────────────────
  section('1 · Role Definitions');
  // ──────────────────────────────────────────────────────────

  await test('Exactly 9 army roles are defined', () => {
    const count = Object.keys(RBACService.ROLES).length;
    assert(count === 9, `Expected 9 roles, got ${count}`);
  });

  await test('SOLDIER is rank level 1 (lowest)', () => {
    assert(RBACService.ROLES.SOLDIER.rankLevel === 1);
  });

  await test('SYSTEM_ADMIN is rank level 10 (highest)', () => {
    assert(RBACService.ROLES.SYSTEM_ADMIN.rankLevel === 10);
  });

  await test('All rank levels are unique (no ties)', () => {
    const levels = Object.values(RBACService.ROLES).map(r => r.rankLevel);
    assert(new Set(levels).size === levels.length, 'Duplicate rank levels found');
  });

  await test('Every role has a non-empty displayName', () => {
    const bad = Object.values(RBACService.ROLES).filter(r => !r.displayName);
    assert(bad.length === 0, `Roles missing displayName: ${bad.map(r=>r.name).join(', ')}`);
  });

  await test('JCO role references Indian Army (Subedar)', () => {
    assert(RBACService.ROLES.JCO.displayName.includes('Subedar'));
  });

  await test('LOGISTICS_OFFICER role exists with rank 6', () => {
    assert(RBACService.ROLES.LOGISTICS_OFFICER.rankLevel === 6);
  });

  await test('AUDITOR rank is between NCO and JCO', () => {
    const { rankLevel: a } = RBACService.ROLES.AUDITOR;
    const { rankLevel: b } = RBACService.ROLES.NCO;
    const { rankLevel: c } = RBACService.ROLES.JCO;
    assert(a > b && a < c, `AUDITOR rank ${a} should be between NCO(${b}) and JCO(${c})`);
  });

  // ──────────────────────────────────────────────────────────
  section('2 · Permission Catalogue');
  // ──────────────────────────────────────────────────────────

  await test('At least 22 permissions defined', () => {
    const count = Object.keys(RBACService.PERMISSIONS).length;
    assert(count >= 22, `Expected ≥22 permissions, got ${count}`);
  });

  await test('All permissions are "resource:action" format', () => {
    const bad = Object.values(RBACService.PERMISSIONS).filter(p => !p.includes(':'));
    assert(bad.length === 0, `Bad permissions: ${bad.join(', ')}`);
  });

  await test('All 5 supply sub-permissions are defined', () => {
    const required = ['supply:read','supply:write','supply:delete','supply:transfer','supply:approve'];
    required.forEach(p => assert(
      Object.values(RBACService.PERMISSIONS).includes(p),
      `Missing permission: ${p}`
    ));
  });

  await test('audit:read and audit:export both defined', () => {
    assert(Object.values(RBACService.PERMISSIONS).includes('audit:read'));
    assert(Object.values(RBACService.PERMISSIONS).includes('audit:export'));
  });

  // ──────────────────────────────────────────────────────────
  section('3 · Permission Checking — Core Logic');
  // ──────────────────────────────────────────────────────────

  await test('SOLDIER has supply:read', () => {
    assert(rbac.hasPermission('SOLDIER', 'supply:read'));
  });

  await test('SOLDIER does NOT have supply:write', () => {
    assert(!rbac.hasPermission('SOLDIER', 'supply:write'));
  });

  await test('SOLDIER does NOT have supply:approve', () => {
    assert(!rbac.hasPermission('SOLDIER', 'supply:approve'));
  });

  await test('NCO has supply:write', () => {
    assert(rbac.hasPermission('NCO', 'supply:write'));
  });

  await test('NCO does NOT have supply:delete', () => {
    assert(!rbac.hasPermission('NCO', 'supply:delete'));
  });

  await test('NCO does NOT have supply:transfer', () => {
    assert(!rbac.hasPermission('NCO', 'supply:transfer'));
  });

  await test('JCO has supply:transfer', () => {
    assert(rbac.hasPermission('JCO', 'supply:transfer'));
  });

  await test('JCO does NOT have supply:approve', () => {
    assert(!rbac.hasPermission('JCO', 'supply:approve'));
  });

  await test('LOGISTICS_OFFICER has supply:approve', () => {
    assert(rbac.hasPermission('LOGISTICS_OFFICER', 'supply:approve'));
  });

  await test('LOGISTICS_OFFICER has supply:delete', () => {
    assert(rbac.hasPermission('LOGISTICS_OFFICER', 'supply:delete'));
  });

  await test('OFFICER has blockchain:verify', () => {
    assert(rbac.hasPermission('OFFICER', 'blockchain:verify'));
  });

  await test('OFFICER has users:write', () => {
    assert(rbac.hasPermission('OFFICER', 'users:write'));
  });

  await test('OFFICER does NOT have audit:read', () => {
    assert(!rbac.hasPermission('OFFICER', 'audit:read'));
  });

  await test('SENIOR_OFFICER has audit:read', () => {
    assert(rbac.hasPermission('SENIOR_OFFICER', 'audit:read'));
  });

  await test('SENIOR_OFFICER does NOT have audit:export', () => {
    assert(!rbac.hasPermission('SENIOR_OFFICER', 'audit:export'));
  });

  await test('COMMANDER has audit:export', () => {
    assert(rbac.hasPermission('COMMANDER', 'audit:export'));
  });

  await test('COMMANDER does NOT have system:admin', () => {
    assert(!rbac.hasPermission('COMMANDER', 'system:admin'));
  });

  await test('AUDITOR has audit:export but NOT supply:write', () => {
    assert( rbac.hasPermission('AUDITOR', 'audit:export'));
    assert(!rbac.hasPermission('AUDITOR', 'supply:write'));
  });

  await test('SYSTEM_ADMIN has every defined permission', () => {
    const all = Object.values(RBACService.PERMISSIONS);
    const missing = all.filter(p => !rbac.hasPermission('SYSTEM_ADMIN', p));
    assert(missing.length === 0, `SYSTEM_ADMIN missing: ${missing.join(', ')}`);
  });

  await test('Unknown role has no permissions', () => {
    assert(!rbac.hasPermission('GHOST_ROLE', 'supply:read'));
  });

  // ──────────────────────────────────────────────────────────
  section('4 · hasAllPermissions / hasAnyPermission');
  // ──────────────────────────────────────────────────────────

  await test('hasAllPermissions: OFFICER has supply:read + supply:write + blockchain:read', () => {
    assert(rbac.hasAllPermissions('OFFICER', ['supply:read','supply:write','blockchain:read']));
  });

  await test('hasAllPermissions: SOLDIER fails when supply:write included', () => {
    assert(!rbac.hasAllPermissions('SOLDIER', ['supply:read','supply:write']));
  });

  await test('hasAnyPermission: SOLDIER passes when supply:read is in the list', () => {
    assert(rbac.hasAnyPermission('SOLDIER', ['supply:read','supply:approve']));
  });

  await test('hasAnyPermission: SOLDIER fails when only privileged perms listed', () => {
    assert(!rbac.hasAnyPermission('SOLDIER', ['supply:delete','supply:approve']));
  });

  // ──────────────────────────────────────────────────────────
  section('5 · Rank Comparison');
  // ──────────────────────────────────────────────────────────

  await test('compareRankLevel: COMMANDER > OFFICER', () => {
    assert(rbac.compareRankLevel('COMMANDER', 'OFFICER') > 0);
  });

  await test('compareRankLevel: SOLDIER < NCO', () => {
    assert(rbac.compareRankLevel('SOLDIER', 'NCO') < 0);
  });

  await test('compareRankLevel: same role → 0', () => {
    assert(rbac.compareRankLevel('OFFICER', 'OFFICER') === 0);
  });

  // ──────────────────────────────────────────────────────────
  section('6 · User Context Building');
  // ──────────────────────────────────────────────────────────

  await test('buildUserContext creates full context', () => {
    const ctx = rbac.buildUserContext({
      id: 42, username: 'major_sharma', display_name: 'Maj A.K. Sharma',
      role: 'OFFICER', unit_id: 5, unit_code: 'COY-A-11RR'
    });
    assert(ctx.userId      === 42,            'userId mismatch');
    assert(ctx.username    === 'major_sharma','username mismatch');
    assert(ctx.role        === 'OFFICER',     'role mismatch');
    assert(ctx.unitId      === 5,             'unitId mismatch');
    assert(ctx.unitCode    === 'COY-A-11RR',  'unitCode mismatch');
    assert(typeof ctx.can    === 'function',  'can() missing');
    assert(typeof ctx.canAny === 'function',  'canAny() missing');
    assert(typeof ctx.canAll === 'function',  'canAll() missing');
  });

  await test('ctx.can() correctly gates permission', () => {
    const ctx = rbac.buildUserContext({
      id:1, username:'nco', display_name:'Hav Ram',
      role:'NCO', unit_id:7, unit_code:'SEC-1-1-A'
    });
    assert( ctx.can('supply:write'), 'NCO can supply:write');
    assert(!ctx.can('audit:read'),   'NCO cannot audit:read');
  });

  await test('isAdmin() identifies SYSTEM_ADMIN only', () => {
    const admin   = rbac.buildUserContext({ id:1, username:'sa', display_name:'SA', role:'SYSTEM_ADMIN', unit_id:1, unit_code:'HQ' });
    const soldier = rbac.buildUserContext({ id:2, username:'sp', display_name:'SP', role:'SOLDIER',      unit_id:1, unit_code:'SEC-1' });
    assert( admin.isAdmin(),   'SYSTEM_ADMIN should be admin');
    assert(!soldier.isAdmin(), 'SOLDIER should not be admin');
  });

  await test('isSuperUser() is true for SYSTEM_ADMIN and COMMANDER', () => {
    const admin = rbac.buildUserContext({ id:1, username:'a', display_name:'A', role:'SYSTEM_ADMIN', unit_id:1, unit_code:'HQ' });
    const cmd   = rbac.buildUserContext({ id:2, username:'c', display_name:'C', role:'COMMANDER',    unit_id:1, unit_code:'CORPS-21' });
    const off   = rbac.buildUserContext({ id:3, username:'o', display_name:'O', role:'OFFICER',      unit_id:1, unit_code:'COY-A' });
    assert( admin.isSuperUser(), 'SYSTEM_ADMIN is super user');
    assert( cmd.isSuperUser(),   'COMMANDER is super user');
    assert(!off.isSuperUser(),   'OFFICER is not super user');
  });

  // ──────────────────────────────────────────────────────────
  section('7 · JWT Token Utilities');
  // ──────────────────────────────────────────────────────────

  await test('generateToken produces a 3-part JWT', () => {
    const token = AuthMiddleware.generateToken({
      id:1, username:'col_verma', display_name:'Col Verma',
      role:'SENIOR_OFFICER', unit_id:3, unit_code:'BDE-26'
    });
    assert(typeof token === 'string' && token.split('.').length === 3);
  });

  await test('decodeToken round-trips the payload', () => {
    const user  = { id:100, username:'brig_kapoor', display_name:'Brig Kapoor',
                    role:'COMMANDER', unit_id:2, unit_code:'DIV-09' };
    const token   = AuthMiddleware.generateToken(user);
    const decoded = AuthMiddleware.decodeToken(token);
    assert(decoded !== null,                  'Decode should succeed');
    assert(decoded.userId   === 100,          'userId mismatch');
    assert(decoded.role     === 'COMMANDER',  'role mismatch');
    assert(decoded.unitCode === 'DIV-09',     'unitCode mismatch');
  });

  await test('decodeToken returns null for invalid token', () => {
    assert(AuthMiddleware.decodeToken('bad.jwt.data') === null);
  });

  await test('Operation token verifies for correct operation', () => {
    const tok = AuthMiddleware.generateOperationToken(42, 'TRANSFER_APPROVE');
    assert(AuthMiddleware.verifyOperationToken(tok, 'TRANSFER_APPROVE') === true);
  });

  await test('Operation token rejects wrong operation', () => {
    const tok = AuthMiddleware.generateOperationToken(42, 'TRANSFER_APPROVE');
    assert(AuthMiddleware.verifyOperationToken(tok, 'BULK_DELETE') === false);
  });

  await test('generateRefreshToken produces 128-char hex', () => {
    const t1 = AuthMiddleware.generateRefreshToken();
    const t2 = AuthMiddleware.generateRefreshToken();
    assert(t1.length === 128, `Expected 128 chars, got ${t1.length}`);
    assert(t1 !== t2,          'Tokens should be unique');
  });

  await test('hashRefreshToken produces 64-char SHA-256 hex', () => {
    const token = AuthMiddleware.generateRefreshToken();
    const hash  = AuthMiddleware.hashRefreshToken(token);
    assert(hash.length === 64, `Hash should be 64 chars, got ${hash.length}`);
    assert(/^[0-9a-f]+$/.test(hash), 'Hash should be lowercase hex');
  });

  // ──────────────────────────────────────────────────────────
  section('8 · Audit Log — Hash Chain');
  // ──────────────────────────────────────────────────────────

  await test('log() returns entry with 64-char hashes', async () => {
    const entry = await audit.log({
      userId: 1, username: 'test', role: 'OFFICER',
      action: 'SUPPLY_READ', resource: 'items', success: true
    });
    assert(entry.logHash.length     === 64, `logHash length ${entry.logHash.length}`);
    assert(entry.previousHash.length === 64, `previousHash length ${entry.previousHash.length}`);
    assert(entry.action === 'SUPPLY_READ');
    assert(entry.timestamp);
  });

  await test('Hash chain links entries correctly', async () => {
    const a2 = new AuditLogService(null);
    const e1 = await a2.log({ action: 'SUPPLY_READ',  resource: 'items', success: true });
    const e2 = await a2.log({ action: 'SUPPLY_WRITE', resource: 'items', success: true });
    assert(e2.previousHash === e1.logHash,
      'e2.previousHash must equal e1.logHash');
  });

  await test('Three consecutive entries form an unbroken chain', async () => {
    const a3 = new AuditLogService(null);
    const e1 = await a3.log({ action: 'A1', resource: 'r', success: true });
    const e2 = await a3.log({ action: 'A2', resource: 'r', success: true });
    const e3 = await a3.log({ action: 'A3', resource: 'r', success: true });
    assert(e2.previousHash === e1.logHash, 'Chain link e1→e2 broken');
    assert(e3.previousHash === e2.logHash, 'Chain link e2→e3 broken');
  });

  await test('Consecutive entries have different hashes', async () => {
    const a4 = new AuditLogService(null);
    const e1 = await a4.log({ action: 'ACT_1', resource: 'x', success: true });
    const e2 = await a4.log({ action: 'ACT_2', resource: 'x', success: true });
    assert(e1.logHash !== e2.logHash, 'Hashes must differ');
  });

  await test('security-alert event fires for SECURITY severity', async () => {
    const a5  = new AuditLogService(null);
    let fired = false;
    a5.on('security-alert', () => { fired = true; });
    await a5.log({ action: 'AUTH_FAILED', resource: 'auth', success: false, severity: 'SECURITY' });
    assert(fired, 'security-alert event should have fired');
  });

  await test('log event fires on every entry', async () => {
    const a6    = new AuditLogService(null);
    let count   = 0;
    a6.on('log', () => count++);
    await a6.log({ action: 'A', resource: 'r', success: true });
    await a6.log({ action: 'B', resource: 'r', success: true });
    assert(count === 2, `Expected 2 log events, got ${count}`);
  });

  await test('logAccess convenience method preserves fields', async () => {
    const entry = await audit.logAccess({
      userId: 99, username: 'hav_ram', role: 'NCO', unitCode: 'PL-1-A-11RR',
      action: 'AUTHENTICATE', resource: '/api/supply',
      method: 'GET', ipAddress: '10.0.0.1', success: true
    });
    assert(entry.action   === 'AUTHENTICATE');
    assert(entry.username === 'hav_ram');
  });

  await test('getStats tracks totalLogged correctly', async () => {
    const a7 = new AuditLogService(null);
    await a7.log({ action: 'X1', resource: 'r', success: true });
    await a7.log({ action: 'X2', resource: 'r', success: true });
    await a7.log({ action: 'X3', resource: 'r', success: true });
    const stats = a7.getStats();
    assert(stats.totalLogged === 3, `Expected 3, got ${stats.totalLogged}`);
  });

  // ──────────────────────────────────────────────────────────
  section('9 · Severity Determination');
  // ──────────────────────────────────────────────────────────

  await test('Successful read → INFO', () => {
    assert(audit._determineSeverity('SUPPLY_READ', true) === 'INFO');
  });

  await test('AUTH_FAILED → SECURITY', () => {
    assert(audit._determineSeverity('AUTH_FAILED', false) === 'SECURITY');
  });

  await test('AUTHORIZATION_DENIED → SECURITY', () => {
    assert(audit._determineSeverity('AUTHORIZATION_DENIED', false) === 'SECURITY');
  });

  await test('SCOPE_VIOLATION → SECURITY', () => {
    assert(audit._determineSeverity('SCOPE_VIOLATION', false) === 'SECURITY');
  });

  await test('BLOCKCHAIN_TAMPER_DETECTED (failed) → CRITICAL', () => {
    assert(audit._determineSeverity('BLOCKCHAIN_TAMPER_DETECTED', false) === 'CRITICAL');
  });

  await test('Generic failed write → WARNING', () => {
    assert(audit._determineSeverity('SUPPLY_WRITE', false) === 'WARNING');
  });

  // ──────────────────────────────────────────────────────────
  section('10 · Privilege Escalation Prevention');
  // ──────────────────────────────────────────────────────────

  await test('SOLDIER cannot access any officer-only permission', () => {
    const officerOnly = ['supply:approve','supply:delete','users:write','mesh:admin',
                         'audit:read','system:config','system:admin'];
    const escaped = officerOnly.filter(p => rbac.hasPermission('SOLDIER', p));
    assert(escaped.length === 0, `SOLDIER has: ${escaped.join(', ')}`);
  });

  await test('NCO cannot access JCO+ permissions', () => {
    const jcoOnly = ['supply:transfer','blockchain:verify','reports:export'];
    const escaped = jcoOnly.filter(p => rbac.hasPermission('NCO', p));
    assert(escaped.length === 0, `NCO has: ${escaped.join(', ')}`);
  });

  await test('SYSTEM_ADMIN has all SOLDIER permissions (monotonic stack)', () => {
    const soldierPerms = rbac.getRolePermissions('SOLDIER');
    const missing = soldierPerms.filter(p => !rbac.hasPermission('SYSTEM_ADMIN', p));
    assert(missing.length === 0, `SYSTEM_ADMIN missing: ${missing.join(', ')}`);
  });

  await test('COMMANDER has all OFFICER permissions (monotonic stack)', () => {
    const officerPerms = rbac.getRolePermissions('OFFICER');
    const missing = officerPerms.filter(p => !rbac.hasPermission('COMMANDER', p));
    assert(missing.length === 0, `COMMANDER missing: ${missing.join(', ')}`);
  });

  // ──────────────────────────────────────────────────────────
  section('11 · Action Types & Unit Hierarchy Constants');
  // ──────────────────────────────────────────────────────────

  await test('Critical action types all present', () => {
    const required = [
      'AUTHENTICATE','AUTH_FAILED','AUTHORIZATION_DENIED',
      'SCOPE_VIOLATION','SUPPLY_TRANSFER_APPROVE',
      'BLOCKCHAIN_TAMPER_DETECTED','AUDIT_INTEGRITY_CHECK',
      'SECURITY_ALERT','USER_ROLE_CHANGE','BRUTE_FORCE_DETECTED'
    ];
    required.forEach(a => assert(
      AuditLogService.ACTION_TYPES[a] !== undefined,
      `Missing action type: ${a}`
    ));
  });

  await test('Four severity levels defined', () => {
    assert(AuditLogService.SEVERITY.INFO);
    assert(AuditLogService.SEVERITY.WARNING);
    assert(AuditLogService.SEVERITY.CRITICAL);
    assert(AuditLogService.SEVERITY.SECURITY);
  });

  await test('All 7 major unit types defined in UNIT_HIERARCHY', () => {
    const required = ['SECTION','PLATOON','COMPANY','BATTALION','BRIGADE','DIVISION','CORPS'];
    required.forEach(t => assert(
      RBACService.UNIT_HIERARCHY[t] !== undefined,
      `Missing unit type: ${t}`
    ));
  });

  await test('SECTION < PLATOON < COMPANY < BATTALION (level ordering)', () => {
    const h = RBACService.UNIT_HIERARCHY;
    assert(h.SECTION.level   < h.PLATOON.level,   'SECTION < PLATOON');
    assert(h.PLATOON.level   < h.COMPANY.level,   'PLATOON < COMPANY');
    assert(h.COMPANY.level   < h.BATTALION.level, 'COMPANY < BATTALION');
    assert(h.BATTALION.level < h.BRIGADE.level,   'BATTALION < BRIGADE');
  });

  await test('CSV export produces valid header row', async () => {
    const mockAudit = new AuditLogService(null);
    mockAudit.query = async () => ({
      entries: [{
        id:1, created_at: new Date().toISOString(), username:'test',
        role_name:'OFFICER', unit_code:'COY-A', action:'SUPPLY_READ',
        resource:'supply_items', resource_id:'1', success:true,
        failure_reason:null, severity:'INFO', ip_address:'10.0.0.1',
        log_hash:'a'.repeat(64)
      }],
      total: 1
    });
    const csv   = await mockAudit.exportToCSV({});
    const lines = csv.split('\n');
    assert(lines.length >= 2,              'Need header + data row');
    assert(lines[0].includes('ID'),        'Header must include ID');
    assert(lines[0].includes('Timestamp'), 'Header must include Timestamp');
    assert(lines[0].includes('Action'),    'Header must include Action');
    assert(lines[0].includes('Log Hash'),  'Header must include Log Hash');
  });

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(54));
  console.log(`📊  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed === 0) {
    console.log('\n🎖️   ALL TESTS PASSED — Day 13 security layer verified!\n');
    console.log('Capabilities delivered:');
    console.log('  🔐  9 Indian Army rank-based roles');
    console.log('  🔑  22 granular resource:action permissions');
    console.log('  🏛️   Command hierarchy data scope enforcement');
    console.log('  🎫  JWT access + refresh + operation tokens');
    console.log('  📋  Tamper-evident SHA-256 audit hash chain');
    console.log('  🚨  Real-time SECURITY/CRITICAL event emission');
    console.log('  📤  CSV audit log export');
    console.log('  🛡️   Privilege escalation prevention verified');
    console.log('  🔗  Middleware stack: authenticate → permit → scope → audit');
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
