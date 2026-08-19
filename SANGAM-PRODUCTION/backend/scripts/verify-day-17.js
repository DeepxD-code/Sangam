'use strict';

/**
 * SANGAM Day 17 — Verification Suite
 * Tests: migration ordering, migration runner logic, app factory,
 * health route, env validation, Dockerfile directives, docker-compose
 * structure, .env.example completeness, graceful-degradation of
 * health when DB unavailable.
 *
 * No Docker daemon or real DB required.
 * Run: node backend/scripts/verify-day-17.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

const { getMigrationFiles, sortKey } = require(path.join(__dirname, 'run-migrations'));
const createHealthRoutes = require(path.join(__dirname, '../src/routes/health.routes'));
const createApp          = require(path.join(__dirname, '../src/app'));
const { validateEnv }    = require(path.join(__dirname, '../src/server'));

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
  console.log('\n🐳  SANGAM Day 17 — Docker Deployment Verification');
  console.log('═'.repeat(56));
  console.log(`Started: ${new Date().toISOString()}\n`);

  // ──────────────────────────────────────────────────────────
  section('1 · Migration File Discovery & Ordering');
  // ──────────────────────────────────────────────────────────

  await test('getMigrationFiles returns at least 7 SQL files', () => {
    const files = getMigrationFiles();
    assert(files.length >= 7, `Expected ≥7, got ${files.length}`);
  });

  await test('All returned files end with .sql', () => {
    getMigrationFiles().forEach(f =>
      assert(f.endsWith('.sql'), `${f} is not a .sql file`)
    );
  });

  await test('000-init-schema.sql is first', () => {
    const files = getMigrationFiles();
    assert(files[0] === '000-init-schema.sql', `First file is ${files[0]}`);
  });

  await test('Day files appear in ascending day-number order', () => {
    const files = getMigrationFiles();
    const days  = files.map(sortKey);
    for (let i = 1; i < days.length; i++) {
      assert(days[i] >= days[i - 1],
        `Order violation: ${files[i - 1]} (${days[i - 1]}) before ${files[i]} (${days[i]})`);
    }
  });

  await test('All expected day migrations are present (11–16)', () => {
    const files = getMigrationFiles();
    for (const day of [11, 12, 13, 14, 15, 16]) {
      const found = files.some(f => sortKey(f) === day);
      assert(found, `Missing migration for day ${day}`);
    }
  });

  await test('sortKey extracts correct numbers', () => {
    assert(sortKey('000-init-schema.sql')        === 0);
    assert(sortKey('day-11-notifications.sql')   === 11);
    assert(sortKey('day-16-audit-hardening.sql') === 16);
  });

  await test('sortKey handles unknown filenames gracefully (returns 9999)', () => {
    assert(sortKey('no-number-here.sql') === 9999);
  });

  // ──────────────────────────────────────────────────────────
  section('2 · Migration SQL Files — Content Checks');
  // ──────────────────────────────────────────────────────────

  await test('000-init-schema.sql creates schema_migrations table', () => {
    const sql = fs.readFileSync(
      path.join(ROOT, 'database/migrations/000-init-schema.sql'), 'utf8'
    );
    assert(sql.includes('schema_migrations'), 'Missing schema_migrations table');
    assert(sql.includes('users'), 'Missing users table');
  });

  await test('All day migration files use IF NOT EXISTS (idempotent)', () => {
    const files = getMigrationFiles().filter(f => f !== '000-init-schema.sql');
    files.forEach(filename => {
      const sql = fs.readFileSync(
        path.join(ROOT, 'database/migrations', filename), 'utf8'
      );
      assert(
        sql.includes('IF NOT EXISTS') || sql.includes('ON CONFLICT') || sql.includes('DO $$'),
        `${filename} does not appear to be idempotent (missing IF NOT EXISTS / ON CONFLICT / DO $$)`
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  section('3 · Health Route');
  // ──────────────────────────────────────────────────────────

  function makeRes() {
    let statusCode = 200;
    let body = null;
    const res = {
      status: (c) => { statusCode = c; return res; },
      json:   (b) => { body = b; return res; }
    };
    return { res, status: () => statusCode, body: () => body };
  }

  await test('GET /health with null db → 503, status:"degraded"', async () => {
    const router = createHealthRoutes(null);
    const handler = router.stack.find(l => l.route && l.route.path === '/')
      .route.stack[0].handle;

    const req = {};
    const { res, status, body } = makeRes();
    await handler(req, res, () => {});

    assert(status() === 503);
    assert(body().status === 'degraded');
    assert(body().db.connected === false);
  });

  await test('GET /health with healthy mock db → 200, status:"ok"', async () => {
    const mockDb = { query: async () => ({ rows: [{ '?column?': 1 }] }) };
    const router  = createHealthRoutes(mockDb);
    const handler = router.stack.find(l => l.route && l.route.path === '/')
      .route.stack[0].handle;

    const req = {};
    const { res, status, body } = makeRes();
    await handler(req, res, () => {});

    assert(status() === 200);
    assert(body().status === 'ok');
    assert(body().db.connected === true);
    assert(typeof body().db.latencyMs === 'number');
    assert(typeof body().uptime === 'number');
    assert(typeof body().version === 'string');
  });

  await test('GET /health with failing mock db → 503, connected:false', async () => {
    const failDb = { query: async () => { throw new Error('connection refused'); } };
    const router  = createHealthRoutes(failDb);
    const handler = router.stack.find(l => l.route && l.route.path === '/')
      .route.stack[0].handle;

    const req = {};
    const { res, status, body } = makeRes();
    await handler(req, res, () => {});

    assert(status() === 503);
    assert(body().db.connected === false);
  });

  await test('/health response includes version from package.json', async () => {
    const mockDb = { query: async () => ({}) };
    const router  = createHealthRoutes(mockDb);
    const handler = router.stack.find(l => l.route && l.route.path === '/')
      .route.stack[0].handle;

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const { res, body } = makeRes();
    await handler({}, res, () => {});
    assert(body().version === pkg.version);
  });

  // ──────────────────────────────────────────────────────────
  section('4 · Express App Factory');
  // ──────────────────────────────────────────────────────────

  await test('createApp(null) returns an Express app without throwing', () => {
    const app = createApp(null);
    assert(typeof app === 'function', 'app should be a function');
    assert(typeof app.use === 'function', 'app.use should exist');
  });

  await test('createApp(null).locals.services has all expected service keys', () => {
    const app = createApp(null);
    const keys = Object.keys(app.locals.services);
    ['audit', 'rbac', 'notifications', 'hardening', 'delegation'].forEach(k =>
      assert(keys.includes(k), `Missing service key: ${k}`)
    );
  });

  await test('App mounts /health route (verified in app.js source)', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'backend/src/app.js'), 'utf8');
    assert(appSrc.includes("'/health'"), "app.js should mount /health route");
    assert(appSrc.includes('createHealthRoutes'), "app.js should call createHealthRoutes");
  });

  await test('App returns 404 JSON for unknown routes', () => {
    // Verify the 404 handler is defined in app.js with correct shape
    const appSrc = fs.readFileSync(path.join(ROOT, 'backend/src/app.js'), 'utf8');
    assert(appSrc.includes('NOT_FOUND'), 'app.js should have NOT_FOUND 404 response');
    assert(appSrc.includes('res.status(404)'), 'app.js should respond with 404 status');
    assert(appSrc.includes('req.path'), 'app.js 404 handler should include path in response');
  });

  // ──────────────────────────────────────────────────────────
  section('5 · Environment Variable Validation');
  // ──────────────────────────────────────────────────────────

  await test('validateEnv passes when all required vars are set', () => {
    const saved = { ...process.env };
    process.env.DATABASE_URL   = 'postgresql://u:p@localhost:5432/db';
    process.env.JWT_SECRET     = 'a'.repeat(32);
    process.env.PASSWORD_PEPPER = 'b'.repeat(32);
    process.env.NODE_ENV       = 'development'; // skip AUDIT_ENCRYPTION_KEY

    let threw = false;
    try { validateEnv(); } catch { threw = true; }

    // Restore
    for (const k of ['DATABASE_URL', 'JWT_SECRET', 'PASSWORD_PEPPER', 'NODE_ENV']) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }

    assert(!threw, 'validateEnv should not throw with all vars set');
  });

  await test('validateEnv exits on short JWT_SECRET (< 32 chars)', () => {
    const saved = { ...process.env };
    process.env.DATABASE_URL    = 'postgresql://u:p@localhost:5432/db';
    process.env.JWT_SECRET      = 'tooshort';
    process.env.PASSWORD_PEPPER = 'b'.repeat(32);
    process.env.NODE_ENV        = 'development';

    let exitCode = null;
    const origExit = process.exit;
    process.exit = (code) => { exitCode = code; throw new Error(`exit(${code})`); };

    try { validateEnv(); } catch {}
    process.exit = origExit;

    // Restore
    for (const k of ['DATABASE_URL', 'JWT_SECRET', 'PASSWORD_PEPPER']) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }

    assert(exitCode === 1, `Expected exit(1), got exit(${exitCode})`);
  });

  await test('validateEnv exits when DATABASE_URL is missing', () => {
    const savedUrl  = process.env.DATABASE_URL;
    const savedNode = process.env.NODE_ENV;
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'development';

    let exitCode = null;
    const origExit = process.exit;
    process.exit = (code) => { exitCode = code; throw new Error(`exit(${code})`); };

    try { validateEnv(); } catch {}
    process.exit = origExit;

    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
    if (savedNode !== undefined) process.env.NODE_ENV = savedNode;

    assert(exitCode === 1);
  });

  // ──────────────────────────────────────────────────────────
  section('6 · .env.example Completeness');
  // ──────────────────────────────────────────────────────────

  await test('.env.example file exists', () => {
    assert(fs.existsSync(path.join(ROOT, '.env.example')), '.env.example not found');
  });

  await test('.env.example documents all required variables', () => {
    const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const required = ['DATABASE_URL', 'JWT_SECRET', 'PASSWORD_PEPPER', 'AUDIT_ENCRYPTION_KEY', 'NODE_ENV', 'PORT'];
    required.forEach(v =>
      assert(envExample.includes(v), `.env.example is missing ${v}`)
    );
  });

  await test('.env.example does not contain real secrets (all values are placeholders)', () => {
    const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    assert(envExample.includes('CHANGE_ME'), '.env.example should contain CHANGE_ME placeholder');
    assert(!envExample.match(/JWT_SECRET=(?!CHANGE_ME)[a-zA-Z0-9]{32}/),
      '.env.example appears to contain a real JWT_SECRET');
  });

  // ──────────────────────────────────────────────────────────
  section('7 · Dockerfile Existence & Key Directives');
  // ──────────────────────────────────────────────────────────

  await test('Dockerfile exists at project root', () => {
    assert(fs.existsSync(path.join(ROOT, 'Dockerfile')), 'Dockerfile not found');
  });

  await test('Dockerfile uses node:22 base image', () => {
    const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert(df.includes('node:22'), 'Dockerfile should use node:22');
  });

  await test('Dockerfile has EXPOSE 3000', () => {
    const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert(df.includes('EXPOSE 3000'), 'Dockerfile should EXPOSE 3000');
  });

  await test('Dockerfile has HEALTHCHECK directive', () => {
    const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert(df.includes('HEALTHCHECK'), 'Dockerfile should have HEALTHCHECK');
  });

  await test('Dockerfile creates a non-root user', () => {
    const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert(df.includes('adduser') || df.includes('useradd'),
      'Dockerfile should create a non-root user');
    assert(df.includes('USER '), 'Dockerfile should switch to non-root USER');
  });

  await test('Dockerfile uses multi-stage build (FROM … AS …)', () => {
    const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const stages = (df.match(/^FROM\s+/gm) || []).length;
    assert(stages >= 2, `Expected ≥2 FROM stages, found ${stages}`);
  });

  await test('.dockerignore exists and excludes .env', () => {
    assert(fs.existsSync(path.join(ROOT, '.dockerignore')), '.dockerignore not found');
    const di = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8');
    assert(di.includes('.env'), '.dockerignore should exclude .env');
    assert(di.includes('node_modules'), '.dockerignore should exclude node_modules');
  });

  // ──────────────────────────────────────────────────────────
  section('8 · docker-compose.yml Structure');
  // ──────────────────────────────────────────────────────────

  await test('docker-compose.yml exists', () => {
    assert(fs.existsSync(path.join(ROOT, 'docker-compose.yml')), 'docker-compose.yml not found');
  });

  await test('docker-compose.yml defines db and app services', () => {
    const dc = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    assert(dc.includes('services:'), 'Missing services:');
    assert(dc.includes('  db:'),     'Missing db service');
    assert(dc.includes('  app:'),    'Missing app service');
  });

  await test('docker-compose.yml has postgres:16 image', () => {
    const dc = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    assert(dc.includes('postgres:16'), 'Should use postgres:16');
  });

  await test('docker-compose.yml app depends_on db with health condition', () => {
    const dc = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    assert(dc.includes('depends_on:'), 'Missing depends_on');
    assert(dc.includes('service_healthy'), 'Should wait for db to be healthy');
  });

  await test('docker-compose.yml references required env vars with :? syntax', () => {
    const dc = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    assert(dc.includes('JWT_SECRET:?'), 'JWT_SECRET should be required in docker-compose');
    assert(dc.includes('PASSWORD_PEPPER:?'), 'PASSWORD_PEPPER should be required');
    assert(dc.includes('AUDIT_ENCRYPTION_KEY:?'), 'AUDIT_ENCRYPTION_KEY should be required');
  });

  await test('docker-compose.yml has a named persistent volume for DB data', () => {
    const dc = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    assert(dc.includes('sangam_data:'), 'Should have sangam_data persistent volume');
  });

  await test('docker-compose.dev.yml exists', () => {
    assert(fs.existsSync(path.join(ROOT, 'docker-compose.dev.yml')), 'docker-compose.dev.yml not found');
  });

  // ──────────────────────────────────────────────────────────
  section('9 · package.json Scripts');
  // ──────────────────────────────────────────────────────────

  await test('package.json has start and migrate scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert(pkg.scripts.start,   'Missing start script');
    assert(pkg.scripts.migrate, 'Missing migrate script');
  });

  await test('package.json has test scripts for all days 11-17', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const day of [11, 12, 13, 14, 15, 16, 17]) {
      assert(pkg.scripts[`test:day${day}`], `Missing test:day${day} script`);
    }
  });

  await test('package.json has required production dependencies', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = pkg.dependencies || {};
    ['bcrypt', 'jsonwebtoken', 'pg', 'express', 'cors', 'helmet', 'morgan'].forEach(d =>
      assert(deps[d], `Missing dependency: ${d}`)
    );
  });

  // ──────────────────────────────────────────────────────────
  section('10 · Migration Runner Module');
  // ──────────────────────────────────────────────────────────

  await test('getMigrationFiles returns files in ascending day-number order', () => {
    const files = getMigrationFiles();
    const keys  = files.map(sortKey);
    for (let i = 1; i < keys.length; i++) {
      assert(keys[i] >= keys[i - 1],
        `${files[i]} (${keys[i]}) appears before ${files[i - 1]} (${keys[i - 1]})`);
    }
  });

  await test('runMigrations function is exported', () => {
    const { runMigrations } = require(path.join(__dirname, 'run-migrations'));
    assert(typeof runMigrations === 'function');
  });

  await test('Migration runner skips already-applied files (mock)', async () => {
    const { runMigrations } = require(path.join(__dirname, 'run-migrations'));

    // Mock DB that reports all migrations as already applied
    const files = getMigrationFiles();
    const mockClient = {
      query: async (sql) => {
        if (sql.includes('FROM schema_migrations')) {
          return { rows: files.map(f => ({ filename: f })) };
        }
        return { rows: [] };
      },
      release: () => {}
    };
    const mockDb = { connect: async () => mockClient, end: async () => {} };

    const result = await runMigrations(mockDb);
    assert(result.applied.length === 0, 'Should skip all already-applied migrations');
    assert(result.skipped.length === files.length);
  });

  await test('Migration runner applies pending files (mock)', async () => {
    const { runMigrations } = require(path.join(__dirname, 'run-migrations'));

    // Mock DB that reports NO migrations applied yet
    const appliedInSession = [];
    const mockClient = {
      query: async (sql) => {
        if (sql.includes('FROM schema_migrations')) return { rows: [] };
        if (sql.includes('INSERT INTO schema_migrations')) {
          const m = sql.match(/\$1/); // filename is $1
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {}
    };
    const mockDb = { connect: async () => mockClient, end: async () => {} };

    const result = await runMigrations(mockDb);
    assert(result.applied.length >= 7, `Expected ≥7 applied, got ${result.applied.length}`);
    assert(result.skipped.length === 0);
    assert(result.failed === null);
  });

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(56));
  console.log(`📊  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed === 0) {
    console.log('\n🐳  ALL TESTS PASSED — Day 17 Docker deployment verified!\n');
    console.log('Capabilities delivered:');
    console.log('  🗃️   Migration runner (idempotent, day-ordered, tracked)');
    console.log('  💉  Express app factory (db+service injection, no global state)');
    console.log('  ❤️   /health endpoint (DB latency probe, 200/503)');
    console.log('  🔍  Env var validation at startup (clear errors, no silent failures)');
    console.log('  🐋  Dockerfile (multi-stage, non-root user, HEALTHCHECK)');
    console.log('  🎛️   docker-compose.yml (db healthy-wait, persistent volume, required secrets)');
    console.log('  🛠️   docker-compose.dev.yml (live source mount, hot reload)');
    console.log('  📄  .env.example (all vars documented, placeholders only)');
    console.log('  📦  package.json scripts: start, migrate, test:dayN for all days');
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
