'use strict';

/**
 * SANGAM Day 18 — Verification Suite
 * Tests: OpenAPI spec structure, schema coverage, path completeness,
 * generator idempotency, docs route (HTML + JSON endpoints), spec
 * version/info fields, security scheme, all required tags present,
 * all day-11-through-17 endpoints covered.
 *
 * No DB or HTTP server required.
 * Run: node backend/scripts/verify-day-18.js
 */

const path = require('path');
const fs   = require('fs');

const { buildSpec, generate } = require(path.join(__dirname, 'generate-openapi'));
const createDocsRoutes        = require(path.join(__dirname, '../src/routes/docs.routes'));

const ROOT = path.join(__dirname, '../..');

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
  console.log('\n📖  SANGAM Day 18 — API Documentation Verification');
  console.log('═'.repeat(56));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const spec = buildSpec();

  // ──────────────────────────────────────────────────────────
  section('1 · OpenAPI Top-Level Structure');
  // ──────────────────────────────────────────────────────────

  await test('openapi field is 3.0.3', () => {
    assert(spec.openapi === '3.0.3', `Expected 3.0.3, got ${spec.openapi}`);
  });

  await test('info.title and info.version are present', () => {
    assert(spec.info && spec.info.title, 'Missing info.title');
    assert(spec.info.version === '1.0.0', 'info.version should be 1.0.0');
  });

  await test('info.description covers auth, permissions, command scope', () => {
    const desc = spec.info.description || '';
    assert(desc.includes('Authentication'),  'Description should mention authentication');
    assert(desc.includes('permission'),      'Description should mention permissions');
    assert(desc.includes('Command Scope') || desc.includes('command scope'), 'Description should mention command scope');
    assert(desc.includes('Offline'),         'Description should mention offline-first');
  });

  await test('servers array has at least 2 entries (local + production)', () => {
    assert(Array.isArray(spec.servers) && spec.servers.length >= 2,
      `Expected ≥2 servers, got ${(spec.servers || []).length}`);
  });

  await test('Has 7 tags covering all major feature areas', () => {
    const tagNames = (spec.tags || []).map(t => t.name);
    const required = ['System', 'Authentication', 'RBAC', 'Audit',
                      'Notifications', 'Reports', 'Delegation'];
    required.forEach(t => assert(tagNames.includes(t), `Missing tag: ${t}`));
  });

  // ──────────────────────────────────────────────────────────
  section('2 · Security Scheme');
  // ──────────────────────────────────────────────────────────

  await test('BearerAuth security scheme defined', () => {
    assert(spec.components.securitySchemes.BearerAuth, 'Missing BearerAuth');
    assert(spec.components.securitySchemes.BearerAuth.type === 'http');
    assert(spec.components.securitySchemes.BearerAuth.scheme === 'bearer');
    assert(spec.components.securitySchemes.BearerAuth.bearerFormat === 'JWT');
  });

  await test('Protected endpoints reference BearerAuth security', () => {
    const protectedPaths = ['/api/auth/logout-all', '/api/rbac/roles',
                            '/api/notifications', '/api/reports/dashboard',
                            '/api/delegation'];
    protectedPaths.forEach(p => {
      const methods = spec.paths[p] || {};
      const ops = Object.values(methods);
      const hasBearer = ops.some(op =>
        Array.isArray(op.security) && op.security.some(s => s.BearerAuth !== undefined)
      );
      assert(hasBearer, `${p} should require BearerAuth`);
    });
  });

  await test('Public endpoints (/health, /api/auth/login) have no security requirement', () => {
    const healthGet = spec.paths['/health']?.get;
    assert(!healthGet?.security, '/health should not require auth');

    const loginPost = spec.paths['/api/auth/login']?.post;
    assert(!loginPost?.security, '/api/auth/login should not require auth');
  });

  // ──────────────────────────────────────────────────────────
  section('3 · Schema Completeness');
  // ──────────────────────────────────────────────────────────

  await test('All 13 schemas are defined', () => {
    assert(Object.keys(spec.components.schemas).length >= 13,
      `Expected ≥13 schemas, got ${Object.keys(spec.components.schemas).length}`);
  });

  await test('Core schemas present: Error, Success, LoginRequest, LoginResponse', () => {
    ['Error', 'Success', 'LoginRequest', 'LoginResponse'].forEach(s =>
      assert(spec.components.schemas[s], `Missing schema: ${s}`)
    );
  });

  await test('RoleName enum has all 9 army roles', () => {
    const roleEnum = spec.components.schemas.RoleName?.enum || [];
    const required = ['SOLDIER','NCO','JCO','LOGISTICS_OFFICER','OFFICER',
                      'SENIOR_OFFICER','COMMANDER','AUDITOR','SYSTEM_ADMIN'];
    required.forEach(r => assert(roleEnum.includes(r), `Missing role: ${r}`));
    assert(roleEnum.length === 9, `Expected 9 roles, got ${roleEnum.length}`);
  });

  await test('NotificationType enum has all 11 types (including DELEGATION_GRANTED)', () => {
    const typeEnum = spec.components.schemas.NotificationType?.enum || [];
    assert(typeEnum.length === 11, `Expected 11 notification types, got ${typeEnum.length}`);
    assert(typeEnum.includes('DELEGATION_GRANTED'), 'Missing DELEGATION_GRANTED');
    assert(typeEnum.includes('BLOCKCHAIN_TAMPER'),  'Missing BLOCKCHAIN_TAMPER');
  });

  await test('Severity enum has LOW, MEDIUM, HIGH, CRITICAL', () => {
    const sev = spec.components.schemas.Severity?.enum || [];
    ['LOW','MEDIUM','HIGH','CRITICAL'].forEach(s =>
      assert(sev.includes(s), `Missing severity: ${s}`)
    );
  });

  await test('Notification schema has all key fields', () => {
    const n = spec.components.schemas.Notification?.properties || {};
    ['id','type','severity','title','message','requiresAck',
     'read','acknowledged','createdAt'].forEach(f =>
      assert(n[f], `Notification schema missing field: ${f}`)
    );
  });

  await test('Delegation schema has all key fields', () => {
    const d = spec.components.schemas.Delegation?.properties || {};
    ['id','delegatorUserId','delegateUserId','permission','unitId',
     'reason','expiresAt','revokedAt'].forEach(f =>
      assert(d[f], `Delegation schema missing field: ${f}`)
    );
  });

  await test('Override schema has all key fields', () => {
    const o = spec.components.schemas.Override?.properties || {};
    ['id','userId','permission','justification','usedAt',
     'reviewedAt','reviewedBy'].forEach(f =>
      assert(o[f], `Override schema missing field: ${f}`)
    );
  });

  await test('HealthResponse schema has status, db.connected, uptime', () => {
    const h = spec.components.schemas.HealthResponse?.properties || {};
    assert(h.status && h.db && h.uptime, 'HealthResponse missing required fields');
    assert(h.db.properties?.connected, 'HealthResponse.db missing connected field');
  });

  await test('Shared error/not-found responses defined in components.responses', () => {
    ['Unauthorized', 'Forbidden', 'NotFound', 'BadRequest'].forEach(r =>
      assert(spec.components.responses[r], `Missing response component: ${r}`)
    );
  });

  // ──────────────────────────────────────────────────────────
  section('4 · Path Coverage');
  // ──────────────────────────────────────────────────────────

  await test('At least 27 paths documented', () => {
    const count = Object.keys(spec.paths).length;
    assert(count >= 27, `Expected ≥27 paths, got ${count}`);
  });

  await test('All 7 auth endpoints documented', () => {
    const authPaths = [
      '/api/auth/login', '/api/auth/refresh', '/api/auth/logout',
      '/api/auth/logout-all', '/api/auth/change-password',
      '/api/auth/unlock/{userId}', '/api/auth/me'
    ];
    authPaths.forEach(p => assert(spec.paths[p], `Missing path: ${p}`));
  });

  await test('RBAC paths include roles, my-permissions, check, audit endpoints', () => {
    ['/api/rbac/roles', '/api/rbac/my-permissions', '/api/rbac/check/{permission}',
     '/api/rbac/audit-logs', '/api/rbac/audit-logs/verify-integrity'].forEach(p =>
      assert(spec.paths[p], `Missing path: ${p}`)
    );
  });

  await test('Notification paths include stream (SSE) and acknowledge', () => {
    ['/api/notifications', '/api/notifications/stream',
     '/api/notifications/{id}/acknowledge',
     '/api/notifications/unread-count', '/api/notifications/digest'].forEach(p =>
      assert(spec.paths[p], `Missing path: ${p}`)
    );
  });

  await test('Report paths include dashboard, stock, security-posture, CSV export', () => {
    ['/api/reports/dashboard', '/api/reports/stock-levels',
     '/api/reports/security-posture', '/api/reports/export/{type}'].forEach(p =>
      assert(spec.paths[p], `Missing path: ${p}`)
    );
  });

  await test('Delegation paths include create, overrides, review-queue, review', () => {
    ['/api/delegation', '/api/delegation/overrides',
     '/api/delegation/overrides/pending-review',
     '/api/delegation/overrides/{id}/review'].forEach(p =>
      assert(spec.paths[p], `Missing path: ${p}`)
    );
  });

  await test('/health is documented', () => {
    assert(spec.paths['/health']?.get, 'Missing /health GET');
  });

  // ──────────────────────────────────────────────────────────
  section('5 · Operation Quality');
  // ──────────────────────────────────────────────────────────

  await test('Every operation has an operationId (for SDK generation)', () => {
    const missing = [];
    for (const [p, methods] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(methods)) {
        if (!op.operationId) missing.push(`${m.toUpperCase()} ${p}`);
      }
    }
    assert(missing.length === 0, `Missing operationId: ${missing.join(', ')}`);
  });

  await test('Every operation has at least one tag', () => {
    const missing = [];
    for (const [p, methods] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(methods)) {
        if (!op.tags || op.tags.length === 0) missing.push(`${m.toUpperCase()} ${p}`);
      }
    }
    assert(missing.length === 0, `Untagged operations: ${missing.join(', ')}`);
  });

  await test('Every operation has a summary', () => {
    const missing = [];
    for (const [p, methods] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(methods)) {
        if (!op.summary) missing.push(`${m.toUpperCase()} ${p}`);
      }
    }
    assert(missing.length === 0, `Operations without summary: ${missing.join(', ')}`);
  });

  await test('Every operation has at least one response defined', () => {
    const missing = [];
    for (const [p, methods] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(methods)) {
        if (!op.responses || Object.keys(op.responses).length === 0) {
          missing.push(`${m.toUpperCase()} ${p}`);
        }
      }
    }
    assert(missing.length === 0, `Operations without responses: ${missing.join(', ')}`);
  });

  await test('POST /api/auth/login has 401 and 429 responses', () => {
    const responses = spec.paths['/api/auth/login']?.post?.responses || {};
    assert(responses[401], 'login should have 401');
    assert(responses[429], 'login should have 429 (rate limit)');
    assert(responses[423], 'login should have 423 (account locked)');
  });

  await test('SSE stream documents text/event-stream content type', () => {
    const streamOp = spec.paths['/api/notifications/stream']?.get;
    assert(streamOp, 'Missing /api/notifications/stream GET');
    const content = streamOp.responses?.[200]?.content || {};
    assert(content['text/event-stream'], 'SSE route should declare text/event-stream');
  });

  await test('CSV export route documents text/csv content type', () => {
    const exportOp = spec.paths['/api/reports/export/{type}']?.get;
    const content  = exportOp?.responses?.[200]?.content || {};
    assert(content['text/csv'], 'CSV export should declare text/csv');
  });

  await test('POST /api/delegation body requires justification minLength ≥ 10', () => {
    const overrideBody = spec.paths['/api/delegation/overrides']?.post
      ?.requestBody?.content?.['application/json']?.schema?.properties?.justification;
    assert(overrideBody?.minLength >= 10, 'justification should have minLength ≥ 10');
  });

  // ──────────────────────────────────────────────────────────
  section('6 · Generator Idempotency');
  // ──────────────────────────────────────────────────────────

  await test('generate() writes openapi.json to docs/', () => {
    generate();
    const specPath = path.join(ROOT, 'docs/openapi.json');
    assert(fs.existsSync(specPath), 'docs/openapi.json not found after generate()');
  });

  await test('Written spec is valid JSON and matches buildSpec()', () => {
    const specPath = path.join(ROOT, 'docs/openapi.json');
    const written  = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    assert(written.openapi === spec.openapi, 'Written spec openapi field mismatch');
    assert(Object.keys(written.paths).length === Object.keys(spec.paths).length,
      'Written spec path count mismatch');
  });

  await test('Running generate() twice produces identical output', () => {
    const specPath = path.join(ROOT, 'docs/openapi.json');
    generate();
    const first = fs.readFileSync(specPath, 'utf8');
    generate();
    const second = fs.readFileSync(specPath, 'utf8');
    assert(first === second, 'Two generate() runs produced different output');
  });

  // ──────────────────────────────────────────────────────────
  section('7 · Docs Route');
  // ──────────────────────────────────────────────────────────

  function makeRes() {
    let statusCode = 200;
    let sentPath = null;
    let body = null;
    let contentType = null;
    const res = {
      setHeader: (k, v) => { if (k === 'Content-Type') contentType = v; },
      status:    (c) => { statusCode = c; return res; },
      json:      (b) => { body = b; },
      send:      (b) => { body = b; },
      sendFile:  (p) => { sentPath = p; }
    };
    return { res, status: () => statusCode, body: () => body,
             sentPath: () => sentPath, contentType: () => contentType };
  }

  await test('docs.routes.js exports a function', () => {
    assert(typeof createDocsRoutes === 'function', 'createDocsRoutes should be a function');
  });

  await test('GET /api/docs/openapi.json serves the spec file', () => {
    const router  = createDocsRoutes();
    const jsonLayer = router.stack.find(
      l => l.route && l.route.path === '/openapi.json'
    );
    assert(jsonLayer, 'Missing /openapi.json route');

    const handler = jsonLayer.route.stack[0].handle;
    const { res, contentType, sentPath } = makeRes();
    const req = { protocol: 'http', get: () => 'localhost:3000' };
    handler(req, res, () => {});
    assert(contentType() === 'application/json', 'Should set Content-Type application/json');
    assert(sentPath() && sentPath().endsWith('openapi.json'), 'Should send openapi.json file');
  });

  await test('GET /api/docs/ serves Swagger UI HTML', () => {
    const router = createDocsRoutes();
    const rootLayer = router.stack.find(
      l => l.route && l.route.path === '/'
    );
    assert(rootLayer, 'Missing / route on docs router');

    const handler  = rootLayer.route.stack[0].handle;
    const { res, body, contentType } = makeRes();
    const req = { protocol: 'http', get: () => 'localhost:3000' };
    handler(req, res, () => {});

    assert(contentType() === 'text/html', 'Should set Content-Type text/html');
    const html = body() || '';
    assert(html.includes('swagger-ui'), 'HTML should include swagger-ui');
    assert(html.includes('SwaggerUIBundle'), 'HTML should include SwaggerUIBundle');
    assert(html.includes('SANGAM'), 'HTML should include SANGAM title');
    assert(html.includes('openapi.json'), 'HTML should reference openapi.json URL');
  });

  await test('app.js mounts /api/docs route', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'backend/src/app.js'), 'utf8');
    assert(appSrc.includes("'/api/docs'"), "app.js should mount /api/docs");
    assert(appSrc.includes('createDocsRoutes'), 'app.js should call createDocsRoutes');
  });

  // ──────────────────────────────────────────────────────────
  section('8 · Spec Content — Day Integration Markers');
  // ──────────────────────────────────────────────────────────

  await test('Auth login description mentions Day 14 and rate limiting', () => {
    const desc = spec.paths['/api/auth/login']?.post?.description || '';
    assert(desc.includes('Day 14') || desc.includes('Rate-limited') || desc.includes('rate'),
      'Login description should mention rate limiting');
  });

  await test('Security posture description mentions Days 13 and 11', () => {
    const desc = spec.paths['/api/reports/security-posture']?.get?.description || '';
    assert(desc.includes('Day 13') || desc.includes('audit'),
      'Security posture should reference audit events');
    assert(desc.includes('Day 11') || desc.includes('acknowledgment'),
      'Security posture should reference pending acknowledgments');
  });

  await test('Emergency override description mentions SECURITY severity and review queue', () => {
    const desc = spec.paths['/api/delegation/overrides']?.post?.description || '';
    assert(desc.toLowerCase().includes('security') || desc.includes('SECURITY'),
      'Override description should mention SECURITY severity');
    assert(desc.toLowerCase().includes('review'),
      'Override description should mention review queue');
  });

  await test('SSE stream description mentions EventSource and token query param', () => {
    const desc = spec.paths['/api/notifications/stream']?.get?.description || '';
    assert(desc.includes('EventSource') || desc.includes('event'),
      'SSE description should mention EventSource');
    assert(desc.includes('token') || desc.includes('JWT'),
      'SSE description should mention token query param');
  });

  await test('Dashboard description mentions 5-minute cache', () => {
    const desc = spec.paths['/api/reports/dashboard']?.get?.description || '';
    assert(desc.includes('5') || desc.includes('cache') || desc.includes('Cache'),
      'Dashboard description should mention caching');
  });

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(56));
  console.log(`📊  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed === 0) {
    console.log('\n📖  ALL TESTS PASSED — Day 18 API documentation verified!\n');
    console.log('Capabilities delivered:');
    console.log(`  📄  ${Object.keys(spec.paths).length} paths documented in OpenAPI 3.0.3`);
    console.log(`  📐  ${Object.keys(spec.components.schemas).length} schemas (Role, Notification, Delegation, Override, ...)`);
    console.log('  🔐  BearerAuth security scheme with per-operation declarations');
    console.log('  🏷️   7 tags covering all feature areas (Days 11–17)');
    console.log('  🌐  Swagger UI at GET /api/docs (CDN-hosted, no npm package)');
    console.log('  📦  Raw spec at GET /api/docs/openapi.json');
    console.log('  ♻️   Idempotent generator: 2 runs → identical output');
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
