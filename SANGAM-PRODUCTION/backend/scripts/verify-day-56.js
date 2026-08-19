'use strict';

/**
 * Day 56 Verification — Compliance API Contract (backing CompliancePage.jsx)
 *
 * ComplianceService and its 5 routes (/api/compliance/*) have existed since
 * Day 20 with their own test coverage — this script does NOT re-test
 * ComplianceService's internal business logic. It verifies the exact HTTP
 * contract the new Day 56 frontend depends on:
 *   - response shapes for all 5 endpoints + their CSV variants
 *   - the non-monotonic reports:advanced permission boundary
 *     (LOGISTICS_OFFICER rank 6 HAS it, OFFICER rank 7 does NOT, despite
 *     OFFICER outranking LOGISTICS_OFFICER) — this is the exact reason
 *     CompliancePage cannot gate by rankLevel alone and instead handles
 *     each tab's 403 independently
 *   - the audit:export / reports:advanced split (LOGISTICS_OFFICER has
 *     the latter but not the former) that makes Audit Export a
 *     separately-gated tab
 *   - AUDITOR's access to audit-export, since AuditLogPage is hard-gated
 *     to SYSTEM_ADMIN and this is otherwise AUDITOR's only UI path to
 *     audit data
 */

const jwt  = require('jsonwebtoken');
const http = require('http');
const createApp = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 9001, username: 'test.actor', role: 'SYSTEM_ADMIN',
    unitId: 1, unitCode: 'TST', ...overrides
  }, JWT_SECRET, { expiresIn: '1h' });
}

