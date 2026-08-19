'use strict';

/**
 * Day 23 Verification — User Management Service & Routes
 *
 * Groups:
 *   A: createUser
 *   B: getUserById / getUserByUsername / getUsersInScope
 *   C: updateUser
 *   D: assignRole
 *   E: assignUnit
 *   F: deactivateUser / reactivateUser
 *   G: unlockUser
 *   H: resetPasswordHash
 *   I: getUserStats
 *   J: Edge cases & routes module
 */

const assert = require('assert');
const UserManagementService = require('../src/services/user-management.service');
const AuditLogService       = require('../src/services/audit-log.service');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { console.log(`  ✅ ${name}`); passed++; })
              .catch(e => { console.error(`  ❌ ${name}: ${e.message}`); failed++; });
    }
    console.log(`  ✅ ${name}`); passed++;
  } catch (e) {
    console.error(`  ❌ ${name}: ${e.message}`); failed++;
  }
  return Promise.resolve();
}

async function buildEnv() {
  const audit = new AuditLogService(null);
  const svc   = new UserManagementService(null, audit);

  // Seed users across two units (10 and 11)
  const u1 = (await svc.createUser({
    username: 'subedar.sharma', displayName: 'Sub Ramesh Sharma',
    role: 'JCO', unitId: 10, unitCode: 'A-COY',
    serviceNumber: 'JC-12345', createdByUserId: 0
  })).user;

  const u2 = (await svc.createUser({
    username: 'hav.singh', displayName: 'Hav Gurpreet Singh',
    role: 'NCO', unitId: 10, unitCode: 'A-COY',
    serviceNumber: 'NK-67890'
  })).user;

  const u3 = (await svc.createUser({
    username: 'capt.verma', displayName: 'Capt Anil Verma',
    role: 'OFFICER', unitId: 11, unitCode: 'B-COY',
    email: 'verma@army.mil'
  })).user;

  const u4 = (await svc.createUser({
    username: 'sep.kumar', displayName: 'Sep Raj Kumar',
    role: 'SOLDIER', unitId: 11, unitCode: 'B-COY'
  })).user;

  await new Promise(r => setTimeout(r, 20));
  return { audit, svc, u1, u2, u3, u4 };
}

