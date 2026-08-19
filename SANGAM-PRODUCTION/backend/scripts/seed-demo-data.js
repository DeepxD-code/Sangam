/**
 * seed-demo-data.js  —  SANGAM Demo Data Seeder  (Day 32)
 *
 * Populates a fresh in-memory SANGAM instance with realistic demo data:
 *   - 1 Brigade headquarters (BRIGADE)
 *   - 3 Battalions under the Brigade
 *   - 1 Company under Battalion Alpha
 *   - 5 users (1 admin, 1 brigade commander, 2 battalion officers, 1 logistics NCO)
 *   - 20 supply items across realistic Indian Army categories
 *   - 8 transfers (mix of PENDING, APPROVED, REJECTED)
 *   - 3 movement orders
 *   - Triggers an alert scan so the dashboard has live data
 *
 * IMPORTANT: This script operates on the in-memory service layer directly
 * (no real DB required). It is safe to run in any environment and is
 * idempotent on the service state (creates fresh instances).
 *
 * Usage:
 *   node backend/scripts/seed-demo-data.js
 *
 * Or import and call seedDemoData(services) from integration tests.
 */

'use strict';

const path = require('path');

// ── Service imports ───────────────────────────────────────────────────────
const AuditLogService      = require(path.join(__dirname, '../src/services/audit-log.service.js'));
const RBACService          = require(path.join(__dirname, '../src/services/rbac.service.js'));
const AuthService          = require(path.join(__dirname, '../src/services/auth.service.js'));
const UnitManagementService = require(path.join(__dirname, '../src/services/unit-management.service.js'));
const UserManagementService = require(path.join(__dirname, '../src/services/user-management.service.js'));
const SupplyChainService   = require(path.join(__dirname, '../src/services/supply-chain.service.js'));
const NotificationService  = require(path.join(__dirname, '../src/services/notification.service.js'));
const AlertEscalationService = require(path.join(__dirname, '../src/services/alert-escalation.service.js'));
const MovementOrderService   = require(path.join(__dirname, '../src/services/movement-order.service.js'));
const InventoryLedgerService = require(path.join(__dirname, '../src/services/inventory-ledger.service.js'));

// ── Helpers ───────────────────────────────────────────────────────────────

function ok(result, label) {
  if (!result || !result.success) {
    throw new Error(`SEED FAILED [${label}]: ${result?.message || result?.error || 'unknown'}`);
  }
  return result;
}

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}

// ── Main seeder ───────────────────────────────────────────────────────────

