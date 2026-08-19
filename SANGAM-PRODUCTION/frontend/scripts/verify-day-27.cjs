'use strict';

/**
 * Day 27 Verification — Frontend Component Smoke Test
 *
 * Since there's no browser available in this environment, this script
 * uses esbuild to transpile each presentational component's JSX on the
 * fly, then renders it with react-dom/server (renderToStaticMarkup)
 * against mock data shaped EXACTLY like the real backend responses
 * (captured from live end-to-end testing of the Day 26 dashboard API
 * and Day 14 auth API — see backend/scripts/verify-scope-contract.js
 * and the manual e2e checks performed during this session).
 *
 * This catches real React runtime bugs (undefined property access,
 * missing keys, broken prop contracts) that `vite build` alone does
 * not catch, since `vite build` only validates syntax/transforms, not
 * runtime behavior against realistic data.
 *
 * NOT covered by this script (would require a real browser + backend):
 *   - useEffect-driven data fetching timing (App.jsx, DashboardPage.jsx)
 *   - Click handlers / form submission DOM events
 *   - CSS rendering / visual layout
 * These were instead verified by: (1) careful manual cross-reference of
 * api/client.js against the real auth.service.js and dashboard.service.js
 * response shapes, and (2) the existing backend e2e smoke tests.
 */

const path   = require('path');
const esbuild = require('esbuild');
const React  = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

/** Transpile a .jsx file to CJS and require it fresh (no caching across calls). */
function loadComponent(relativePath) {
  const fullPath = path.join(__dirname, '..', 'src', relativePath);
  const result = esbuild.buildSync({
    entryPoints: [fullPath],
    bundle: false,
    write: false,
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.jsx': 'jsx' },
    platform: 'node'
  });
  const code = result.outputFiles[0].text;

  const Module = require('module');
  const m = new Module(fullPath, module);
  m.filename = fullPath;
  m.paths = Module._nodeModulePaths(path.dirname(fullPath));
  m._compile(code, fullPath);
  return m.exports.default || m.exports;
}

function html(component, props) {
  return renderToStaticMarkup(React.createElement(component, props));
}