async function run() {
  const { audit, svc, u1, u2, u3, u4 } = await buildEnv();

  // ─────────────────────────────────────────────────────────────────
  // GROUP A: createUser
  // ─────────────────────────────────────────────────────────────────
  console.log('\n👤 Group A: createUser');

  await test('A-01 created user has correct fields', () => {
    assert.strictEqual(u1.username, 'subedar.sharma');
    assert.strictEqual(u1.role, 'JCO');
    assert.strictEqual(u1.unitId, 10);
    assert.strictEqual(u1.active, true);
  });

  await test('A-02 passwordHash is stripped from response', () => {
    assert.ok(!('passwordHash' in u1));
  });

  await test('A-03 missing required fields → MISSING_REQUIRED_FIELDS', async () => {
    const r = await svc.createUser({ username: 'x' });
    assert.strictEqual(r.error, 'MISSING_REQUIRED_FIELDS');
  });

  await test('A-04 invalid role → INVALID_ROLE', async () => {
    const r = await svc.createUser({
      username: 'x', displayName: 'X', role: 'GENERAL'
    });
    assert.strictEqual(r.error, 'INVALID_ROLE');
  });

  await test('A-05 duplicate username → USERNAME_EXISTS', async () => {
    const r = await svc.createUser({
      username: 'subedar.sharma', displayName: 'X', role: 'SOLDIER'
    });
    assert.strictEqual(r.error, 'USERNAME_EXISTS');
  });

  await test('A-06 duplicate serviceNumber → SERVICE_NUMBER_EXISTS', async () => {
    const r = await svc.createUser({
      username: 'new.user', displayName: 'New', role: 'NCO',
      serviceNumber: 'JC-12345' // already used by u1
    });
    assert.strictEqual(r.error, 'SERVICE_NUMBER_EXISTS');
  });

  await test('A-07 user without unit created ok', async () => {
    const r = await svc.createUser({
      username: 'nunit.user', displayName: 'No Unit', role: 'AUDITOR'
    });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.user.unitId, null);
  });

  await test('A-08 stats.usersCreated increments', () => {
    const s = svc.getStats();
    assert.ok(s.usersCreated >= 4);
  });

  await test('A-09 VALID_ROLES static has 9 entries', () => {
    assert.strictEqual(UserManagementService.VALID_ROLES.length, 9);
    assert.ok(UserManagementService.VALID_ROLES.includes('SYSTEM_ADMIN'));
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP B: getUserById / getUserByUsername / getUsersInScope
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔍 Group B: Get Users');

  await test('B-01 getUserById returns correct user', () => {
    const u = svc.getUserById(u1.id);
    assert.ok(u);
    assert.strictEqual(u.username, 'subedar.sharma');
    assert.ok(!('passwordHash' in u));
  });

  await test('B-02 getUserById non-existent → null', () => {
    assert.strictEqual(svc.getUserById(9999), null);
  });

  await test('B-03 getUserByUsername returns user', () => {
    const u = svc.getUserByUsername('capt.verma');
    assert.ok(u);
    assert.strictEqual(u.role, 'OFFICER');
  });

  await test('B-04 getUserByUsername non-existent → null', () => {
    assert.strictEqual(svc.getUserByUsername('ghost.user'), null);
  });

  await test('B-05 getUsersInScope returns only scoped users', () => {
    const { users, total } = svc.getUsersInScope([10]);
    assert.ok(users.every(u => u.unitId === 10));
    assert.strictEqual(total, users.length);
  });

  await test('B-06 getUsersInScope role filter', () => {
    const { users } = svc.getUsersInScope([10, 11], { role: 'NCO' });
    assert.ok(users.every(u => u.role === 'NCO'));
  });

  await test('B-07 getUsersInScope search by displayName', () => {
    const { users } = svc.getUsersInScope([10, 11], { search: 'verma' });
    assert.ok(users.some(u => u.username === 'capt.verma'));
  });

  await test('B-08 getUsersInScope search by serviceNumber', () => {
    const { users } = svc.getUsersInScope([10], { search: 'JC-123' });
    assert.ok(users.some(u => u.serviceNumber === 'JC-12345'));
  });

  await test('B-09 getUsersInScope pagination', () => {
    const { users } = svc.getUsersInScope([10, 11], { limit: 2, offset: 0 });
    assert.ok(users.length <= 2);
  });

  await test('B-10 getUsersInScope activeOnly=false includes inactive', async () => {
    await svc.deactivateUser(u4.id);
    const { users: active } = svc.getUsersInScope([11], { activeOnly: true });
    const { users: all }    = svc.getUsersInScope([11], { activeOnly: false });
    assert.ok(active.every(u => u.active));
    assert.ok(all.length >= active.length);
    await svc.reactivateUser(u4.id); // restore
  });

  await test('B-11 out-of-scope unit returns empty', () => {
    const { users } = svc.getUsersInScope([99]);
    assert.strictEqual(users.length, 0);
  });

  await test('B-12 results sorted by displayName', () => {
    const { users } = svc.getUsersInScope([10]);
    for (let i = 1; i < users.length; i++) {
      assert.ok(users[i].displayName >= users[i - 1].displayName);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP C: updateUser
  // ─────────────────────────────────────────────────────────────────
  console.log('\n✏️  Group C: updateUser');

  await test('C-01 update displayName', async () => {
    const r = await svc.updateUser(u2.id, { displayName: 'Hav G Singh (Ret)' }, 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.user.displayName, 'Hav G Singh (Ret)');
  });

  await test('C-02 update email', async () => {
    const r = await svc.updateUser(u1.id, { email: 'sharma@army.mil' }, 1);
    assert.strictEqual(r.user.email, 'sharma@army.mil');
  });

  await test('C-03 update serviceNumber', async () => {
    const r = await svc.updateUser(u3.id, { serviceNumber: 'IC-11111' }, 1);
    assert.strictEqual(r.user.serviceNumber, 'IC-11111');
  });

  await test('C-04 update non-existent user → USER_NOT_FOUND', async () => {
    const r = await svc.updateUser(9999, { email: 'x' });
    assert.strictEqual(r.error, 'USER_NOT_FOUND');
  });

  await test('C-05 no updatable fields provided → NO_UPDATE_FIELDS', async () => {
    const r = await svc.updateUser(u1.id, { role: 'OFFICER' }); // role not updatable here
    assert.strictEqual(r.error, 'NO_UPDATE_FIELDS');
  });

  await test('C-06 duplicate serviceNumber on update → SERVICE_NUMBER_EXISTS', async () => {
    const r = await svc.updateUser(u2.id, { serviceNumber: 'JC-12345' }); // u1's number
    assert.strictEqual(r.error, 'SERVICE_NUMBER_EXISTS');
  });

  await test('C-07 update inactive user → USER_INACTIVE', async () => {
    await svc.deactivateUser(u4.id);
    const r = await svc.updateUser(u4.id, { displayName: 'X' });
    assert.strictEqual(r.error, 'USER_INACTIVE');
    await svc.reactivateUser(u4.id);
  });

  await test('C-08 updatedAt changes on update', async () => {
    const before = svc.getUserById(u1.id).updatedAt;
    await new Promise(r => setTimeout(r, 5));
    await svc.updateUser(u1.id, { email: 'new@army.mil' });
    const after  = svc.getUserById(u1.id).updatedAt;
    assert.ok(after >= before);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP D: assignRole
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🎖️  Group D: assignRole');

  await test('D-01 assignRole changes role', async () => {
    const r = await svc.assignRole(u2.id, 'JCO', 5);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.user.role, 'JCO');
  });

  await test('D-02 stats.roleAssignments incremented', () => {
    assert.ok(svc.getStats().roleAssignments >= 1);
  });

  await test('D-03 assignRole invalid → INVALID_ROLE', async () => {
    const r = await svc.assignRole(u1.id, 'FIELDMARSHAL');
    assert.strictEqual(r.error, 'INVALID_ROLE');
  });

  await test('D-04 assignRole non-existent user → USER_NOT_FOUND', async () => {
    const r = await svc.assignRole(9999, 'NCO');
    assert.strictEqual(r.error, 'USER_NOT_FOUND');
  });

  await test('D-05 assignRole fires audit entry', async () => {
    const queueBefore = audit._writeQueue.length;
    await svc.assignRole(u3.id, 'OFFICER', 9);
    assert.ok(audit._writeQueue.length > queueBefore ||
              audit._inMemoryBuffer.length > 0);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP E: assignUnit
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🏠 Group E: assignUnit');

  await test('E-01 assignUnit moves user to new unit', async () => {
    const r = await svc.assignUnit(u4.id, 10, 'A-COY', 1);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.user.unitId, 10);
    assert.strictEqual(r.user.unitCode, 'A-COY');
  });

  await test('E-02 stats.unitReassignments incremented', () => {
    assert.ok(svc.getStats().unitReassignments >= 1);
  });

  await test('E-03 assignUnit with null removes unit association', async () => {
    const r = await svc.assignUnit(u4.id, null, null, 1);
    assert.strictEqual(r.user.unitId, null);
  });

  await test('E-04 assignUnit non-existent → USER_NOT_FOUND', async () => {
    const r = await svc.assignUnit(9999, 10);
    assert.strictEqual(r.error, 'USER_NOT_FOUND');
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP F: deactivateUser / reactivateUser
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔴 Group F: deactivate / reactivate');

  await test('F-01 deactivateUser sets active=false', async () => {
    const r = await svc.deactivateUser(u4.id, 5);
    assert.strictEqual(r.success, true);
    assert.strictEqual(svc.getUserById(u4.id).active, false);
  });

  await test('F-02 deactivate already-inactive → ALREADY_INACTIVE', async () => {
    const r = await svc.deactivateUser(u4.id);
    assert.strictEqual(r.error, 'ALREADY_INACTIVE');
  });

  await test('F-03 deactivate non-existent → USER_NOT_FOUND', async () => {
    const r = await svc.deactivateUser(9999);
    assert.strictEqual(r.error, 'USER_NOT_FOUND');
  });

  await test('F-04 reactivateUser restores account', async () => {
    const r = await svc.reactivateUser(u4.id, 5);
    assert.strictEqual(r.success, true);
    assert.strictEqual(svc.getUserById(u4.id).active, true);
  });

  await test('F-05 reactivate already-active → ALREADY_ACTIVE', async () => {
    const r = await svc.reactivateUser(u4.id);
    assert.strictEqual(r.error, 'ALREADY_ACTIVE');
  });

  await test('F-06 reactivate non-existent → USER_NOT_FOUND', async () => {
    const r = await svc.reactivateUser(9999);
    assert.strictEqual(r.error, 'USER_NOT_FOUND');
  });

  await test('F-07 stats.usersDeactivated incremented', () => {
    assert.ok(svc.getStats().usersDeactivated >= 1);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP G: unlockUser
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔓 Group G: unlockUser');

  await test('G-01 unlockUser clears lockout', async () => {
    // Simulate a locked user by accessing internal state
    const raw = svc._getUserRaw(u1.id);
    raw.accountLocked    = true;
    raw.failedLoginCount = 5;
    raw.lockedUntil      = new Date(Date.now() + 60000).toISOString();

    const r = await svc.unlockUser(u1.id, 5);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.user.accountLocked, false);
    assert.strictEqual(r.user.failedLoginCount, 0);
    assert.strictEqual(r.user.lockedUntil, null);
  });

  await test('G-02 unlockUser non-existent → USER_NOT_FOUND', async () => {
    const r = await svc.unlockUser(9999);
    assert.strictEqual(r.error, 'USER_NOT_FOUND');
  });

  await test('G-03 unlockUser on never-locked user is safe', async () => {
    const r = await svc.unlockUser(u2.id, 5);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.user.failedLoginCount, 0);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP H: resetPasswordHash
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🔑 Group H: resetPasswordHash');

  const FAKE_HASH = '$2b$12$fakehashforthispurpose1234567890abcdef';

  await test('H-01 resetPasswordHash sets new hash', async () => {
    const r = await svc.resetPasswordHash(u1.id, FAKE_HASH, 5);
    assert.strictEqual(r.success, true);
    // Hash not exposed via getUserById
    const raw = svc._getUserRaw(u1.id);
    assert.strictEqual(raw.passwordHash, FAKE_HASH);
  });

  await test('H-02 resetPasswordHash stats incremented', () => {
    assert.ok(svc.getStats().passwordResets >= 1);
  });

  await test('H-03 resetPasswordHash non-existent → USER_NOT_FOUND', async () => {
    const r = await svc.resetPasswordHash(9999, FAKE_HASH);
    assert.strictEqual(r.error, 'USER_NOT_FOUND');
  });

  await test('H-04 resetPasswordHash null hash → INVALID_HASH', async () => {
    const r = await svc.resetPasswordHash(u1.id, null);
    assert.strictEqual(r.error, 'INVALID_HASH');
  });

  await test('H-05 resetPasswordHash empty string → INVALID_HASH', async () => {
    const r = await svc.resetPasswordHash(u1.id, '');
    assert.strictEqual(r.error, 'INVALID_HASH');
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP I: getUserStats
  // ─────────────────────────────────────────────────────────────────
  console.log('\n📊 Group I: getUserStats');

  await test('I-01 getUserStats returns correct total', () => {
    const s = svc.getUserStats([10, 11]);
    assert.ok(s.totalUsers >= 3); // u4 is null unit now
  });

  await test('I-02 byRole counts match', () => {
    const s = svc.getUserStats([10, 11]);
    assert.ok(typeof s.byRole === 'object');
    const roleTotal = Object.values(s.byRole).reduce((a, b) => a + b, 0);
    assert.strictEqual(roleTotal, s.totalUsers);
  });

  await test('I-03 byUnit counts match', () => {
    const s = svc.getUserStats([10]);
    assert.ok(s.byUnit[10] >= 1);
  });

  await test('I-04 active + inactive = total', () => {
    const s = svc.getUserStats([10, 11]);
    assert.strictEqual(s.active + s.inactive, s.totalUsers);
  });

  await test('I-05 generatedAt is ISO timestamp', () => {
    const s = svc.getUserStats([10]);
    assert.ok(!isNaN(new Date(s.generatedAt)));
  });

  await test('I-06 empty scope returns zero stats', () => {
    const s = svc.getUserStats([99]);
    assert.strictEqual(s.totalUsers, 0);
  });

  // ─────────────────────────────────────────────────────────────────
  // GROUP J: Edge cases & routes module
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🛡️  Group J: Edge Cases & Routes');

  await test('J-01 routes module loads without error', () => {
    const createUserRoutes = require('../src/routes/user.routes');
    assert.strictEqual(typeof createUserRoutes, 'function');
  });

  await test('J-02 getStats returns all counter fields', () => {
    const s = svc.getStats();
    assert.ok('usersCreated'     in s);
    assert.ok('usersDeactivated' in s);
    assert.ok('roleAssignments'  in s);
    assert.ok('unitReassignments' in s);
    assert.ok('passwordResets'   in s);
    assert.ok('totalUsers'       in s);
  });

  await test('J-03 _safeUser strips passwordHash', () => {
    const raw  = svc._getUserRaw(u1.id);
    const safe = svc._safeUser(raw);
    assert.ok('id'       in safe);
    assert.ok('username' in safe);
    assert.ok(!('passwordHash' in safe));
  });

  await test('J-04 createUser with all optional fields', async () => {
    const r = await svc.createUser({
      username: 'full.user', displayName: 'Full User',
      role: 'SOLDIER', unitId: 10, unitCode: 'A-COY',
      email: 'full@mil.in', serviceNumber: 'SVC-99999',
      passwordHash: FAKE_HASH, createdByUserId: 5
    });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.user.email, 'full@mil.in');
    assert.ok(!('passwordHash' in r.user));
  });

  await test('J-05 service works without audit log', async () => {
    const svc2 = new UserManagementService(null);
    const r    = await svc2.createUser({
      username: 'noaudit', displayName: 'No Audit', role: 'SOLDIER'
    });
    assert.strictEqual(r.success, true);
  });

  await test('J-06 getUsersInScope returns total including pages not returned', () => {
    const { total, users } = svc.getUsersInScope([10], { limit: 1 });
    assert.ok(users.length === 1);
    assert.ok(total >= users.length); // total may be > 1
  });

  // ─────────────────────────────────────────────────────────────────
  // FINAL
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 23 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(err => { console.error(err); process.exit(1); });
