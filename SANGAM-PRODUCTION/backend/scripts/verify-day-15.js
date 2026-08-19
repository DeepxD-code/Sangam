'use strict';

/**
 * SANGAM Day 15 — Verification Suite
 * Tests: delegation creation/validation, command-scope coverage for
 * delegated permissions, revocation (single + bulk), emergency
 * overrides (issuance/use/review), the combined effective-permission
 * check, AuthMiddleware.requirePermissionOrDelegation, and the
 * Day15→14 (lockout auto-revokes delegations) integration.
 *
 * No real database required.
 * Run: node backend/scripts/verify-day-15.js
 */

const path = require('path');

const RBACService        = require(path.join(__dirname, '../src/services/rbac.service'));
const AuditLogService     = require(path.join(__dirname, '../src/services/audit-log.service'));
const NotificationService = require(path.join(__dirname, '../src/services/notification.service'));
const AuthMiddleware      = require(path.join(__dirname, '../src/middleware/auth.middleware'));
const AuthService         = require(path.join(__dirname, '../src/services/auth.service'));
const DelegationService   = require(path.join(__dirname, '../src/services/delegation.service'));

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
// FIXTURES — same unit tree as Days 11/12/14
//
//   100 Battalion
//     ├─ 101 Company A
//     │    ├─ 103 Platoon 1 (A)
//     │    └─ 104 Platoon 2 (A)
//     └─ 102 Company B
//          └─ 105 Platoon 1 (B)
// ============================================================
function buildRBAC() {
  const rbac = new RBACService(null);
  rbac._hierarchyCache.set('scope_100', { ids: [100, 101, 102, 103, 104, 105], codes: [] });
  rbac._hierarchyCache.set('scope_101', { ids: [101, 103, 104], codes: [] });
  rbac._hierarchyCache.set('scope_102', { ids: [102, 105], codes: [] });
  rbac._hierarchyCache.set('scope_103', { ids: [103], codes: [] });
  rbac._hierarchyCache.set('scope_104', { ids: [104], codes: [] });
  rbac._hierarchyCache.set('scope_105', { ids: [105], codes: [] });
  return rbac;
}

function makeUser(rbac, { id, username, role, unitId, unitCode }) {
  return rbac.buildUserContext({
    id, username, display_name: username, role, unit_id: unitId, unit_code: unitCode
  });
}

