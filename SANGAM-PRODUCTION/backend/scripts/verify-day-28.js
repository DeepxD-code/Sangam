'use strict';

/**
 * Day 28 Verification — Production Static Frontend Serving
 *
 * Tests the conditional static-serving block added to app.js:
 *   - If frontend/dist/index.html exists, the app serves it + falls
 *     back to it for any non-/api/ GET request (SPA routing support).
 *   - If frontend/dist/index.html does NOT exist, the app behaves
 *     identically to every prior day — pure JSON API, zero side effects.
 *   - /api/* paths NEVER fall through to the SPA shell, even when the
 *     frontend build is present and the path is unmatched (must still
 *     return a JSON 404, not index.html — otherwise API consumers would
 *     get HTML where they expect JSON).
 *
 * This test creates a temporary, fake frontend/dist directory (with a
 * minimal but realistic index.html and a CSS asset) and points app.js's
 * relative path resolution at it — without requiring an actual `vite
 * build` or Docker, so this stays fast and dependency-free in CI.
 *
 * Docker build itself was NOT tested here — Docker is unavailable in
 * this environment. The Dockerfile's frontend-build stage was instead
 * validated by manually replicating its exact steps (npm ci + npm run
 * build) outside Docker; see docs/day-28-production-static-serving.md
 * for the full verification trail and that explicit caveat.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const jwt    = require('jsonwebtoken');

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

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';

function httpGet(port, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ port, path: reqPath, headers, timeout: 4000 }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

// frontend/dist is resolved by app.js as path.join(__dirname,'..','..','frontend','dist')
// relative to backend/src/app.js — i.e. <repoRoot>/frontend/dist
const repoRoot     = path.join(__dirname, '..', '..');
const frontendDir  = path.join(repoRoot, 'frontend');
const distDir      = path.join(frontendDir, 'dist');
const indexPath    = path.join(distDir, 'index.html');
const assetsDir    = path.join(distDir, 'assets');
const cssPath      = path.join(assetsDir, 'test-style.css');

const REAL_DIST_BACKUP = path.join(repoRoot, '.dist-backup-for-test');

function distAlreadyExists() {
  return fs.existsSync(indexPath);
}

async function run() {
  console.log('\n🖥️  Day 28 Verification — Production Static Frontend Serving\n');

  const preExisting = distAlreadyExists();
  if (preExisting) {
    console.log('  ℹ️  frontend/dist already exists (built earlier this session) — using it as-is for the "present" tests.\n');
  }

  // ── GROUP A: behavior when dist is ABSENT ─────────────────────────
  console.log('📭 Group A: Static serving when frontend/dist is ABSENT');

  // Temporarily move a real dist out of the way if present, so we can
  // test the "absent" code path cleanly, then restore it afterwards.
  let movedAside = false;
  if (preExisting) {
    fs.renameSync(distDir, REAL_DIST_BACKUP);
    movedAside = true;
  }

  await test('A-01 createApp() does not throw when frontend/dist is absent', () => {
    delete require.cache[require.resolve('../src/app')];
    const createApp = require('../src/app');
    const app = createApp(null, {}, { logLevel: false });
    assert.ok(app, 'app should be created');
  });

  await test('A-02 root path "/" returns JSON 404 (not HTML) when dist absent', async () => {
    delete require.cache[require.resolve('../src/app')];
    const createApp = require('../src/app');
    const app = createApp(null, {}, { logLevel: false });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const res = await httpGet(port, '/');
    server.close();
    assert.strictEqual(res.status, 404);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.error, 'NOT_FOUND');
  });

  await test('A-03 API routes still work normally when dist absent', async () => {
    delete require.cache[require.resolve('../src/app')];
    const createApp = require('../src/app');
    const app = createApp(null, {}, { logLevel: false });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const token = jwt.sign({ userId: 1, username: 'x', role: 'COMMANDER', unitId: 1 }, JWT_SECRET, { expiresIn: '1h' });
    const res = await httpGet(port, '/api/supply/categories', { Authorization: `Bearer ${token}` });
    server.close();
    assert.strictEqual(res.status, 200);
  });

  // Restore the real dist (or create a fake one) before Group B
  if (movedAside) {
    fs.renameSync(REAL_DIST_BACKUP, distDir);
  }

  // ── GROUP B: behavior when dist IS PRESENT ────────────────────────
  console.log('\n📦 Group B: Static serving when frontend/dist IS PRESENT');

  let createdFakeDist = false;
  if (!distAlreadyExists()) {
    // Build a minimal fake dist/ so this test is self-contained and
    // doesn't require `vite build` to have been run first.
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(indexPath,
      '<!doctype html><html><head><title>SANGAM</title></head><body><div id="root"></div></body></html>');
    fs.writeFileSync(cssPath, 'body { color: red; }');
    createdFakeDist = true;
  }

  await test('B-01 root path "/" serves the SPA shell (index.html)', async () => {
    delete require.cache[require.resolve('../src/app')];
    const createApp = require('../src/app');
    const app = createApp(null, {}, { logLevel: false });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const res = await httpGet(port, '/');
    server.close();
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('<div id="root">'), 'should serve the React root div');
  });

  await test('B-02 unknown client-side route falls back to SPA shell', async () => {
    delete require.cache[require.resolve('../src/app')];
    const createApp = require('../src/app');
    const app = createApp(null, {}, { logLevel: false });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const res = await httpGet(port, '/some/deep/client/route');
    server.close();
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('<div id="root">'));
  });

  await test('B-03 static assets are served with correct content-type', async () => {
    delete require.cache[require.resolve('../src/app')];
    const createApp = require('../src/app');
    const app = createApp(null, {}, { logLevel: false });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    // Discover an actual CSS asset filename in the (possibly real,
    // hashed-filename) dist/assets/ directory rather than assuming one —
    // a real Vite build uses content-hashed names like index-DtcNpTiy.css.
    const assetFiles = fs.readdirSync(assetsDir);
    const cssFile = assetFiles.find(f => f.endsWith('.css'));
    assert.ok(cssFile, 'expected at least one .css file in dist/assets/');

    const res = await httpGet(port, `/assets/${cssFile}`);
    server.close();
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('css'),
      `expected css content-type, got: ${res.headers['content-type']}`);
  });

  await test('B-04 API routes still work normally when dist present', async () => {
    delete require.cache[require.resolve('../src/app')];
    const createApp = require('../src/app');
    const app = createApp(null, {}, { logLevel: false });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const token = jwt.sign({ userId: 1, username: 'x', role: 'COMMANDER', unitId: 1 }, JWT_SECRET, { expiresIn: '1h' });
    const res = await httpGet(port, '/api/dashboard/summary', { Authorization: `Bearer ${token}` });
    server.close();
    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, true);
  });

  await test('B-05 unmatched /api/* path returns JSON 404, NOT the SPA shell', async () => {
    delete require.cache[require.resolve('../src/app')];
    const createApp = require('../src/app');
    const app = createApp(null, {}, { logLevel: false });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const res = await httpGet(port, '/api/this-route-does-not-exist');
    server.close();
    assert.strictEqual(res.status, 404);
    const parsed = JSON.parse(res.body); // throws if it's HTML, which is the point of this test
    assert.strictEqual(parsed.error, 'NOT_FOUND');
  });

  await test('B-06 health check still works when dist present', async () => {
    delete require.cache[require.resolve('../src/app')];
    const createApp = require('../src/app');
    const app = createApp(null, {}, { logLevel: false });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const res = await httpGet(port, '/health');
    server.close();
    // 503 expected with db=null (documented offline-mode contract) — what
    // matters here is it's JSON, not swallowed by the SPA fallback.
    const parsed = JSON.parse(res.body);
    assert.ok('status' in parsed || 'db' in parsed);
  });

  // Clean up the fake dist if we created it
  if (createdFakeDist) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  // ── FINAL ──────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 28 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(err => {
  console.error('Unexpected error:', err);
  // Best-effort cleanup on unexpected failure
  if (fs.existsSync(REAL_DIST_BACKUP) && !fs.existsSync(distDir)) {
    fs.renameSync(REAL_DIST_BACKUP, distDir);
  }
  process.exit(1);
});
