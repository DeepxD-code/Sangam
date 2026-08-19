'use strict';

/**
 * SANGAM Day 11 — Verification Suite
 * Tests: Notification types/severity, visibility (personal, rank-gated,
 * command-scope escalation), read/ack tracking, preferences, domain
 * triggers, audit-log integration, SSE subscriptions, digest.
 *
 * No database required — all logic-layer tests.
 * Run: node backend/scripts/verify-day-11.js
 */

const path = require('path');

const RBACService        = require(path.join(__dirname, '../src/services/rbac.service'));
const AuditLogService     = require(path.join(__dirname, '../src/services/audit-log.service'));
const NotificationService = require(path.join(__dirname, '../src/services/notification.service'));

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
// FIXTURES — a small unit tree, pre-seeded into RBAC's cache
// so command-scope checks work with no DB connection.
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
  console.log('\n🔔  SANGAM Day 11 — Notification & Alert Service Verification');
  console.log('═'.repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const rbac = buildRBAC();

  // Fixture users
  const soldierA1     = makeUser(rbac, { id: 1, username: 'soldier_a1',     role: 'SOLDIER',        unitId: 103, unitCode: 'PL-1-A' });
  const jcoA1         = makeUser(rbac, { id: 2, username: 'jco_a1',         role: 'JCO',             unitId: 103, unitCode: 'PL-1-A' });
  const coyACommander = makeUser(rbac, { id: 3, username: 'coy_a_cmdr',     role: 'OFFICER',         unitId: 101, unitCode: 'COY-A'  });
  const coyBCommander = makeUser(rbac, { id: 4, username: 'coy_b_cmdr',     role: 'OFFICER',         unitId: 102, unitCode: 'COY-B'  });
  const battalionCO   = makeUser(rbac, { id: 5, username: 'bn_co',          role: 'SENIOR_OFFICER',  unitId: 100, unitCode: 'BN-HQ'  });
  const logisticsA    = makeUser(rbac, { id: 6, username: 'log_officer_a',  role: 'LOGISTICS_OFFICER', unitId: 101, unitCode: 'COY-A' });
  const auditor       = makeUser(rbac, { id: 7, username: 'auditor_1',      role: 'AUDITOR',         unitId: 100, unitCode: 'BN-HQ'  });

  // ──────────────────────────────────────────────────────────
  section('1 · Type & Severity Catalogue');
  // ──────────────────────────────────────────────────────────

  await test('Exactly 11 notification types defined (10 + Day15 DELEGATION_GRANTED)', () => {
    assert(Object.keys(NotificationService.TYPES).length === 11);
  });

  await test('4 severity levels defined with increasing weight', () => {
    const w = NotificationService.SEVERITY_WEIGHT;
    assert(w.LOW < w.MEDIUM && w.MEDIUM < w.HIGH && w.HIGH < w.CRITICAL);
  });

  await test('Every type has a default severity', () => {
    const missing = Object.values(NotificationService.TYPES)
      .filter(t => !NotificationService.DEFAULT_SEVERITY[t]);
    assert(missing.length === 0, `Missing severity defaults: ${missing.join(', ')}`);
  });

  await test('Every type has a min-rank default', () => {
    const missing = Object.values(NotificationService.TYPES)
      .filter(t => NotificationService.MIN_RANK_DEFAULTS[t] === undefined);
    assert(missing.length === 0, `Missing rank defaults: ${missing.join(', ')}`);
  });

  await test('BLOCKCHAIN_TAMPER defaults to CRITICAL severity', () => {
    assert(NotificationService.DEFAULT_SEVERITY.BLOCKCHAIN_TAMPER === 'CRITICAL');
  });

  await test('SECURITY_ALERT min rank matches SENIOR_OFFICER (8)', () => {
    assert(NotificationService.MIN_RANK_DEFAULTS.SECURITY_ALERT === RBACService.ROLES.SENIOR_OFFICER.rankLevel);
  });

  await test('TRANSFER_PENDING min rank matches LOGISTICS_OFFICER (6)', () => {
    assert(NotificationService.MIN_RANK_DEFAULTS.TRANSFER_PENDING === RBACService.ROLES.LOGISTICS_OFFICER.rankLevel);
  });

  // ──────────────────────────────────────────────────────────
  section('2 · create() — Validation & Defaults');
  // ──────────────────────────────────────────────────────────

  await test('create() rejects unknown type', async () => {
    const svc = new NotificationService(null, rbac);
    let threw = false;
    try { await svc.create({ type: 'NOT_A_TYPE', title: 'x', message: 'y' }); }
    catch { threw = true; }
    assert(threw, 'Should throw on invalid type');
  });

  await test('create() rejects missing title/message', async () => {
    const svc = new NotificationService(null, rbac);
    let threw = false;
    try { await svc.create({ type: 'LOW_STOCK', title: 'x' }); }
    catch { threw = true; }
    assert(threw, 'Should throw on missing message');
  });

  await test('create() applies default severity when omitted', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'MESH_PEER_OFFLINE', title: 't', message: 'm' });
    assert(n.severity === 'HIGH', `Expected HIGH, got ${n.severity}`);
  });

  await test('create() applies default minRankLevel when omitted', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm' });
    assert(n.minRankLevel === 5, `Expected 5, got ${n.minRankLevel}`);
  });

  await test('create() auto-sets requiresAck=true for CRITICAL severity', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'BLOCKCHAIN_TAMPER', title: 't', message: 'm' });
    assert(n.requiresAck === true);
  });

  await test('create() does NOT force requiresAck for non-CRITICAL', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm' });
    assert(n.requiresAck === false);
  });

  await test('create() assigns sequential IDs', async () => {
    const svc = new NotificationService(null, rbac);
    const a = await svc.create({ type: 'LOW_STOCK', title: 'a', message: 'a' });
    const b = await svc.create({ type: 'LOW_STOCK', title: 'b', message: 'b' });
    assert(b.id === a.id + 1);
  });

  await test('create() emits "notification" event', async () => {
    const svc = new NotificationService(null, rbac);
    let received = null;
    svc.on('notification', n => { received = n; });
    await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm' });
    assert(received !== null && received.type === 'LOW_STOCK');
  });

  // ──────────────────────────────────────────────────────────
  section('3 · Visibility — Personal Targeting');
  // ──────────────────────────────────────────────────────────

  await test('Personal notification visible only to target user', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({
      type: 'TRANSFER_APPROVED', title: 't', message: 'm',
      targetUserId: soldierA1.userId
    });
    assert(await svc.isVisibleTo(n, soldierA1)  === true,  'target user should see it');
    assert(await svc.isVisibleTo(n, jcoA1)      === false, 'others should not');
    assert(await svc.isVisibleTo(n, battalionCO)=== false, 'even high rank should not');
  });

  await test('Personal notification bypasses rank gate entirely', async () => {
    const svc = new NotificationService(null, rbac);
    // SECURITY_ALERT normally requires rank 8 — but personal target overrides
    const n = await svc.create({
      type: 'SECURITY_ALERT', title: 't', message: 'm',
      targetUserId: soldierA1.userId // rank 1
    });
    assert(await svc.isVisibleTo(n, soldierA1) === true);
  });

  // ──────────────────────────────────────────────────────────
  section('4 · Visibility — Rank Gate');
  // ──────────────────────────────────────────────────────────

  await test('SOLDIER cannot see LOW_STOCK (min rank 5) even in own unit', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({
      type: 'LOW_STOCK', title: 't', message: 'm', sourceUnitId: 103
    });
    assert(await svc.isVisibleTo(n, soldierA1) === false);
  });

  await test('JCO (rank 5) CAN see LOW_STOCK in own unit', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({
      type: 'LOW_STOCK', title: 't', message: 'm', sourceUnitId: 103
    });
    assert(await svc.isVisibleTo(n, jcoA1) === true);
  });

  await test('SENIOR_OFFICER (rank 8) sees SECURITY_ALERT, OFFICER (7) does not', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'SECURITY_ALERT', title: 't', message: 'm' });
    assert(await svc.isVisibleTo(n, battalionCO)   === true,  'SENIOR_OFFICER should see it');
    assert(await svc.isVisibleTo(n, coyACommander) === false, 'OFFICER should not');
  });

  // ──────────────────────────────────────────────────────────
  section('5 · Visibility — Command-Scope Escalation');
  // ──────────────────────────────────────────────────────────

  await test('Company A commander sees LOW_STOCK from Platoon 1(A) (subordinate)', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm', sourceUnitId: 103 });
    assert(await svc.isVisibleTo(n, coyACommander) === true);
  });

  await test('Company B commander does NOT see LOW_STOCK from Platoon 1(A) (sibling branch)', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm', sourceUnitId: 103 });
    assert(await svc.isVisibleTo(n, coyBCommander) === false);
  });

  await test('Battalion CO sees LOW_STOCK from any platoon under the battalion', async () => {
    const svc = new NotificationService(null, rbac);
    const nA = await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm', sourceUnitId: 103 });
    const nB = await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm', sourceUnitId: 105 });
    assert(await svc.isVisibleTo(nA, battalionCO) === true, 'sees Platoon 1(A) alert');
    assert(await svc.isVisibleTo(nB, battalionCO) === true, 'sees Platoon 1(B) alert');
  });

  await test('Unit equals source (self) is always in scope', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm', sourceUnitId: 101 });
    assert(await svc.isVisibleTo(n, coyACommander) === true);
  });

  await test('sourceUnitId=null is Army-wide (subject to rank only)', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'SYSTEM_ANNOUNCEMENT', title: 't', message: 'm', minRankLevel: 1 });
    assert(await svc.isVisibleTo(n, soldierA1)     === true);
    assert(await svc.isVisibleTo(n, coyBCommander) === true);
    assert(await svc.isVisibleTo(n, battalionCO)   === true);
  });

  // ──────────────────────────────────────────────────────────
  section('6 · Visibility — Target Role Filter');
  // ──────────────────────────────────────────────────────────

  await test('targetRole restricts visibility to exact role match (within scope/rank)', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({
      type: 'SYSTEM_ANNOUNCEMENT', title: 't', message: 'm',
      minRankLevel: 1, targetRole: 'AUDITOR'
    });
    assert(await svc.isVisibleTo(n, auditor)     === true,  'AUDITOR matches');
    assert(await svc.isVisibleTo(n, battalionCO) === false, 'SENIOR_OFFICER does not match role filter');
  });

  // ──────────────────────────────────────────────────────────
  section('7 · getForUser — Filtering & Pagination');
  // ──────────────────────────────────────────────────────────

  await test('getForUser only returns notifications visible to that user', async () => {
    const svc = new NotificationService(null, rbac);
    await svc.create({ type: 'LOW_STOCK', title: 'PlatoonA stock', message: 'm', sourceUnitId: 103 });
    await svc.create({ type: 'LOW_STOCK', title: 'PlatoonB stock', message: 'm', sourceUnitId: 105 });

    const forA = await svc.getForUser(coyACommander, { limit: 50 });
    const titles = forA.notifications.map(n => n.title);
    assert(titles.includes('PlatoonA stock'), 'should include own-branch alert');
    assert(!titles.includes('PlatoonB stock'), 'should NOT include sibling-branch alert');
  });

  await test('unreadOnly filter excludes read notifications', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm', sourceUnitId: 101 });
    svc.markRead(n.id, coyACommander.userId);

    const all    = await svc.getForUser(coyACommander, { limit: 50 });
    const unread = await svc.getForUser(coyACommander, { limit: 50, unreadOnly: true });

    assert(all.notifications.some(x => x.id === n.id),    'present in full list');
    assert(!unread.notifications.some(x => x.id === n.id),'absent from unread list');
  });

  await test('type filter narrows results', async () => {
    const svc = new NotificationService(null, rbac);
    await svc.create({ type: 'LOW_STOCK',    title: 'a', message: 'm', sourceUnitId: 100, minRankLevel: 1 });
    await svc.create({ type: 'SYNC_CONFLICT', title: 'b', message: 'm', sourceUnitId: 100, minRankLevel: 1 });

    const result = await svc.getForUser(battalionCO, { type: 'SYNC_CONFLICT', limit: 50 });
    assert(result.notifications.every(n => n.type === 'SYNC_CONFLICT'));
    assert(result.notifications.length >= 1);
  });

  await test('pagination: limit and offset respected', async () => {
    const svc = new NotificationService(null, rbac);
    for (let i = 0; i < 5; i++) {
      await svc.create({ type: 'SYSTEM_ANNOUNCEMENT', title: `n${i}`, message: 'm', minRankLevel: 1 });
    }
    const page1 = await svc.getForUser(soldierA1, { limit: 2, offset: 0 });
    const page2 = await svc.getForUser(soldierA1, { limit: 2, offset: 2 });
    assert(page1.notifications.length === 2);
    assert(page2.notifications.length === 2);
    assert(page1.notifications[0].id !== page2.notifications[0].id);
  });

  await test('limit is capped at 500', async () => {
    const svc = new NotificationService(null, rbac);
    const result = await svc.getForUser(soldierA1, { limit: 10000 });
    assert(result.limit === 500);
  });

  // ──────────────────────────────────────────────────────────
  section('8 · Read / Acknowledge Tracking');
  // ──────────────────────────────────────────────────────────

  await test('markRead is idempotent and sets read=true in getForUser', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'LOW_STOCK', title: 't', message: 'm', sourceUnitId: 101 });

    svc.markRead(n.id, coyACommander.userId);
    svc.markRead(n.id, coyACommander.userId); // second call should not throw

    const { notifications } = await svc.getForUser(coyACommander, { limit: 50 });
    const found = notifications.find(x => x.id === n.id);
    assert(found.read === true);
  });

  await test('markRead throws for nonexistent notification', () => {
    const svc = new NotificationService(null, rbac);
    let threw = false;
    try { svc.markRead(99999, 1); } catch { threw = true; }
    assert(threw);
  });

  await test('acknowledge() implies read', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'BLOCKCHAIN_TAMPER', title: 't', message: 'm' });

    svc.acknowledge(n.id, battalionCO.userId);

    const { notifications } = await svc.getForUser(battalionCO, { limit: 50 });
    const found = notifications.find(x => x.id === n.id);
    assert(found.read === true,         'acknowledge implies read');
    assert(found.acknowledged === true, 'acknowledged flag set');
  });

  await test('markAllRead zeroes out unread count for that user', async () => {
    const svc = new NotificationService(null, rbac);
    await svc.create({ type: 'SYSTEM_ANNOUNCEMENT', title: 'a', message: 'm', minRankLevel: 1 });
    await svc.create({ type: 'SYSTEM_ANNOUNCEMENT', title: 'b', message: 'm', minRankLevel: 1 });

    const before = await svc.getUnreadCount(soldierA1);
    const result  = await svc.markAllRead(soldierA1);
    const after   = await svc.getUnreadCount(soldierA1);

    assert(before >= 2, `expected ≥2 unread before, got ${before}`);
    assert(result.count === before, 'markAllRead count matches prior unread');
    assert(after === 0, `expected 0 unread after, got ${after}`);
  });

  await test('markAllRead does not affect a different user\'s unread count', async () => {
    const svc = new NotificationService(null, rbac);
    await svc.create({ type: 'SYSTEM_ANNOUNCEMENT', title: 'x', message: 'm', minRankLevel: 1 });

    await svc.markAllRead(soldierA1);
    const otherUnread = await svc.getUnreadCount(jcoA1);
    assert(otherUnread >= 1, 'jcoA1 unread count should be untouched');
  });

  // ──────────────────────────────────────────────────────────
  section('9 · Preferences');
  // ──────────────────────────────────────────────────────────

  await test('getPreferences defaults every type to enabled=true', () => {
    const svc = new NotificationService(null, rbac);
    const prefs = svc.getPreferences(soldierA1.userId);
    Object.values(NotificationService.TYPES).forEach(t => {
      assert(prefs[t] === true, `${t} should default to true`);
    });
  });

  await test('Disabling a non-ack type hides it from getForUser', async () => {
    const svc = new NotificationService(null, rbac);
    svc.setPreference(soldierA1.userId, 'SYSTEM_ANNOUNCEMENT', false);

    await svc.create({ type: 'SYSTEM_ANNOUNCEMENT', title: 'muted', message: 'm', minRankLevel: 1 });

    const { notifications } = await svc.getForUser(soldierA1, { limit: 50 });
    assert(!notifications.some(n => n.title === 'muted'));
  });

  await test('requiresAck notifications IGNORE mute preference', async () => {
    const svc = new NotificationService(null, rbac);
    svc.setPreference(battalionCO.userId, 'BLOCKCHAIN_TAMPER', false);

    await svc.create({ type: 'BLOCKCHAIN_TAMPER', title: 'cannot mute', message: 'm' });

    const { notifications } = await svc.getForUser(battalionCO, { limit: 50 });
    assert(notifications.some(n => n.title === 'cannot mute'), 'CRITICAL/ack-required must still appear');
  });

  await test('setPreference rejects unknown type', () => {
    const svc = new NotificationService(null, rbac);
    let threw = false;
    try { svc.setPreference(1, 'NOT_A_TYPE', false); } catch { threw = true; }
    assert(threw);
  });

  // ──────────────────────────────────────────────────────────
  section('10 · Domain Trigger Helpers');
  // ──────────────────────────────────────────────────────────

  await test('notifyLowStock produces correctly-shaped LOW_STOCK notification', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.notifyLowStock({
      itemName: '7.62mm Ball Ammunition', currentQty: 340, threshold: 500,
      unitId: 103, itemId: 8821
    });
    assert(n.type === 'LOW_STOCK');
    assert(n.sourceUnitId === 103);
    assert(n.resourceType === 'supply_item');
    assert(n.resourceId === 8821);
    assert(n.message.includes('340'));
  });

  await test('notifyTransferPending targets the approving (from) unit', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.notifyTransferPending({
      transferId: 552, itemName: 'MRE Pack (24x)', quantity: 50,
      fromUnitId: 101, toUnitId: 103
    });
    assert(n.type === 'TRANSFER_PENDING');
    assert(n.sourceUnitId === 101);
    assert(n.minRankLevel === 6, 'matches LOGISTICS_OFFICER+');
  });

  await test('notifyTransferDecision (approved) is personal and LOW severity', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.notifyTransferDecision({
      transferId: 552, itemName: 'MRE Pack (24x)', approved: true, requestedByUserId: soldierA1.userId
    });
    assert(n.type === 'TRANSFER_APPROVED');
    assert(n.targetUserId === soldierA1.userId);
    assert(n.severity === 'LOW');
    assert(await svc.isVisibleTo(n, soldierA1) === true);
    assert(await svc.isVisibleTo(n, jcoA1)     === false);
  });

  await test('notifyTransferDecision (rejected) sets MEDIUM severity', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.notifyTransferDecision({
      transferId: 553, itemName: 'Boots', approved: false, requestedByUserId: soldierA1.userId
    });
    assert(n.type === 'TRANSFER_REJECTED');
    assert(n.severity === 'MEDIUM');
  });

  await test('notifyMeshPeerStatus(online=false) → MESH_PEER_OFFLINE, HIGH', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.notifyMeshPeerStatus({
      peerId: 'NODE-7', peerName: 'Forward Post Charlie', unitId: 104, online: false
    });
    assert(n.type === 'MESH_PEER_OFFLINE');
    assert(n.severity === 'HIGH');
    assert(n.sourceUnitId === 104);
  });

  await test('notifyMeshPeerStatus(online=true) → MESH_PEER_ONLINE, LOW', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.notifyMeshPeerStatus({
      peerId: 'NODE-7', peerName: 'Forward Post Charlie', unitId: 104, online: true
    });
    assert(n.type === 'MESH_PEER_ONLINE');
    assert(n.severity === 'LOW');
  });

  await test('notifySyncConflict always requires acknowledgement', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.notifySyncConflict({
      conflictId: 91, resourceType: 'supply_item', resourceId: 8821, unitId: 103
    });
    assert(n.type === 'SYNC_CONFLICT');
    assert(n.requiresAck === true);
  });

  await test('notifySystemAnnouncement defaults to Army-wide visibility', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.notifySystemAnnouncement({ title: 'HQ notice', message: 'All units stand by.' });
    assert(n.sourceUnitId === null);
    assert(await svc.isVisibleTo(n, soldierA1)     === true);
    assert(await svc.isVisibleTo(n, coyBCommander) === true);
  });

  // ──────────────────────────────────────────────────────────
  section('11 · Audit Log Integration (Day 13)');
  // ──────────────────────────────────────────────────────────

  await test('AUTH_FAILED security-alert auto-creates SECURITY_ALERT notification', async () => {
    const audit = new AuditLogService(null);
    const svc   = new NotificationService(null, rbac, audit);

    let created = null;
    svc.on('notification', n => { if (n.type === 'SECURITY_ALERT') created = n; });

    await audit.log({
      action: 'AUTH_FAILED', resource: 'auth', username: 'unknown',
      success: false, severity: 'SECURITY'
    });

    // _onSecurityAlert is async — give the microtask queue a tick
    await new Promise(r => setImmediate(r));

    assert(created !== null, 'SECURITY_ALERT should have been created');
    assert(created.requiresAck === true);
    assert(created.minRankLevel === 8);
  });

  await test('Failed AUDIT_INTEGRITY_CHECK auto-creates BLOCKCHAIN_TAMPER notification', async () => {
    const audit = new AuditLogService(null);
    const svc   = new NotificationService(null, rbac, audit);

    let created = null;
    svc.on('notification', n => { if (n.type === 'BLOCKCHAIN_TAMPER') created = n; });

    await audit.log({
      action: 'AUDIT_INTEGRITY_CHECK', resource: 'audit_logs',
      success: false, severity: 'CRITICAL'
    });
    await new Promise(r => setImmediate(r));

    assert(created !== null, 'BLOCKCHAIN_TAMPER should have been created');
    assert(created.severity === 'CRITICAL');
    assert(created.requiresAck === true);
  });

  await test('Successful audit events do NOT create notifications', async () => {
    const audit = new AuditLogService(null);
    const svc   = new NotificationService(null, rbac, audit);

    let count = 0;
    svc.on('notification', () => count++);

    await audit.log({ action: 'SUPPLY_READ', resource: 'items', success: true }); // INFO, no alert
    await new Promise(r => setImmediate(r));

    assert(count === 0, `Expected 0 notifications, got ${count}`);
  });

  // ──────────────────────────────────────────────────────────
  section('12 · SSE Subscriptions');
  // ──────────────────────────────────────────────────────────

  await test('subscribe() delivers visible notifications in real time', async () => {
    const svc = new NotificationService(null, rbac);
    const received = [];
    svc.subscribe(coyACommander, n => received.push(n));

    await svc.create({ type: 'LOW_STOCK', title: 'live alert', message: 'm', sourceUnitId: 101 });
    assert(received.length === 1 && received[0].title === 'live alert');
  });

  await test('subscribe() does NOT deliver out-of-scope notifications', async () => {
    const svc = new NotificationService(null, rbac);
    const received = [];
    svc.subscribe(coyBCommander, n => received.push(n));

    await svc.create({ type: 'LOW_STOCK', title: 'company A only', message: 'm', sourceUnitId: 101 });
    assert(received.length === 0);
  });

  await test('unsubscribe() stops further delivery', async () => {
    const svc = new NotificationService(null, rbac);
    const received = [];
    const unsubscribe = svc.subscribe(coyACommander, n => received.push(n));

    unsubscribe();
    await svc.create({ type: 'LOW_STOCK', title: 'after unsub', message: 'm', sourceUnitId: 101 });
    assert(received.length === 0);
  });

  await test('getSubscriberCount reflects active subscriptions', () => {
    const svc = new NotificationService(null, rbac);
    svc.subscribe(soldierA1, () => {});
    svc.subscribe(jcoA1, () => {});
    assert(svc.getSubscriberCount() === 2);
  });

  // ──────────────────────────────────────────────────────────
  section('13 · Daily Digest');
  // ──────────────────────────────────────────────────────────

  await test('getDailyDigest aggregates by severity and type', async () => {
    const svc = new NotificationService(null, rbac);
    await svc.create({ type: 'LOW_STOCK',    title: 'a', message: 'm', sourceUnitId: 101 });
    await svc.create({ type: 'LOW_STOCK',    title: 'b', message: 'm', sourceUnitId: 101 });
    await svc.create({ type: 'SYNC_CONFLICT', title: 'c', message: 'm', sourceUnitId: 101 });

    const digest = await svc.getDailyDigest(coyACommander, 24);
    assert(digest.byType.LOW_STOCK === 2);
    assert(digest.byType.SYNC_CONFLICT === 1);
    assert(digest.bySeverity.MEDIUM >= 2);
    assert(digest.total === 3);
  });

  await test('getDailyDigest counts pendingAck for requires-ack items', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'BLOCKCHAIN_TAMPER', title: 'tamper', message: 'm' });

    const before = await svc.getDailyDigest(battalionCO, 24);
    assert(before.pendingAck >= 1);

    svc.acknowledge(n.id, battalionCO.userId);
    const after = await svc.getDailyDigest(battalionCO, 24);
    assert(after.pendingAck === before.pendingAck - 1);
  });

  await test('getDailyDigest respects the time window', async () => {
    const svc = new NotificationService(null, rbac);
    const n = await svc.create({ type: 'SYSTEM_ANNOUNCEMENT', title: 'old', message: 'm', minRankLevel: 1 });
    // Backdate it beyond the window
    n.createdAt = new Date(Date.now() - 48 * 3_600_000).toISOString();

    const digest = await svc.getDailyDigest(soldierA1, 24);
    assert(!digest.items.some(i => i.title === 'old'), 'old item should be excluded from 24h digest');
  });

  // ──────────────────────────────────────────────────────────
  section('14 · Maintenance & Stats');
  // ──────────────────────────────────────────────────────────

  await test('pruneExpired removes only expired notifications', async () => {
    const svc = new NotificationService(null, rbac);
    await svc.create({ type: 'SYSTEM_ANNOUNCEMENT', title: 'fresh', message: 'm', minRankLevel: 1 });
    await svc.create({
      type: 'SYSTEM_ANNOUNCEMENT', title: 'expired', message: 'm', minRankLevel: 1,
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });

    const removed = svc.pruneExpired();
    assert(removed === 1, `Expected 1 removed, got ${removed}`);

    const { notifications } = await svc.getForUser(soldierA1, { limit: 50 });
    assert(notifications.some(n => n.title === 'fresh'));
    assert(!notifications.some(n => n.title === 'expired'));
  });

  await test('getStats reports totals correctly', async () => {
    const svc = new NotificationService(null, rbac);
    await svc.create({ type: 'LOW_STOCK', title: 'a', message: 'm', sourceUnitId: 101 });
    await svc.create({ type: 'LOW_STOCK', title: 'b', message: 'm', sourceUnitId: 101 });
    svc.subscribe(soldierA1, () => {});

    const stats = svc.getStats();
    assert(stats.totalCreated === 2);
    assert(stats.activeCount === 2);
    assert(stats.streamSubscribers === 1);
  });

  await test('getById returns null for unknown ID', () => {
    const svc = new NotificationService(null, rbac);
    assert(svc.getById(99999) === null);
  });

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`📊  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed === 0) {
    console.log('\n🔔  ALL TESTS PASSED — Day 11 notification layer verified!\n');
    console.log('Capabilities delivered:');
    console.log('  📋  10 notification types with severity/rank defaults');
    console.log('  👤  Personal delivery (direct-to-user, bypasses rank/scope)');
    console.log('  🏛️   Scoped escalation via Day 13 command-hierarchy reuse');
    console.log('  ✅  Read vs. Acknowledge semantics (immutable, per-user)');
    console.log('  🔇  Mute preferences with a hard floor for requires-ack');
    console.log('  🔌  Domain trigger helpers for supply/transfer/mesh/sync');
    console.log('  🚨  Auto-notification from Day 13 audit security-alerts');
    console.log('  📡  SSE subscription model with visibility filtering');
    console.log('  📊  Daily digest aggregation');
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
