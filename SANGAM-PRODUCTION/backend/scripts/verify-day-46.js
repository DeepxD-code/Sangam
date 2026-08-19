'use strict';

/**
 * Day 46 Verification — CRITICAL FIX: Actor Attribution Audit Sweep
 *
 * Day 46 was repurposed from the original roadmap (Unit detail page,
 * now Day 47) to fix a severe, systemic bug found while starting that
 * page's backend work: `req.user.authenticate()` builds req.user via
 * RBACService.buildUserContext(), which only ever sets `.userId` — never
 * `.id`. Seven route files were calling `req.user.id` (36 call sites),
 * silently passing `undefined`/`null` as the acting user into services
 * that log actor attribution. In a system whose core value proposition to
 * Army stakeholders is a tamper-evident, accountable audit trail, this
 * meant almost every mutating action (unit admin, item updates, transfer
 * approvals, stocktake sessions, bulk ops, user admin, movement dispatch)
 * was being logged with no attributable actor.
 *
 * Two related bugs were found and fixed in the same sweep:
 *   - DashboardService.getSummary() keyed its cache on `userContext.id`
 *     (also always undefined), so clearCache(userId) could never match a
 *     real key and per-user refresh silently fell back to wiping every
 *     user's cached dashboard.
 *   - SupplyChainService.createItem() accepted no actor parameter at all
 *     (unlike every sibling create-method in the codebase), so item
 *     creation was never attributable even before this sweep.
 *
 * This script is a fast, static, permanent guard: it re-scans every route
 * file for the exact bug pattern so a future change can't reintroduce it
 * without test:all catching it immediately, before even booting the app.
 * The full, real HTTP-integration proof (real JWT, real middleware, real
 * audit event stream, real dashboard cache) lives in the dedicated
 * companion file verify-actor-attribution-contract.js — run separately
 * (it also has its own npm script: test:actor-attribution-contract) and
 * wired as its own step in test:all, the same way verify-scope-contract.js
 * already is. Run both after any change to req.user handling.
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

const ROUTES_DIR = path.join(__dirname, '../src/routes');
const SWEPT_FILES = [
  'inventory.routes.js', 'supply.routes.js', 'unit.routes.js',
  'bulk.routes.js', 'user.routes.js', 'movement.routes.js', 'dashboard.routes.js'
];

console.log('\n🔎 Group A: Static guard — no bare req.user.id remains in route files');
for (const file of SWEPT_FILES) {
  const full = path.join(ROUTES_DIR, file);
  const src  = fs.readFileSync(full, 'utf8');
  // Strip every correct req.user.userId occurrence first so the bare-.id
  // regex below can't accidentally match inside it, then count what's left.
  const withoutCorrectUsage = src.replace(/req\.user\.userId/g, '');
  const bareCount = (withoutCorrectUsage.match(/req\.user\.id\b(?!\w)/g) || []).length;
  check(`${file}: zero bare req.user.id occurrences`, bareCount === 0,
    `found ${bareCount}`);
}

console.log('\n🔎 Group B: userContext.id (dashboard cache key bug pattern) guard');
{
  const dashSvc = fs.readFileSync(
    path.join(__dirname, '../src/services/dashboard.service.js'), 'utf8');
  const stripped = dashSvc.replace(/userContext\.userId/g, '');
  const bareCount = (stripped.match(/userContext\.id\b(?!\w)/g) || []).length;
  check('dashboard.service.js: zero bare userContext.id occurrences', bareCount === 0,
    `found ${bareCount}`);
}

console.log('\n🔎 Group C: verify-day-26.js fixtures use the real UserContext shape');
{
  const day26 = fs.readFileSync(path.join(__dirname, 'verify-day-26.js'), 'utf8');
  const staleFixtures = (day26.match(/\{\s*id:\s*\d+/g) || []);
  check('verify-day-26.js: no stale { id: N } userContext fixtures remain',
    staleFixtures.length === 0, `found: ${JSON.stringify(staleFixtures)}`);
}

console.log('\n🔎 Group D: createItem threads and logs its actor');
{
  const supplySvc = fs.readFileSync(
    path.join(__dirname, '../src/services/supply-chain.service.js'), 'utf8');
  const start = supplySvc.indexOf('async createItem');
  // Slice to the start of the next method (not a fixed character count) so
  // this scales naturally as createItem legitimately grows — e.g. Day 54
  // added quantity/threshold validation earlier in the same method.
  const nextMethodMatch = supplySvc.slice(start + 20).match(/\n {2}(?:async )?[a-zA-Z_]+\s*\(/);
  const end = nextMethodMatch ? start + 20 + nextMethodMatch.index : supplySvc.length;
  const createItemBlock = supplySvc.slice(start, end);
  check('createItem destructures createdByUserId',
    /createdByUserId\s*=\s*null/.test(createItemBlock));
  check('createItem logs userId on SUPPLY_CREATE',
    /userId:\s*createdByUserId/.test(createItemBlock));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Day 46 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