async function seedDemoData(existingServices = null) {
  const services = existingServices || buildServices();
  const { audit, rbac, auth, units, users, supply, notifications, movement, inventory } = services;

  log('');
  log('════════════════════════════════════════════════');
  log('  SANGAM — Demo Data Seeder');
  log('════════════════════════════════════════════════');
  log('');

  // ── 1. Units ─────────────────────────────────────────────────────────
  log('▸ Creating units…');

  const brigadRes = await units.createUnit({
    unitName: '14 RAJPUTANA RIFLES BRIGADE', unitType: 'BRIGADE',
    unitCode: '14RR-BDE', location: 'Delhi Cantonment',
    createdByUserId: null
  });

  // Idempotency guard: if this exact process/service set has already been
  // seeded (e.g. a startup hook accidentally running twice), the brigade's
  // unitCode will already exist. Skip cleanly instead of throwing via ok()
  // or silently creating duplicate units on every call, which is what this
  // script did until Day 59 — safe on a fresh process (the normal case,
  // since in-memory state doesn't survive a restart anyway) but not if
  // ever called more than once against the same live services.
  if (!brigadRes.success && brigadRes.error === 'UNIT_CODE_EXISTS') {
    log('  Demo data already present (14RR-BDE exists) — skipping re-seed.');
    log('  To force a clean re-seed, restart the process.');
    return { alreadySeeded: true };
  }
  ok(brigadRes, 'brigade');
  const brigadeId = brigadRes.unit.id;
  log(`  ✓ 14 RAJPUTANA RIFLES BRIGADE (id=${brigadeId})`);

  // Day 68: command_units.parent_unit_id is a self-referencing FK, and
  // _dbWrite() is deliberately fire-and-forget (never blocks the live
  // request path). Creating a child unit before its parent's SQL write
  // has landed is a real, observed race — confirmed against genuine
  // PostgreSQL, not theoretical — so bulk-seeding explicitly flushes
  // between dependent levels. The live per-request path is unaffected.
  await units.flushPendingWrites();

  const alphaRes = ok(
    await units.createUnit({
      unitName: '1 BATTALION ALPHA', unitType: 'BATTALION',
      unitCode: '1BN-ALPHA', parentUnitId: brigadeId,
      location: 'Delhi Cantonment', createdByUserId: null
    }), 'alpha-bn'
  );
  const alphaBnId = alphaRes.unit.id;
  log(`  ✓ 1 BATTALION ALPHA (id=${alphaBnId})`);

  const betaRes = ok(
    await units.createUnit({
      unitName: '2 BATTALION BETA', unitType: 'BATTALION',
      unitCode: '2BN-BETA', parentUnitId: brigadeId,
      location: 'Meerut Cantonment', createdByUserId: null
    }), 'beta-bn'
  );
  const betaBnId = betaRes.unit.id;
  log(`  ✓ 2 BATTALION BETA (id=${betaBnId})`);

  const gammaRes = ok(
    await units.createUnit({
      unitName: '3 BATTALION GAMMA', unitType: 'BATTALION',
      unitCode: '3BN-GAMMA', parentUnitId: brigadeId,
      location: 'Jaipur Cantonment', createdByUserId: null
    }), 'gamma-bn'
  );
  const gammaBnId = gammaRes.unit.id;
  log(`  ✓ 3 BATTALION GAMMA (id=${gammaBnId})`);

  // Same reasoning as above — ALPHA COMPANY's parent_unit_id references
  // alphaBnId, so alphaBn's (and its siblings') writes must have landed
  // first.
  await units.flushPendingWrites();

  const compRes = ok(
    await units.createUnit({
      unitName: 'ALPHA COMPANY', unitType: 'COMPANY',
      unitCode: 'ALPHA-COY', parentUnitId: alphaBnId,
      location: 'Delhi Cantonment', createdByUserId: null
    }), 'alpha-coy'
  );
  const alphaCoyId = compRes.unit.id;
  log(`  ✓ ALPHA COMPANY (id=${alphaCoyId})`);

  // ── 2. Users ──────────────────────────────────────────────────────────
  log('');
  log('▸ Creating users…');

  const PEPPER = process.env.PASSWORD_PEPPER || 'sangam-pepper-dev-CHANGE-IN-PRODUCTION';
  const bcrypt = require('bcrypt');

  async function hash(pw) {
    return bcrypt.hash(pw + PEPPER, 10);
  }

  // System admin
  const adminRes = ok(
    await users.createUser({
      username: 'admin', displayName: 'System Administrator',
      role: 'SYSTEM_ADMIN', unitId: brigadeId, unitCode: '14RR-BDE',
      serviceNumber: 'SYS-0001',
      passwordHash: await hash('Admin@1234'),
      createdByUserId: null
    }), 'admin-user'
  );
  const adminId = adminRes.user.id;
  log(`  ✓ admin / Admin@1234  (SYSTEM_ADMIN, id=${adminId})`);

  // Brigade commander
  const cmdRes = ok(
    await users.createUser({
      username: 'brig.sharma', displayName: 'Brigadier R.K. Sharma',
      role: 'COMMANDER', unitId: brigadeId, unitCode: '14RR-BDE',
      serviceNumber: 'IC-45678',
      passwordHash: await hash('Officer@1234'),
      createdByUserId: adminId
    }), 'brigade-cmd'
  );
  const cmdId = cmdRes.user.id;
  log(`  ✓ brig.sharma / Officer@1234  (COMMANDER, id=${cmdId})`);

  // Alpha battalion officer
  const alphaOfficerRes = ok(
    await users.createUser({
      username: 'lt.col.verma', displayName: 'Lt Col P.K. Verma',
      role: 'OFFICER', unitId: alphaBnId, unitCode: '1BN-ALPHA',
      serviceNumber: 'IC-56789',
      passwordHash: await hash('Officer@1234'),
      createdByUserId: adminId
    }), 'alpha-officer'
  );
  const alphaOfficerId = alphaOfficerRes.user.id;
  log(`  ✓ lt.col.verma / Officer@1234  (OFFICER, 1BN-ALPHA, id=${alphaOfficerId})`);

  // Beta battalion officer
  const betaOfficerRes = ok(
    await users.createUser({
      username: 'maj.singh', displayName: 'Major G.S. Singh',
      role: 'OFFICER', unitId: betaBnId, unitCode: '2BN-BETA',
      serviceNumber: 'IC-67890',
      passwordHash: await hash('Officer@1234'),
      createdByUserId: adminId
    }), 'beta-officer'
  );
  const betaOfficerId = betaOfficerRes.user.id;
  log(`  ✓ maj.singh / Officer@1234  (OFFICER, 2BN-BETA, id=${betaOfficerId})`);

  // Logistics NCO
  const ncoRes = ok(
    await users.createUser({
      username: 'hav.kumar', displayName: 'Havildar D. Kumar',
      role: 'NCO', unitId: alphaBnId, unitCode: '1BN-ALPHA',
      serviceNumber: 'JC-12345',
      passwordHash: await hash('Soldier@1234'),
      createdByUserId: adminId
    }), 'nco-user'
  );
  const ncoId = ncoRes.user.id;
  log(`  ✓ hav.kumar / Soldier@1234  (NCO, 1BN-ALPHA, id=${ncoId})`);

  // ── 3. RBAC wiring ────────────────────────────────────────────────────
  log('');
  log('▸ Wiring RBAC roles…');

  // Wire roles into RBAC — map user roles to rank levels
  // JAWAN=1, NCO=2, OFFICER=3, ADMIN=5
  const ROLE_TO_RANK = {
    SOLDIER: 1, NCO: 2, JCO: 2, LOGISTICS_OFFICER: 3,
    OFFICER: 3, SENIOR_OFFICER: 3, COMMANDER: 3, AUDITOR: 3, SYSTEM_ADMIN: 5
  };

  // Register users in RBAC
  const rbacUsers = [
    { id: adminId,       role: 'SYSTEM_ADMIN',  unitId: brigadeId, unitCode: '14RR-BDE' },
    { id: cmdId,         role: 'COMMANDER',     unitId: brigadeId, unitCode: '14RR-BDE' },
    { id: alphaOfficerId,role: 'OFFICER',       unitId: alphaBnId, unitCode: '1BN-ALPHA' },
    { id: betaOfficerId, role: 'OFFICER',       unitId: betaBnId,  unitCode: '2BN-BETA' },
    { id: ncoId,         role: 'NCO',           unitId: alphaBnId, unitCode: '1BN-ALPHA' },
  ];

  for (const u of rbacUsers) {
    const rankLevel = ROLE_TO_RANK[u.role] || 1;
    if (typeof rbac.addUserRole === 'function') {
      rbac.addUserRole(u.id, u.role, u.unitId, rankLevel);
    }
  }
  log(`  ✓ ${rbacUsers.length} users registered in RBAC`);

  // ── 4. Supply items ───────────────────────────────────────────────────
  log('');
  log('▸ Creating supply items…');

  const ITEMS = [
    // Alpha Battalion
    { itemCode: 'AMMO-7.62-A', itemName: '7.62mm Rifle Ammunition', category: 'AMMO',      unitId: alphaBnId, quantity: 50000, lowStockThreshold: 10000 },
    { itemCode: 'AMMO-40MM-A', itemName: '40mm Grenade (HE)',       category: 'AMMO',      unitId: alphaBnId, quantity: 800,   lowStockThreshold: 200 },
    { itemCode: 'RATION-A-14', itemName: 'Combat Ration Pack 14-Day',category: 'RATIONS',  unitId: alphaBnId, quantity: 1400,  lowStockThreshold: 500 },
    { itemCode: 'FUEL-AV-A',   itemName: 'Aviation Fuel JP-8 (L)',  category: 'FUEL',      unitId: alphaBnId, quantity: 25000, lowStockThreshold: 5000 },
    { itemCode: 'MED-FAID-A',  itemName: 'Field First Aid Kit',     category: 'MEDICAL',   unitId: alphaBnId, quantity: 120,   lowStockThreshold: 30 },
    { itemCode: 'MED-IV-A',    itemName: 'IV Fluid Saline 500ml',   category: 'MEDICAL',   unitId: alphaBnId, quantity: 80,    lowStockThreshold: 40 },
    { itemCode: 'COMMS-VHF-A', itemName: 'VHF Manpack Radio Set',   category: 'COMMS',     unitId: alphaBnId, quantity: 18,    lowStockThreshold: 5 },
    { itemCode: 'VEHI-TIRE-A', itemName: 'Truck Tyre 900R20',       category: 'VEHICLE_PARTS', unitId: alphaBnId, quantity: 24, lowStockThreshold: 8 },
    // Beta Battalion
    { itemCode: 'AMMO-7.62-B', itemName: '7.62mm Rifle Ammunition', category: 'AMMO',      unitId: betaBnId,  quantity: 8500,  lowStockThreshold: 10000 },
    { itemCode: 'RATION-B-14', itemName: 'Combat Ration Pack 14-Day',category: 'RATIONS',  unitId: betaBnId,  quantity: 350,   lowStockThreshold: 500 },
    { itemCode: 'FUEL-DIESEL-B',itemName: 'HSD Diesel (Litres)',    category: 'FUEL',      unitId: betaBnId,  quantity: 15000, lowStockThreshold: 3000 },
    { itemCode: 'ENG-WIRE-B',  itemName: 'Concertina Wire (Roll)',  category: 'ENGINEERING',unitId: betaBnId,  quantity: 45,    lowStockThreshold: 10 },
    { itemCode: 'CLO-VEST-B',  itemName: 'Ballistic Vest MK3',     category: 'CLOTHING',   unitId: betaBnId,  quantity: 220,   lowStockThreshold: 50 },
    // Gamma Battalion
    { itemCode: 'MED-MORPH-G', itemName: 'Morphine Autoinjector',  category: 'MEDICAL',   unitId: gammaBnId, quantity: 15,    lowStockThreshold: 20 },
    { itemCode: 'COMMS-SAT-G', itemName: 'Satellite Comm Terminal', category: 'COMMS',     unitId: gammaBnId, quantity: 4,     lowStockThreshold: 2 },
    { itemCode: 'GEN-TARP-G',  itemName: 'Waterproof Tarpaulin 6x4',category: 'GENERAL',  unitId: gammaBnId, quantity: 60,    lowStockThreshold: 15 },
    { itemCode: 'EQUIP-NVG-G', itemName: 'Night Vision Goggles',   category: 'EQUIPMENT', unitId: gammaBnId, quantity: 12,    lowStockThreshold: 4 },
    // Brigade level
    { itemCode: 'FUEL-PETROL-BDE',itemName: 'Petrol Unleaded (L)',  category: 'FUEL',      unitId: brigadeId, quantity: 30000, lowStockThreshold: 6000 },
    { itemCode: 'MED-SURG-BDE', itemName: 'Surgical Kit Advanced',  category: 'MEDICAL',   unitId: brigadeId, quantity: 8,     lowStockThreshold: 3 },
    { itemCode: 'EQUIP-GPS-BDE',itemName: 'GPS Navigation Unit',    category: 'EQUIPMENT', unitId: brigadeId, quantity: 10,    lowStockThreshold: 3 },
  ];

  // Ensure every unit created above (including ALPHA COMPANY, the last
  // one) has actually landed in SQL before items reference unit_id.
  await units.flushPendingWrites();

  const createdItems = [];
  for (const item of ITEMS) {
    const res = await supply.createItem({ ...item, createdByUserId: adminId });
    if (!res.success) {
      log(`  ⚠ Skipped ${item.itemCode}: ${res.message}`);
      continue;
    }
    createdItems.push(res.item);
  }
  log(`  ✓ ${createdItems.length} supply items created`);

  // Day 68: transfers.item_id is a hard FK to supply_items(id), and
  // _persistItem() is deliberately fire-and-forget (never blocks the
  // live request path). Creating a transfer before its item's SQL write
  // has landed is a real, observed race — confirmed against genuine
  // PostgreSQL (transfers_item_id_fkey violations on rapid bulk
  // seeding), not theoretical. The live per-request path is unaffected.
  await supply.flushPendingWrites();

  // Quick lookup by itemCode
  const byCode = {};
  createdItems.forEach(i => { byCode[i.itemCode] = i; });

  // ── 5. Transfers ──────────────────────────────────────────────────────
  log('');
  log('▸ Creating transfers…');

  const TRANSFERS = [
    // PENDING — awaiting officer approval
    {
      itemCode: 'AMMO-7.62-A', fromUnitId: alphaBnId, toUnitId: betaBnId,
      quantity: 5000, requestedByUserId: ncoId,
      notes: 'Beta Bn reports critical shortage ahead of exercise SHAKTI-26'
    },
    {
      itemCode: 'RATION-A-14', fromUnitId: alphaBnId, toUnitId: gammaBnId,
      quantity: 200, requestedByUserId: ncoId,
      notes: 'Gamma Bn forward party requires rations for 14-day field deployment'
    },
    {
      itemCode: 'FUEL-PETROL-BDE', fromUnitId: brigadeId, toUnitId: alphaBnId,
      quantity: 5000, requestedByUserId: alphaOfficerId,
      notes: 'Fuel drawdown for vehicle movement to Bikaner'
    },
    {
      itemCode: 'MED-FAID-A', fromUnitId: alphaBnId, toUnitId: alphaCoyId,
      quantity: 20, requestedByUserId: ncoId,
      notes: 'Forward company replenishment pre-patrol'
    },
  ];

  const APPROVED_TRANSFERS = [
    {
      itemCode: 'COMMS-VHF-A', fromUnitId: alphaBnId, toUnitId: betaBnId,
      quantity: 3, requestedByUserId: ncoId,
      notes: 'Approved comms backup for OP VIJAY tasking'
    },
    {
      itemCode: 'GEN-TARP-G', fromUnitId: gammaBnId, toUnitId: betaBnId,
      quantity: 15, requestedByUserId: betaOfficerId,
      notes: 'Shelter requirements for advance party'
    },
  ];

  const REJECTED_TRANSFERS = [
    {
      itemCode: 'EQUIP-NVG-G', fromUnitId: gammaBnId, toUnitId: alphaBnId,
      quantity: 8, requestedByUserId: alphaOfficerId,
      notes: 'Requested NVG for night patrol tasking'
    },
  ];

  let transferCount = 0;

  // Create pending transfers
  for (const t of TRANSFERS) {
    const item = byCode[t.itemCode];
    if (!item) { log(`  ⚠ Item not found: ${t.itemCode}`); continue; }
    const res = await supply.initiateTransfer({
      itemId: item.id, fromUnitId: t.fromUnitId, toUnitId: t.toUnitId,
      quantity: t.quantity, requestedByUserId: t.requestedByUserId, notes: t.notes
    });
    if (!res.success) { log(`  ⚠ Transfer failed: ${res.message}`); continue; }
    transferCount++;
  }

  // Create + approve
  for (const t of APPROVED_TRANSFERS) {
    const item = byCode[t.itemCode];
    if (!item) continue;
    const res = await supply.initiateTransfer({
      itemId: item.id, fromUnitId: t.fromUnitId, toUnitId: t.toUnitId,
      quantity: t.quantity, requestedByUserId: t.requestedByUserId, notes: t.notes
    });
    if (!res.success) continue;
    const transferId = res.transfer.id;
    // Approve
    const approveRes = await supply.approveTransfer(transferId, cmdId);
    if (approveRes.success) transferCount++;
  }

  // Create + reject
  for (const t of REJECTED_TRANSFERS) {
    const item = byCode[t.itemCode];
    if (!item) continue;
    const res = await supply.initiateTransfer({
      itemId: item.id, fromUnitId: t.fromUnitId, toUnitId: t.toUnitId,
      quantity: t.quantity, requestedByUserId: t.requestedByUserId, notes: t.notes
    });
    if (!res.success) continue;
    const transferId = res.transfer.id;
    const rejectRes = await supply.rejectTransfer(
      transferId, cmdId,
      'Insufficient operational justification — resubmit with CO endorsement'
    );
    if (rejectRes.success) transferCount++;
  }

  const pendingN  = TRANSFERS.length;
  const approvedN = APPROVED_TRANSFERS.length;
  const rejectedN = REJECTED_TRANSFERS.length;
  log(`  ✓ ${transferCount} transfers created (${pendingN} PENDING, ${approvedN} APPROVED, ${rejectedN} REJECTED)`);

  // ── 6. Movement Orders ────────────────────────────────────────────────
  log('');
  log('▸ Creating movement orders…');

  let movCount = 0;
  if (movement) {
    const MOVEMENTS = [
      {
        fromUnitId: brigadeId, toUnitId: alphaBnId, priority: 'PRIORITY',
        vehicleReg: 'DL 1C 2345', route: 'Delhi Cantt → Meerut via NH-58',
        notes: 'Monthly rations replenishment', createdByUserId: cmdId,
        items: [{ itemId: byCode['RATION-A-14']?.id || 3, quantity: 200 }]
      },
      {
        fromUnitId: alphaBnId, toUnitId: betaBnId, priority: 'IMMEDIATE',
        vehicleReg: 'UP 15 AB 1234', route: 'Meerut → Delhi via NH-9',
        notes: 'Ammo transfer post-approval', createdByUserId: alphaOfficerId,
        items: [{ itemId: byCode['AMMO-7.62-A']?.id || 1, quantity: 5000 }]
      },
      {
        fromUnitId: brigadeId, toUnitId: gammaBnId, priority: 'EMERGENCY',
        vehicleReg: 'RJ 14 C 9876', route: 'Delhi → Jaipur via NH-48',
        notes: 'Emergency medical resupply — forward deployment',
        createdByUserId: cmdId,
        items: [{ itemId: byCode['MED-FAID-A']?.id || 5, quantity: 30 }]
      },
      {
        fromUnitId: betaBnId, toUnitId: alphaCoyId, priority: 'ROUTINE',
        vehicleReg: 'DL 2D 4567', route: 'Meerut Cantt → Delhi Cantt',
        notes: 'Engineering stores routine transfer',
        createdByUserId: betaOfficerId,
        items: [{ itemId: byCode['ENG-WIRE-B']?.id || 12, quantity: 10 }]
      },
    ];

    for (const m of MOVEMENTS) {
      const items = m.items.filter(i => i.itemId);
      if (!items.length) continue;
      const res = await movement.createOrder({ ...m, items });
      if (!res.success) { log(`  ⚠ Movement create failed: ${res.message}`); continue; }
      movCount++;
      // Dispatch the IMMEDIATE + EMERGENCY orders to show IN_TRANSIT
      if (m.priority === 'IMMEDIATE' || m.priority === 'EMERGENCY') {
        await movement.dispatch(res.order.id, cmdId).catch(() => {});
      }
    }
    log(`  ✓ ${movCount} movement orders created (1 dispatched, 1 in-transit)`);
  } else {
    log('  ⚠ Movement service not available — skipping');
  }

  // ── 7. Inventory sessions ─────────────────────────────────────────────
  log('');
  log('▸ Creating inventory sessions…');

  let invCount = 0;
  if (inventory) {
    // Open session for Alpha Battalion
    const sess1 = await inventory.createSession({
      unitId: alphaBnId, notes: 'Quarterly stock-take Q1', createdByUserId: ncoId
    });
    if (sess1.success) {
      invCount++;
      // Record a few counts — ammo shows discrepancy
      await inventory.recordCount(sess1.session.id, byCode['AMMO-7.62-A']?.id || 1, 48500, ncoId, 'Expended in range practice').catch(() => {});
      await inventory.recordCount(sess1.session.id, byCode['RATION-A-14']?.id || 3, 1400, ncoId, 'Matches ledger').catch(() => {});
    }
    // Reconciled session for Beta Battalion
    const sess2 = await inventory.createSession({
      unitId: betaBnId, notes: 'Pre-exercise inventory', createdByUserId: betaOfficerId
    });
    if (sess2.success) {
      invCount++;
      await inventory.recordCount(sess2.session.id, byCode['AMMO-7.62-B']?.id || 9, 8500, betaOfficerId, 'Verified').catch(() => {});
      await inventory.finalizeSession(sess2.session.id, betaOfficerId).catch(() => {});
    }
    log(`  ✓ ${invCount} inventory sessions created`);
  } else {
    log('  ⚠ Inventory service not available — skipping');
  }

  // ── 8. Alert scan ─────────────────────────────────────────────────────
  log('');
  log('▸ Running alert scan…');

  if (services.alerts) {
    try {
      const allUnitIds = units.getUnitIds();
      const scanResult = await services.alerts.scan(allUnitIds);
      log(`  ✓ Alert scan: ${scanResult.raised} raised, ${scanResult.escalated} escalated`);
    } catch (e) {
      log(`  ⚠ Alert scan failed (non-fatal): ${e.message}`);
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────
  log('');
  log('════════════════════════════════════════════════');
  log('  Demo data seeded successfully!');
  log('');
  log('  LOGIN CREDENTIALS:');
  log('    admin         / Admin@1234     (SYSTEM_ADMIN)');
  log('    brig.sharma   / Officer@1234   (COMMANDER — full scope)');
  log('    lt.col.verma  / Officer@1234   (OFFICER  — Alpha Bn)');
  log('    maj.singh     / Officer@1234   (OFFICER  — Beta Bn)');
  log('    hav.kumar     / Soldier@1234   (NCO      — Alpha Bn)');
  log('════════════════════════════════════════════════');
  log('');

  return {
    unitIds: { brigadeId, alphaBnId, betaBnId, gammaBnId, alphaCoyId },
    userIds: { adminId, cmdId, alphaOfficerId, betaOfficerId, ncoId },
    itemCount: createdItems.length,
    transferCount,
    movementCount: movCount,
    inventoryCount: invCount,
    services
  };
}

// ── Build fresh service instances (standalone run) ────────────────────────

function buildServices() {
  const audit = new AuditLogService();
  const rbac  = new RBACService(null);
  const auth  = new AuthService(null, audit);
  const notifications = new NotificationService(null, rbac, audit);
  const units    = new UnitManagementService(null, audit, rbac);
  const users    = new UserManagementService(null, audit, rbac);
  const supply   = new SupplyChainService(null, rbac, notifications, audit);
  const movement  = new MovementOrderService(null, audit);
  const inventory = new InventoryLedgerService(null, supply, audit, notifications);

  const alerts = new AlertEscalationService(
    { supply, inventory, movement, auditLog: audit },
    {},
    notifications
  );

  return { audit, rbac, auth, notifications, units, users, supply, movement, inventory, alerts };
}

// ── CLI entry point ───────────────────────────────────────────────────────

if (require.main === module) {
  seedDemoData()
    .then(result => {
      console.log(`\nDone — ${result.itemCount} items, ${result.transferCount} transfers, ${result.movementCount} orders, ${result.inventoryCount} stock-take sessions.\n`);
      process.exit(0);
    })
    .catch(err => {
      console.error('\n✗ Seeder crashed:', err.message);
      console.error(err.stack);
      process.exit(1);
    });
}

module.exports = { seedDemoData, buildServices };