function run() {
  console.log('\n🖥️  Day 27 Frontend Component Smoke Test\n');

  // ── Widget.jsx ──────────────────────────────────────────────────
  console.log('📦 Widget component');

  const Widget = loadComponent('components/Widget.jsx');

  test('Widget renders headline and unit label', () => {
    const out = html(Widget, { code: 'UNT', headline: 4, unit: 'UNITS', available: true });
    if (!out.includes('UNT')) throw new Error('missing code');
    if (!out.includes('4')) throw new Error('missing headline');
    if (!out.includes('UNITS')) throw new Error('missing unit label');
  });

  test('Widget renders breakdown chips', () => {
    const out = html(Widget, {
      code: 'PER', headline: 38, available: true,
      breakdown: { SOLDIER: 20, NCO: 10, OFFICER: 8 }
    });
    if (!out.includes('SOLDIER')) throw new Error('missing breakdown chip');
    if (!out.includes('20')) throw new Error('missing breakdown count');
  });

  test('Widget renders unavailable state without crashing', () => {
    const out = html(Widget, { code: 'SUP', available: false });
    if (!out.includes('unavailable')) throw new Error('missing unavailable message');
  });

  test('Widget renders with zero headline value (falsy but valid)', () => {
    const out = html(Widget, { code: 'TRF', headline: 0, available: true });
    if (!out.includes('TRF')) throw new Error('failed to render with headline=0');
  });

  test('Widget renders with no breakdown prop (undefined)', () => {
    const out = html(Widget, { code: 'MOV', headline: 2, available: true });
    if (!out.includes('MOV')) throw new Error('crashed without breakdown prop');
  });

  // ── BlockchainSeal.jsx ──────────────────────────────────────────
  console.log('\n⛓️  BlockchainSeal component');

  const BlockchainSeal = loadComponent('components/BlockchainSeal.jsx');

  test('BlockchainSeal renders VERIFIED state', () => {
    const out = html(BlockchainSeal, {
      data: { available: true, verified: true, blockCount: 211, tamperCount: 0 }
    });
    if (!out.includes('VERIFIED')) throw new Error('missing VERIFIED text');
    if (!out.includes('211')) throw new Error('missing block count');
    if (out.includes('tampered')) throw new Error('should not have tampered class when verified');
  });

  test('BlockchainSeal renders TAMPER state with critical styling', () => {
    const out = html(BlockchainSeal, {
      data: { available: true, verified: false, blockCount: 50, tamperCount: 2 }
    });
    if (!out.includes('TAMPER')) throw new Error('missing TAMPER text');
    if (!out.includes('tampered')) throw new Error('missing tampered CSS class');
    if (!out.includes('2')) throw new Error('missing tamper count');
  });

  test('BlockchainSeal renders unavailable state', () => {
    const out = html(BlockchainSeal, { data: { available: false } });
    if (!out.includes('unavailable')) throw new Error('missing unavailable message');
  });

  test('BlockchainSeal handles undefined data prop without crashing', () => {
    const out = html(BlockchainSeal, {});
    if (!out.includes('unavailable')) throw new Error('did not gracefully handle missing data');
  });

  // ── ActivityFeed.jsx ────────────────────────────────────────────
  console.log('\n📜 ActivityFeed component');

  const ActivityFeed = loadComponent('components/ActivityFeed.jsx');

  test('ActivityFeed renders entries with action and resource', () => {
    const out = html(ActivityFeed, {
      entries: [
        { timestamp: '2026-06-20T14:31:00.000Z', action: 'SUPPLY_TRANSFER_APPROVE', resource: 'transfers', severity: 'INFO' },
        { timestamp: '2026-06-20T14:28:00.000Z', action: 'MOVEMENT_ORDER_DISPATCH', resource: 'movement_orders', severity: 'INFO' }
      ]
    });
    if (!out.includes('SUPPLY_TRANSFER_APPROVE')) throw new Error('missing action text');
    if (!out.includes('transfers')) throw new Error('missing resource text');
  });

  test('ActivityFeed renders empty state', () => {
    const out = html(ActivityFeed, { entries: [] });
    if (!out.includes('No recent activity')) throw new Error('missing empty state message');
  });

  test('ActivityFeed renders with no entries prop (default)', () => {
    const out = html(ActivityFeed, {});
    if (!out.includes('No recent activity')) throw new Error('crashed without entries prop');
  });

  test('ActivityFeed handles malformed timestamp gracefully', () => {
    const out = html(ActivityFeed, {
      entries: [{ timestamp: 'not-a-date', action: 'TEST', resource: 'test', severity: 'INFO' }]
    });
    if (!out.includes('--:--')) throw new Error('did not fall back for invalid timestamp');
  });

  // ── TopBar.jsx — REMOVED Day 70 ──────────────────────────────────
  // TopBar.jsx no longer exists; its wordmark/user-info/logout
  // functionality was absorbed into Sidebar.jsx (see that file's Day 32
  // header comment). This test file was never wired into the automated
  // test:all suite, so this went unnoticed and broke the ENTIRE file
  // (esbuild fails the whole run on an unresolvable import) since
  // whichever day actually did that refactor. Fixed Day 70 by removing
  // the dead reference so the rest of this file's real, useful coverage
  // (Widget, BlockchainSeal, ActivityFeed, LoginPage, the dashboard
  // data-shape contract check below) runs again, and by wiring
  // `npm run test:frontend` into the root test:all script so this
  // can't silently go stale again. NOT done today: a proper Sidebar.jsx
  // smoke test — it needs a Router context wrapper (NavLink/useLocation)
  // and bundles two further local components (DemoBanner, Notification-
  // Bell), which is more surface area than is proportionate for this
  // pass. Carried forward as a real, identified opportunity rather than
  // rushed into something fragile.

  // ── LoginPage.jsx ───────────────────────────────────────────────
  console.log('\n🔐 LoginPage component');

  const LoginPage = loadComponent('pages/LoginPage.jsx');

  test('LoginPage renders wordmark, subtitle, and form fields', () => {
    const out = html(LoginPage, { onLoginSuccess: () => {} });
    if (!out.includes('SANGAM')) throw new Error('missing wordmark');
    if (!out.includes('Supply Chain Command System')) throw new Error('missing subtitle');
    if (!out.includes('Service Username')) throw new Error('missing username label');
    if (!out.includes('Password')) throw new Error('missing password label');
  });

  test('LoginPage submit button renders with correct default label', () => {
    const out = html(LoginPage, { onLoginSuccess: () => {} });
    if (!out.includes('AUTHENTICATE')) throw new Error('missing submit button label');
  });

  // ── Full Dashboard data shape compatibility check ────────────────
  console.log('\n🧩 Full dashboard data shape (matches real Day 26 API contract)');

  test('All widget props accept the exact Day 26 dashboard.service.js response shape', () => {
    // This mirrors the EXACT shape returned by DashboardService.getSummary(),
    // captured from the live e2e test run during this session.
    const mockApiResponse = {
      success: true,
      generatedAt: '2026-06-20T14:32:08.000Z',
      scope: { unitId: 10, scopeSize: 2 },
      units:      { available: true, total: 4, active: 4, inactive: 0, byType: { COMPANY: 4 } },
      personnel:  { available: true, total: 38, active: 36, inactive: 2, locked: 0, byRole: { SOLDIER: 30, NCO: 6, JCO: 2 } },
      supply:     { available: true, totalItems: 142, lowStockCount: 6, lowStockItems: [], byCategory: { AMMO: 50, FUEL: 30 } },
      transfers:  { available: true, total: 20, pending: 3, completed: 15, rejected: 2, completedToday: 8, approvalRate: '94%' },
      movement:   { available: true, activeOrders: 2, planned: 1, dispatched: 0, inTransit: 1, delivered: 5, emergencyCount: 0 },
      blockchain: { available: true, verified: true, blockCount: 211, tamperCount: 0 },
      stocktake:  { available: true, activeSessions: 1, openDiscrepancies: 2 },
      recentActivity: [
        { timestamp: '2026-06-20T14:31:00.000Z', action: 'SUPPLY_TRANSFER_APPROVE', resource: 'transfers', severity: 'INFO' }
      ],
      cached: false
    };

    // Render every section through the actual components, exactly as
    // DashboardPage.jsx does, to confirm no prop-shape mismatch exists.
    html(Widget, {
      code: 'UNT', headline: mockApiResponse.units.total, unit: 'UNITS',
      available: mockApiResponse.units.available, breakdown: mockApiResponse.units.byType
    });
    html(Widget, {
      code: 'PER', headline: mockApiResponse.personnel.total, unit: 'PERSONNEL',
      available: mockApiResponse.personnel.available, breakdown: mockApiResponse.personnel.byRole
    });
    html(Widget, {
      code: 'SUP', headline: mockApiResponse.supply.totalItems, unit: 'ITEMS',
      available: mockApiResponse.supply.available, breakdown: mockApiResponse.supply.byCategory
    });
    html(BlockchainSeal, { data: mockApiResponse.blockchain });
    html(Widget, {
      code: 'TRF', headline: mockApiResponse.transfers.pending, unit: 'PENDING',
      available: mockApiResponse.transfers.available
    });
    html(Widget, {
      code: 'MOV', headline: mockApiResponse.movement.activeOrders, unit: 'ACTIVE ORDERS',
      available: mockApiResponse.movement.available
    });
    html(Widget, {
      code: 'STK', headline: mockApiResponse.stocktake.activeSessions, unit: 'SESSIONS',
      available: mockApiResponse.stocktake.available
    });
    html(ActivityFeed, { entries: mockApiResponse.recentActivity });
    // If we reach here without throwing, every component accepted the
    // real backend's response shape without a prop mismatch.
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 27 Frontend Smoke Test Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run();