// ============================================================
// TEST SUITES
// ============================================================
async function run() {
  console.log('\n🤝  SANGAM Day 15 — Delegation & Override Verification');
  console.log('═'.repeat(58));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const rbac = buildRBAC();

  const coyACommander = makeUser(rbac, { id: 3, username: 'coy_a_cmdr', role: 'OFFICER', unitId: 101, unitCode: 'COY-A' });
  const jcoA1         = makeUser(rbac, { id: 2, username: 'jco_a1',     role: 'JCO',     unitId: 103, unitCode: 'PL-1-A' });
  const soldierA1     = makeUser(rbac, { id: 1, username: 'soldier_a1', role: 'SOLDIER', unitId: 103, unitCode: 'PL-1-A' });
  const battalionCO   = makeUser(rbac, { id: 5, username: 'bn_co',      role: 'SENIOR_OFFICER', unitId: 100, unitCode: 'BN-HQ' });

  // ──────────────────────────────────────────────────────────
  section('1 · Constants');
  // ──────────────────────────────────────────────────────────

  await test('MAX_DELEGATION_HOURS is 168 (7 days)', () => {
    assert(DelegationService.MAX_DELEGATION_HOURS === 168);
  });
  await test('MIN_REASON_LENGTH is 5', () => {
    assert(DelegationService.MIN_REASON_LENGTH === 5);
  });
  await test('DEFAULT/MAX_OVERRIDE_MINUTES are 30/120', () => {
    assert(DelegationService.DEFAULT_OVERRIDE_MINUTES === 30);
    assert(DelegationService.MAX_OVERRIDE_MINUTES === 120);
  });
  await test('MIN_JUSTIFICATION_LENGTH is 10', () => {
    assert(DelegationService.MIN_JUSTIFICATION_LENGTH === 10);
  });
  await test('OVERRIDE_REVIEW_ESCALATION_HOURS is 24', () => {
    assert(DelegationService.OVERRIDE_REVIEW_ESCALATION_HOURS === 24);
  });

  // ──────────────────────────────────────────────────────────
  section('2 · createDelegation — Validation');
  // ──────────────────────────────────────────────────────────

  await test('Rejects unknown permission', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'not:a:permission', unitId: 101, durationHours: 24, reason: 'test reason'
    });
    assert(r.success === false && r.error === 'UNKNOWN_PERMISSION');
  });

  await test('Rejects when delegator lacks the permission', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createDelegation({
      delegatorUserId: 1, delegatorRole: 'SOLDIER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 103, durationHours: 24, reason: 'test reason'
    });
    assert(r.success === false && r.error === 'DELEGATOR_LACKS_PERMISSION');
  });

  await test('Rejects invalid duration (0, negative, over max)', async () => {
    const svc = new DelegationService(null, rbac);
    for (const bad of [0, -5, 200]) {
      const r = await svc.createDelegation({
        delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
        permission: 'supply:approve', unitId: 101, durationHours: bad, reason: 'test reason'
      });
      assert(r.success === false && r.error === 'INVALID_DURATION', `duration=${bad} should be invalid`);
    }
  });

  await test('Rejects missing/short reason', async () => {
    const svc = new DelegationService(null, rbac);
    const r1 = await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: ''
    });
    const r2 = await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'hi'
    });
    assert(r1.error === 'REASON_REQUIRED');
    assert(r2.error === 'REASON_REQUIRED');
  });

  await test('Rejects self-delegation', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 3,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'test reason'
    });
    assert(r.success === false && r.error === 'CANNOT_DELEGATE_TO_SELF');
  });

  await test('Successful delegation has correct shape and expiry', async () => {
    const svc = new DelegationService(null, rbac);
    const before = Date.now();
    const r = await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 72, reason: 'Officer on leave 15-18 June'
    });
    assert(r.success === true);
    assert(r.delegation.id === 1);
    assert(r.delegation.revokedAt === null);

    const spanMs = new Date(r.delegation.expiresAt).getTime() - before;
    assert(Math.abs(spanMs - 72 * 3_600_000) < 5000, '72h expiry window');
  });

  // ──────────────────────────────────────────────────────────
  section('3 · findActiveDelegation — Command-Scope Coverage');
  // ──────────────────────────────────────────────────────────

  await test('Exact unit match', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'test reason'
    });
    const d = await svc.findActiveDelegation(2, 'supply:approve', 101);
    assert(d !== null);
  });

  await test('Descendant unit is covered (101 → 103)', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'test reason'
    });
    const d = await svc.findActiveDelegation(2, 'supply:approve', 103);
    assert(d !== null, 'Platoon 1(A) is under Company A');
  });

  await test('Sibling branch is NOT covered (101 ↛ 105)', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'test reason'
    });
    const d = await svc.findActiveDelegation(2, 'supply:approve', 105);
    assert(d === null, 'Platoon 1(B) is Company B, not under Company A');
  });

  await test('null unitId = permission-only check', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'test reason'
    });
    const d = await svc.findActiveDelegation(2, 'supply:approve', null);
    assert(d !== null);
  });

  await test('Wrong permission → null', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'test reason'
    });
    const d = await svc.findActiveDelegation(2, 'supply:delete', 101);
    assert(d === null);
  });

  await test('Expired delegation → null', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 1, reason: 'test reason'
    });
    r.delegation.expiresAt = new Date(Date.now() - 1000).toISOString(); // force expiry
    const d = await svc.findActiveDelegation(2, 'supply:approve', 101);
    assert(d === null);
  });

  await test('Revoked delegation → null', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'test reason'
    });
    await svc.revokeDelegation(r.delegation.id, 3);
    const d = await svc.findActiveDelegation(2, 'supply:approve', 101);
    assert(d === null);
  });

  // ──────────────────────────────────────────────────────────
  section('4 · Revocation');
  // ──────────────────────────────────────────────────────────

  await test('revokeDelegation returns NOT_FOUND for unknown id', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.revokeDelegation(9999, 3);
    assert(r.error === 'DELEGATION_NOT_FOUND');
  });

  await test('revokeDelegation twice → ALREADY_REVOKED on second', async () => {
    const svc = new DelegationService(null, rbac);
    const created = await svc.createDelegation({
      delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2,
      permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'test reason'
    });
    const first  = await svc.revokeDelegation(created.delegation.id, 3);
    const second = await svc.revokeDelegation(created.delegation.id, 3);
    assert(first.success === true);
    assert(second.error === 'ALREADY_REVOKED');
  });

  await test('revokeAllForUser only revokes that delegator\'s active grants', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createDelegation({ delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2, permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'grant 1' });
    await svc.createDelegation({ delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 6, permission: 'supply:transfer', unitId: 101, durationHours: 24, reason: 'grant 2' });
    await svc.createDelegation({ delegatorUserId: 4, delegatorRole: 'OFFICER', delegateUserId: 2, permission: 'supply:approve', unitId: 102, durationHours: 24, reason: 'other officer grant' });

    const r = await svc.revokeAllForUser(3, null, 'test bulk revoke');
    assert(r.revokedCount === 2);

    // User 4's grant to user 2 should be untouched
    const stillActive = await svc.findActiveDelegation(2, 'supply:approve', 102);
    assert(stillActive !== null, 'delegation from a different delegator must survive');
  });

  // ──────────────────────────────────────────────────────────
  section('5 · hasEffectivePermission');
  // ──────────────────────────────────────────────────────────

  await test('Role grants directly → via:"role"', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.hasEffectivePermission(coyACommander, 'supply:approve', 101);
    assert(r.granted === true && r.via === 'role');
  });

  await test('No role + no delegation/override → granted:false', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.hasEffectivePermission(soldierA1, 'supply:approve', 103);
    assert(r.granted === false);
  });

  await test('Active delegation grants via:"delegation"', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createDelegation({
      delegatorUserId: coyACommander.userId, delegatorRole: 'OFFICER',
      delegateUserId: jcoA1.userId, permission: 'supply:approve',
      unitId: 101, durationHours: 24, reason: 'covering approvals'
    });
    const r = await svc.hasEffectivePermission(jcoA1, 'supply:approve', 103);
    assert(r.granted === true && r.via === 'delegation');
  });

  // ──────────────────────────────────────────────────────────
  section('6 · Notification Integration — Delegation Grant');
  // ──────────────────────────────────────────────────────────

  await test('Granting a delegation sends a personal DELEGATION_GRANTED notification', async () => {
    const audit = new AuditLogService(null);
    const notif = new NotificationService(null, rbac, audit);
    const svc   = new DelegationService(null, rbac, notif, audit);

    const r = await svc.createDelegation({
      delegatorUserId: coyACommander.userId, delegatorRole: 'OFFICER',
      delegateUserId: jcoA1.userId, permission: 'supply:approve',
      unitId: 101, durationHours: 24, reason: 'covering approvals'
    });
    assert(r.success === true);

    const { notifications } = await notif.getForUser(jcoA1, { limit: 50 });
    const grant = notifications.find(n => n.type === 'DELEGATION_GRANTED' && n.title.includes('supply:approve'));
    assert(grant !== undefined);
    assert(grant.severity === 'LOW');
  });

  // ──────────────────────────────────────────────────────────
  section('7 · createOverride — Validation');
  // ──────────────────────────────────────────────────────────

  await test('Rejects unknown permission', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createOverride({ userId: 1, permission: 'nope:nope', justification: 'a valid justification here' });
    assert(r.error === 'UNKNOWN_PERMISSION');
  });

  await test('Rejects short justification', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createOverride({ userId: 1, permission: 'supply:transfer', justification: 'too short' });
    assert(r.error === 'JUSTIFICATION_REQUIRED');
  });

  await test('Rejects invalid duration', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createOverride({
      userId: 1, permission: 'supply:transfer', justification: 'a valid justification here',
      durationMinutes: 500
    });
    assert(r.error === 'INVALID_DURATION');
  });

  await test('Success: defaults duration to 30 minutes', async () => {
    const svc = new DelegationService(null, rbac);
    const before = Date.now();
    const r = await svc.createOverride({
      userId: 1, permission: 'supply:transfer', attemptedUnitId: 105,
      justification: 'Unit 105 isolated, casualties pending, no comms with HQ'
    });
    assert(r.success === true);
    const spanMs = new Date(r.override.expiresAt).getTime() - before;
    assert(Math.abs(spanMs - 30 * 60_000) < 2000);
  });

  // ──────────────────────────────────────────────────────────
  section('8 · Override Issuance → SECURITY Audit → SECURITY_ALERT');
  // ──────────────────────────────────────────────────────────

  await test('OVERRIDE_ISSUED is audited with SECURITY severity BEFORE any use', async () => {
    const audit = new AuditLogService(null);
    const svc = new DelegationService(null, rbac, null, audit);

    let captured = null;
    audit.on('log', e => { if (e.action === 'OVERRIDE_ISSUED') captured = e; });

    const r = await svc.createOverride({
      userId: 1, permission: 'supply:transfer', attemptedUnitId: 105,
      justification: 'Unit 105 isolated, casualties pending, no comms with HQ'
    });

    assert(r.success === true);
    assert(captured !== null);
    assert(captured.severity === 'SECURITY');
    assert(captured.success === true, 'issuance itself is not a "failure"');
  });

  await test('Issuing an override produces a requiresAck SECURITY_ALERT notification', async () => {
    const audit = new AuditLogService(null);
    const notif = new NotificationService(null, rbac, audit);
    const svc   = new DelegationService(null, rbac, notif, audit);

    const received = [];
    notif.on('notification', n => received.push(n));

    await svc.createOverride({
      userId: 1, permission: 'supply:transfer', attemptedUnitId: 105,
      justification: 'Unit 105 isolated, casualties pending, no comms with HQ'
    });

    const alert = received.find(n => n.type === 'SECURITY_ALERT');
    assert(alert !== undefined);
    assert(alert.requiresAck === true);
    assert(alert.minRankLevel === 8);
  });

  // ──────────────────────────────────────────────────────────
  section('9 · findActiveOverride — Exact-Match Semantics');
  // ──────────────────────────────────────────────────────────

  await test('Exact (user, permission, unit) match', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    const o = await svc.findActiveOverride(1, 'supply:transfer', 105);
    assert(o !== null);
  });

  await test('Different unit (even if related) does NOT match', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    const o = await svc.findActiveOverride(1, 'supply:transfer', 102); // 102 is parent of 105 — still no match
    assert(o === null, 'overrides are single-action, not scope-extending');
  });

  await test('null unitId matches regardless of attemptedUnitId', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    const o = await svc.findActiveOverride(1, 'supply:transfer', null);
    assert(o !== null);
  });

  await test('Expired override → null', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    r.override.expiresAt = new Date(Date.now() - 1000).toISOString();
    const o = await svc.findActiveOverride(1, 'supply:transfer', 105);
    assert(o === null);
  });

  // ──────────────────────────────────────────────────────────
  section('10 · consumeOverride');
  // ──────────────────────────────────────────────────────────

  await test('consumeOverride marks usedAt and audits OVERRIDE_USED', async () => {
    const audit = new AuditLogService(null);
    const svc = new DelegationService(null, rbac, null, audit);

    let captured = null;
    audit.on('log', e => { if (e.action === 'OVERRIDE_USED') captured = e; });

    const r = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    const result = await svc.consumeOverride(r.override.id);

    assert(result.success === true);
    assert(result.override.usedAt !== null);
    assert(captured !== null);
  });

  await test('Consumed override no longer found by findActiveOverride', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    await svc.consumeOverride(r.override.id);
    const o = await svc.findActiveOverride(1, 'supply:transfer', 105);
    assert(o === null);
  });

  await test('Double-consume → ALREADY_USED', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    await svc.consumeOverride(r.override.id);
    const second = await svc.consumeOverride(r.override.id);
    assert(second.error === 'ALREADY_USED');
  });

  await test('consumeOverride on unknown id → NOT_FOUND', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.consumeOverride(99999);
    assert(r.error === 'OVERRIDE_NOT_FOUND');
  });

  // ──────────────────────────────────────────────────────────
  section('11 · hasEffectivePermission via Override');
  // ──────────────────────────────────────────────────────────

  await test('Active override grants via:"override"', async () => {
    const svc = new DelegationService(null, rbac);
    await svc.createOverride({ userId: soldierA1.userId, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    const r = await svc.hasEffectivePermission(soldierA1, 'supply:transfer', 105);
    assert(r.granted === true && r.via === 'override');
  });

  // ──────────────────────────────────────────────────────────
  section('12 · reviewOverride');
  // ──────────────────────────────────────────────────────────

  await test('reviewOverride marks reviewed and audits OVERRIDE_REVIEWED', async () => {
    const audit = new AuditLogService(null);
    const svc = new DelegationService(null, rbac, null, audit);

    let captured = null;
    audit.on('log', e => { if (e.action === 'OVERRIDE_REVIEWED') captured = e; });

    const r = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    const result = await svc.reviewOverride(r.override.id, battalionCO.userId);

    assert(result.success === true);
    assert(result.override.reviewedBy === battalionCO.userId);
    assert(captured !== null);
  });

  await test('Double-review → ALREADY_REVIEWED', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'valid justification text here' });
    await svc.reviewOverride(r.override.id, battalionCO.userId);
    const second = await svc.reviewOverride(r.override.id, battalionCO.userId);
    assert(second.error === 'ALREADY_REVIEWED');
  });

  await test('reviewOverride on unknown id → NOT_FOUND', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.reviewOverride(99999, battalionCO.userId);
    assert(r.error === 'OVERRIDE_NOT_FOUND');
  });

  // ──────────────────────────────────────────────────────────
  section('13 · Pending / Overdue Review Queues');
  // ──────────────────────────────────────────────────────────

  await test('getPendingReviewOverrides returns unreviewed, oldest-first', async () => {
    const svc = new DelegationService(null, rbac);
    const a = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'first justification text' });
    const b = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'second justification text' });
    await svc.reviewOverride(a.override.id, battalionCO.userId);

    const pending = svc.getPendingReviewOverrides();
    assert(pending.length === 1);
    assert(pending[0].id === b.override.id);
  });

  await test('getOverdueReviews respects the escalation window', async () => {
    const svc = new DelegationService(null, rbac);
    const r = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'old override justification' });

    // Not yet overdue
    assert(svc.getOverdueReviews(24).length === 0);

    // Backdate creation past the 24h window
    r.override.createdAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    assert(svc.getOverdueReviews(24).length === 1);
  });

  // ──────────────────────────────────────────────────────────
  section('14 · getStats');
  // ──────────────────────────────────────────────────────────

  await test('getStats reports correct totals and active/pending counts', async () => {
    const svc = new DelegationService(null, rbac);

    await svc.createDelegation({ delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 2, permission: 'supply:approve', unitId: 101, durationHours: 24, reason: 'reason one' });
    const revoked = await svc.createDelegation({ delegatorUserId: 3, delegatorRole: 'OFFICER', delegateUserId: 6, permission: 'supply:transfer', unitId: 101, durationHours: 24, reason: 'reason two' });
    await svc.revokeDelegation(revoked.delegation.id, 3);

    await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'override justification one' });
    const reviewed = await svc.createOverride({ userId: 1, permission: 'supply:transfer', attemptedUnitId: 105, justification: 'override justification two' });
    await svc.reviewOverride(reviewed.override.id, battalionCO.userId);

    const stats = svc.getStats();
    assert(stats.totalDelegations === 2);
    assert(stats.activeDelegations === 1, 'one revoked');
    assert(stats.totalOverrides === 2);
    assert(stats.pendingReview === 1, 'one reviewed, one pending');
  });

  // ──────────────────────────────────────────────────────────
  section('15 · AuthMiddleware.requirePermissionOrDelegation');
  // ──────────────────────────────────────────────────────────

  function makeReqRes(user, extra = {}) {
    let statusCode = 200;
    let body = null;
    const req = { user, params: extra.params || {}, body: extra.body || {}, query: extra.query || {}, path: '/test', method: 'POST', ip: '10.0.0.1' };
    const res = {
      status: (c) => { statusCode = c; return res; },
      json:   (b) => { body = b; return res; }
    };
    return { req, res, status: () => statusCode, body: () => body };
  }

  await test('Role already grants → next() called, no delegation lookup needed', async () => {
    const audit = new AuditLogService(null);
    const auth  = new AuthMiddleware(null, audit); // no delegationService
    const mw = auth.requirePermissionOrDelegation('supply:approve');

    const { req, res } = makeReqRes(coyACommander);
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });

    assert(nextCalled === true);
  });

  await test('No delegationService + lacking permission → standard 403', async () => {
    const audit = new AuditLogService(null);
    const auth  = new AuthMiddleware(null, audit);
    const mw = auth.requirePermissionOrDelegation('supply:approve');

    const { req, res, status, body } = makeReqRes(jcoA1);
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });

    assert(nextCalled === false);
    assert(status() === 403);
    assert(body().error === 'INSUFFICIENT_PERMISSIONS');
  });

  await test('Active delegation → next() called, req.delegation set', async () => {
    const audit = new AuditLogService(null);
    const delegationSvc = new DelegationService(null, rbac, null, audit);
    await delegationSvc.createDelegation({
      delegatorUserId: coyACommander.userId, delegatorRole: 'OFFICER',
      delegateUserId: jcoA1.userId, permission: 'supply:approve',
      unitId: 101, durationHours: 24, reason: 'covering approvals'
    });

    const auth = new AuthMiddleware(null, audit, delegationSvc);
    const mw = auth.requirePermissionOrDelegation('supply:approve', 'unitId');

    const { req, res } = makeReqRes(jcoA1, { body: { unitId: 103 } }); // Platoon under Company A
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });

    assert(nextCalled === true);
    assert(req.delegation !== undefined);
    assert(req.delegation.permission === 'supply:approve');
  });

  await test('Active override → next() called once, req.override set, then consumed', async () => {
    const audit = new AuditLogService(null);
    const delegationSvc = new DelegationService(null, rbac, null, audit);
    await delegationSvc.createOverride({
      userId: soldierA1.userId, permission: 'supply:transfer', attemptedUnitId: 105,
      justification: 'Emergency transfer needed, comms down with HQ'
    });

    const auth = new AuthMiddleware(null, audit, delegationSvc);
    const mw = auth.requirePermissionOrDelegation('supply:transfer', 'unitId');

    // First attempt — should succeed via override
    const { req: req1, res: res1 } = makeReqRes(soldierA1, { body: { unitId: 105 } });
    let next1 = false;
    await mw(req1, res1, () => { next1 = true; });

    assert(next1 === true);
    assert(req1.override !== undefined);

    // Second attempt — override now consumed, should be denied
    const { req: req2, res: res2, status: status2 } = makeReqRes(soldierA1, { body: { unitId: 105 } });
    let next2 = false;
    await mw(req2, res2, () => { next2 = true; });

    assert(next2 === false, 'override is single-use');
    assert(status2() === 403);
  });

  await test('Neither permission, delegation, nor override → 403', async () => {
    const audit = new AuditLogService(null);
    const delegationSvc = new DelegationService(null, rbac, null, audit);
    const auth = new AuthMiddleware(null, audit, delegationSvc);
    const mw = auth.requirePermissionOrDelegation('supply:approve', 'unitId');

    const { req, res, status, body } = makeReqRes(soldierA1, { body: { unitId: 103 } });
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });

    assert(nextCalled === false);
    assert(status() === 403);
    assert(body().requiredPermissions[0] === 'supply:approve');
  });

  // ──────────────────────────────────────────────────────────
  section('16 · Integration — Account Lockout Auto-Revokes Delegations (Day15→14)');
  // ──────────────────────────────────────────────────────────

  /** Stateful single-user mock — mirrors Day 14's pattern. */
  function makeStatefulUserDb(initialUser) {
    const state = { ...initialUser };
    return {
      state,
      query: async (sql, params) => {
        if (sql.includes('FROM users') && sql.includes('SELECT')) return { rows: [{ ...state }] };
        if (sql.includes('account_locked = true')) {
          state.account_locked = true; state.locked_until = params[0]; return { rows: [] };
        }
        if (sql.includes('failed_login_count = 0')) {
          state.failed_login_count = 0; state.account_locked = false; state.locked_until = null; return { rows: [] };
        }
        if (sql.includes('failed_login_count = $1')) { state.failed_login_count = params[0]; return { rows: [] }; }
        return { rows: [] };
      }
    };
  }

  await test('Locking the delegator\'s account auto-revokes their active delegations', async () => {
    const audit = new AuditLogService(null);
    const delegationSvc = new DelegationService(null, rbac, null, audit);

    const hashSvc = new AuthService(null);
    const someHash = await hashSvc.hashPassword('TheRealPassword1');

    const db = makeStatefulUserDb({
      id: 50, username: 'officer_z', password_hash: someHash,
      display_name: 'Officer Z', role: 'OFFICER', unit_id: 101, unit_code: 'COY-A',
      failed_login_count: 0, account_locked: false, locked_until: null
    });

    // officer_z (OFFICER, has supply:approve) delegates to jcoA1
    const grant = await delegationSvc.createDelegation({
      delegatorUserId: 50, delegatorRole: 'OFFICER',
      delegateUserId: jcoA1.userId, permission: 'supply:approve',
      unitId: 101, durationHours: 24, reason: 'Officer Z on leave'
    });
    assert(grant.success === true);
    assert((await delegationSvc.findActiveDelegation(jcoA1.userId, 'supply:approve', 101)) !== null);

    // AuthService wired WITH the delegation service
    const authSvc = new AuthService(db, audit, undefined, delegationSvc);

    for (let i = 0; i < AuthService.MAX_FAILED_ATTEMPTS; i++) {
      await authSvc.login({ username: 'officer_z', password: 'WrongEveryTime' });
    }

    assert(db.state.account_locked === true, 'account should be locked');

    const stillActive = await delegationSvc.findActiveDelegation(jcoA1.userId, 'supply:approve', 101);
    assert(stillActive === null, 'delegation should be auto-revoked when delegator is locked');

    const record = delegationSvc.getDelegationsGrantedBy(50)[0];
    assert(record.revokedAt !== null);
    assert(record.revocationReason.toLowerCase().includes('locked'));
  });

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(58));
  console.log(`📊  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed === 0) {
    console.log('\n🤝  ALL TESTS PASSED — Day 15 delegation & override layer verified!\n');
    console.log('Capabilities delivered:');
    console.log('  📋  Delegation: scoped, time-boxed, validated against delegator\'s own permissions');
    console.log('  🌳  Command-scope coverage: delegation to a unit covers its descendants');
    console.log('  🚫  Sibling-branch isolation preserved for delegated authority');
    console.log('  🔁  Revocation: single + bulk (revokeAllForUser)');
    console.log('  🚨  Emergency override: justified, single-use, SECURITY-audited at issuance');
    console.log('  ✅  Review queue with 24h overdue escalation');
    console.log('  🔗  hasEffectivePermission: role → delegation → override, in order');
    console.log('  🧩  AuthMiddleware.requirePermissionOrDelegation — full integration');
    console.log('  🔒  Day14 lockout auto-revokes the locked user\'s delegations');
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