function request(port, method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ port, path: urlPath, method,
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* CSV bodies aren't JSON */ }
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  const app = createApp(null, {}, { logLevel: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // ── Fixtures ──────────────────────────────────────────────────
    const unitA = (await app.locals.services.units.createUnit({
      unitName: 'D56 Alpha Company', unitType: 'COMPANY', unitCode: 'D56-A'
    })).unit;
    const unitB = (await app.locals.services.units.createUnit({
      unitName: 'D56 Bravo Company', unitType: 'COMPANY', unitCode: 'D56-B'
    })).unit;

    const adminAtA = makeToken({ unitId: unitA.id, unitCode: unitA.unitCode });

    const itemRes = await request(port, 'POST', '/api/supply/items', adminAtA, {
      itemCode: 'D56-ITEM', itemName: 'Test Compliance Item', category: 'EQUIPMENT',
      unitId: unitA.id, quantity: 100, lowStockThreshold: 10
    });
    check('fixture: item created (201)', itemRes.status === 201 && itemRes.json?.item?.id, JSON.stringify(itemRes.json));
    const itemId = itemRes.json.item.id;

    const xferRes = await request(port, 'POST', '/api/supply/transfers', adminAtA, {
      itemId, fromUnitId: unitA.id, toUnitId: unitB.id, quantity: 30, notes: 'D56 test transfer'
    });
    check('fixture: transfer initiated (201)', xferRes.status === 201 && xferRes.json?.transfer?.id, JSON.stringify(xferRes.json));
    const transferId = xferRes.json.transfer.id;

    const approveRes = await request(port, 'POST', `/api/supply/transfers/${transferId}/approve`, adminAtA);
    check('fixture: transfer approved (200, status COMPLETED)',
      approveRes.status === 200 && approveRes.json?.transfer?.status === 'COMPLETED', JSON.stringify(approveRes.json));

    // ── A. Chain of Custody ───────────────────────────────────────
    console.log('\n📜 Group A: Chain of Custody');
    {
      const r = await request(port, 'GET', `/api/compliance/chain-of-custody/${itemId}`, adminAtA);
      check('A-01 200 + success:true', r.status === 200 && r.json?.success === true, JSON.stringify(r.json));
      check('A-02 item echoed correctly', r.json?.item?.itemCode === 'D56-ITEM');
      check('A-03 eventCount matches events.length', r.json?.eventCount === r.json?.events?.length);
      check('A-04 includes SUPPLY_CREATE event', r.json?.events?.some(e => e.action === 'SUPPLY_CREATE'));
      check('A-05 includes SUPPLY_TRANSFER_INITIATE event', r.json?.events?.some(e => e.action === 'SUPPLY_TRANSFER_INITIATE'));
      check('A-06 includes SUPPLY_TRANSFER_APPROVE event', r.json?.events?.some(e => e.action === 'SUPPLY_TRANSFER_APPROVE'));
      check('A-07 events chronologically ordered', r.json?.events?.every((e, i, arr) =>
        i === 0 || new Date(arr[i - 1].timestamp) <= new Date(e.timestamp)));
    }
    {
      const r = await request(port, 'GET', '/api/compliance/chain-of-custody/999999', adminAtA);
      check('A-08 nonexistent item → 404 ITEM_NOT_FOUND', r.status === 404 && r.json?.error === 'ITEM_NOT_FOUND');
    }
    {
      const outOfScope = makeToken({ userId: 9002, unitId: unitB.id, unitCode: unitB.unitCode, role: 'SENIOR_OFFICER' });
      const r = await request(port, 'GET', `/api/compliance/chain-of-custody/${itemId}`, outOfScope);
      check('A-09 item in unitA, caller scoped to unitB only → 403 UNIT_OUT_OF_SCOPE',
        r.status === 403 && r.json?.error === 'UNIT_OUT_OF_SCOPE', `got ${r.status}: ${JSON.stringify(r.json)}`);
    }
    {
      const r = await request(port, 'GET', `/api/compliance/chain-of-custody/${itemId}?format=csv`, adminAtA);
      check('A-10 CSV export → text/csv content-type', r.status === 200 && (r.headers['content-type'] || '').includes('text/csv'));
      check('A-11 CSV header row matches documented columns', r.raw.startsWith('timestamp,action,actorId,resource,resourceId,success,severity'),
        `got: ${r.raw.slice(0, 80)}`);
    }

    // ── B. Non-monotonic reports:advanced boundary ────────────────
    console.log('\n🔐 Group B: reports:advanced is NOT a clean rank cutoff');
    {
      // LOGISTICS_OFFICER = rank 6, HAS reports:advanced
      const logOfficer = makeToken({ userId: 9003, unitId: unitA.id, unitCode: unitA.unitCode, role: 'LOGISTICS_OFFICER' });
      const r = await request(port, 'GET', `/api/compliance/chain-of-custody/${itemId}`, logOfficer);
      check('B-01 LOGISTICS_OFFICER (rank 6) → 200 on chain-of-custody', r.status === 200, `got ${r.status}: ${JSON.stringify(r.json)}`);
    }
    {
      // OFFICER = rank 7, outranks LOGISTICS_OFFICER, but LACKS reports:advanced
      const officer = makeToken({ userId: 9004, unitId: unitA.id, unitCode: unitA.unitCode, role: 'OFFICER' });
      const r = await request(port, 'GET', `/api/compliance/chain-of-custody/${itemId}`, officer);
      check('B-02 OFFICER (rank 7, outranks LOGISTICS_OFFICER) → 403 on chain-of-custody (lacks reports:advanced)',
        r.status === 403, `got ${r.status}: ${JSON.stringify(r.json)}`);
    }
    {
      const officer = makeToken({ userId: 9004, unitId: unitA.id, unitCode: unitA.unitCode, role: 'OFFICER' });
      const r = await request(port, 'GET', '/api/compliance/transfer-register', officer);
      check('B-03 OFFICER still has reports:read → 200 on transfer-register', r.status === 200, `got ${r.status}`);
    }
    {
      const soldier = makeToken({ userId: 9005, unitId: unitA.id, unitCode: unitA.unitCode, role: 'SOLDIER' });
      const r = await request(port, 'GET', '/api/compliance/discrepancy-report', soldier);
      check('B-04 SOLDIER → 403 on discrepancy-report', r.status === 403);
    }

    // ── C. Discrepancy Report ──────────────────────────────────────
    console.log('\n🔍 Group C: Discrepancy Report');
    {
      const r = await request(port, 'GET', '/api/compliance/discrepancy-report', adminAtA);
      check('C-01 200 + success:true', r.status === 200 && r.json?.success === true);
      check('C-02 shape has discrepancies/cleanItems/totalItems/discrepancyCount',
        Array.isArray(r.json?.discrepancies) && Array.isArray(r.json?.cleanItems) &&
        typeof r.json?.totalItems === 'number' && typeof r.json?.discrepancyCount === 'number');
      check('C-03 a properly-approved transfer (via real API) produces zero discrepancy for the item',
        !r.json.discrepancies.some(d => d.itemId === itemId), JSON.stringify(r.json.discrepancies));
    }

    // ── D. Transfer Register ────────────────────────────────────────
    console.log('\n📋 Group D: Transfer Register');
    {
      const r = await request(port, 'GET', '/api/compliance/transfer-register', adminAtA);
      check('D-01 200 + success:true', r.status === 200 && r.json?.success === true);
      const found = r.json?.transfers?.find(t => t.transferId === transferId);
      check('D-02 our transfer appears in the register', !!found, JSON.stringify(r.json?.transfers));
      check('D-03 auditVerified true after a real HTTP approval', found?.auditVerified === true);
      check('D-04 approvedByUserId is populated correctly', found?.approvedByUserId === 9001);
    }
    {
      const r = await request(port, 'GET', '/api/compliance/transfer-register?status=PENDING', adminAtA);
      check('D-05 status filter excludes our (now COMPLETED) transfer',
        !r.json?.transfers?.some(t => t.transferId === transferId));
    }
    {
      const r = await request(port, 'GET', '/api/compliance/transfer-register?format=csv', adminAtA);
      check('D-06 CSV export → text/csv content-type', r.status === 200 && (r.headers['content-type'] || '').includes('text/csv'));
      check('D-07 CSV header matches documented columns',
        r.raw.startsWith('transferId,itemCode,itemName,fromUnitId,toUnitId'), `got: ${r.raw.slice(0, 80)}`);
    }

    // ── E. Audit Export (the AUDITOR role's only route to audit data) ──
    console.log('\n🗂️  Group E: Audit Export');
    {
      const r = await request(port, 'GET', '/api/compliance/audit-export', adminAtA);
      check('E-01 200 + success:true', r.status === 200 && r.json?.success === true);
      check('E-02 entries include our SUPPLY_CREATE action', r.json?.entries?.some(e => e.action === 'SUPPLY_CREATE'));
    }
    {
      const auditor = makeToken({ userId: 9006, unitId: unitA.id, unitCode: unitA.unitCode, role: 'AUDITOR' });
      const r = await request(port, 'GET', '/api/compliance/audit-export', auditor);
      check('E-03 AUDITOR → 200 on audit-export (their only UI path to audit data)', r.status === 200, `got ${r.status}`);
    }
    {
      // LOGISTICS_OFFICER has reports:advanced but NOT audit:export — the
      // split that makes this a separately-gated tab rather than bundled
      // with Summary/Custody/Discrepancy.
      const logOfficer = makeToken({ userId: 9007, unitId: unitA.id, unitCode: unitA.unitCode, role: 'LOGISTICS_OFFICER' });
      const r = await request(port, 'GET', '/api/compliance/audit-export', logOfficer);
      check('E-04 LOGISTICS_OFFICER (has reports:advanced) → 403 on audit-export (lacks audit:export)',
        r.status === 403, `got ${r.status}`);
    }
    {
      const r = await request(port, 'GET', '/api/compliance/audit-export?format=csv', adminAtA);
      check('E-05 CSV export → text/csv content-type', r.status === 200 && (r.headers['content-type'] || '').includes('text/csv'));
      check('E-06 CSV header matches documented columns',
        r.raw.startsWith('id,timestamp,userId,action,resource,resourceId'), `got: ${r.raw.slice(0, 80)}`);
    }

    // ── F. Compliance Summary ───────────────────────────────────────
    console.log('\n📊 Group F: Compliance Summary');
    {
      const r = await request(port, 'GET', '/api/compliance/summary', adminAtA);
      check('F-01 200 + success:true', r.status === 200 && r.json?.success === true);
      const s = r.json?.summary;
      check('F-02 shape has transfers/inventory/blockchain/audit sections',
        !!(s && s.transfers && s.inventory && s.blockchain && s.audit), JSON.stringify(s));
      check('F-03 transfers.completed reflects our approved transfer', s?.transfers?.completed >= 1);
      check('F-04 blockchain.chainVerified is true (no tampering in this run)', s?.blockchain?.chainVerified === true);
    }
    {
      const soldier = makeToken({ userId: 9008, unitId: unitA.id, unitCode: unitA.unitCode, role: 'SOLDIER' });
      const r = await request(port, 'GET', '/api/compliance/summary', soldier);
      check('F-05 SOLDIER → 403 on summary (lacks reports:advanced)', r.status === 403);
    }

    // ── G. 401 handling (no token) ───────────────────────────────────
    console.log('\n🔒 Group G: Unauthenticated requests');
    {
      const r = await request(port, 'GET', '/api/compliance/summary', 'not-a-valid-token');
      check('G-01 invalid token → 401', r.status === 401, `got ${r.status}`);
    }

  } finally {
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 56 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
