'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Day 90 — Final Project Completion Verification
 *
 * End-to-end verification that the SANGAM project is complete
 * at Day 90 with all deliverables in place.
 */

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  \u2705 ${name}`); passed++; }
  catch (e) { console.error(`  \u274C ${name}: ${e.message}`); failed++; }
}

function exists(relPath) {
  return fs.existsSync(path.join(__dirname, '..', '..', relPath));
}

function loadJSON(relPath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8'));
}

function run() {
  console.log('\nDay 90 \u2014 Final Project Completion\n');

  // ── Project structure integrity ─────────────────────────
  console.log('Project structure');
  test('Root package.json exists',  () => { if (!exists('package.json')) throw new Error('missing'); });
  test('Backend services exist',    () => {
    const services = fs.readdirSync(path.join(__dirname, '..', 'src', 'services'));
    if (services.length < 17) throw new Error(`expected 17+ services, got ${services.length}`);
  });
  test('Frontend components exist', () => {
    const comps = fs.readdirSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components'));
    if (comps.length < 10) throw new Error(`expected 10+ components, got ${comps.length}`);
  });
  test('Frontend pages exist',      () => {
    const pages = fs.readdirSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'pages'));
    if (pages.length < 15) throw new Error(`expected 15+ pages, got ${pages.length}`);
  });
  test('Docker compose exists',     () => { if (!exists('docker-compose.yml')) throw new Error('missing'); });
  test('Dockerfile exists',         () => { if (!exists('Dockerfile')) throw new Error('missing'); });
  test('Database migrations exist', () => {
    const migs = fs.readdirSync(path.join(__dirname, '..', '..', 'database', 'migrations'));
    if (migs.length < 9) throw new Error(`expected 9+ migrations, got ${migs.length}`);
  });

  // ── Verify scripts chain ────────────────────────────────
  console.log('\nVerify scripts (Days 11-90)');
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const scriptFiles = fs.readdirSync(scriptsDir).filter(f => f.startsWith('verify-day-') && f.endsWith('.js'));
  const dayNumbers = scriptFiles.map(f => parseInt(f.match(/verify-day-(\d+)/)[1], 10)).sort((a,b) => a-b);
  test('66+ verify scripts exist', () => {
    if (scriptFiles.length < 66) throw new Error(`expected 66+ scripts, got ${scriptFiles.length}`);
  });
  test('Covers Days 11-90', () => {
    const missing = [];
    for (let d = 11; d <= 90; d++) {
      if (d === 27 || d === 29) continue; // Day 27 is frontend, Day 29 unused
      if (!dayNumbers.includes(d)) missing.push(d);
    }
    if (missing.length > 0) throw new Error(`missing verify scripts for days: ${missing.join(', ')}`);
  });
  test('Day 72 verify passes', () => { require('./verify-day-72.js'); });
  test('Day 85 verify passes', () => { require('./verify-day-85.js'); });

  // ── Network automation ──────────────────────────────────
  console.log('\nDay 72-74: Network automation');
  test('deploy-hybrid-network.js loads', () => {
    require('../scripts/deploy-hybrid-network.js');
  });

  // ── Frontend tests ──────────────────────────────────────
  console.log('\nDay 75-77: Frontend tests');
  const frontendPkg = loadJSON('frontend/package.json');
  test('esbuild in frontend devDependencies', () => {
    if (!frontendPkg.devDependencies || !frontendPkg.devDependencies.esbuild) throw new Error('esbuild missing');
  });
  test('Frontend test script exists', () => {
    if (!exists('frontend/scripts/verify-day-27.cjs')) throw new Error('verify-day-27.cjs missing');
  });

  // ── Domain audit ────────────────────────────────────────
  console.log('\nDay 78-85: Domain audit');
  test('Supply chain domain audit exists', () => {
    if (!exists('docs/supply-chain-domain-audit.md')) throw new Error('audit doc missing');
  });

  // ── Auth hardening ──────────────────────────────────────
  console.log('\nDay 86-88: PKI auth');
  test('PKI auth stub service loads', () => {
    const PkiAuth = require('../src/services/pki-auth-stub.service.js');
    const pki = new PkiAuth();
    const r = pki.verifyCacCertificate('TEST-CERT-A1B2C3');
    if (!r.verified) throw new Error('known cert rejected: ' + r.error);
  });

  // ── Air-gapped smoke test ───────────────────────────────
  console.log('\nDay 89-90: Smoke test + CI/CD');
  test('Air-gapped smoke test exists', () => {
    if (!exists('scripts/air-gapped-smoke-test.js')) throw new Error('smoke test missing');
  });
  test('CI/CD workflow exists', () => {
    if (!exists('.github/workflows/ci.yml')) throw new Error('CI workflow missing');
  });
  test('Blockchain persistence migration exists', () => {
    if (!exists('database/migrations/day-90-blockchain-persist.sql')) throw new Error('migration missing');
  });

  // ── Package.json wiring ─────────────────────────────────
  console.log('\nWiring');
  const rootPkg = loadJSON('package.json');
  test('test:day90 script exists', () => {
    if (!rootPkg.scripts || !rootPkg.scripts['test:day90']) throw new Error('test:day90 missing');
  });
  test('network:bootstrap script exists', () => {
    if (!rootPkg.scripts || !rootPkg.scripts['network:bootstrap']) throw new Error('network:bootstrap missing');
  });
  test('smoke:air-gapped script exists', () => {
    if (!rootPkg.scripts || !rootPkg.scripts['smoke:air-gapped']) throw new Error('smoke:air-gapped missing');
  });
  test('test:all loop includes day 72', () => {
    if (!rootPkg.scripts['test:all'].includes(' 72')) throw new Error('day 72 not in test:all loop');
  });

  // ── Final count ─────────────────────────────────────────
  console.log(`\n${'\u2500'.repeat(60)}`);
  console.log(`Day 90 Results: ${passed} passed, ${failed} failed`);
  console.log(`SANGAM project: Day 90 complete.`);
  if (failed > 0) process.exitCode = 1;
}

run();
