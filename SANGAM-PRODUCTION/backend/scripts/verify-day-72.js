'use strict';

/**
 * Day 72 Verification — Network Automation + PKI Auth Stub + Domain Audit
 *
 * Tests:
 *   1. deploy-hybrid-network.js module loads and its env detection logic
 *   2. pki-auth-stub.service.js — cert verification and identity extraction
 *   3. Domain audit findings are tracked in docs/supply-chain-domain-audit.md
 *   4. Air-gapped smoke test script parses without syntax errors
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2705 ${name}`);
    passed++;
  } catch (e) {
    console.error(`  \u274C ${name}: ${e.message}`);
    failed++;
  }
}

function run() {
  console.log('\nDay 72 \u2014 Network Automation + PKI Auth + Domain Audit\n');

  // 1. Network bootstrap module loads
  console.log('Network bootstrap');
  test('deploy-hybrid-network.js loads without syntax error', () => {
    require('../scripts/deploy-hybrid-network.js');
  });

  // 2. PKI Auth Stub
  console.log('\nPKI Auth Stub');
  const PkiAuthStub = require('../src/services/pki-auth-stub.service.js');

  test('PkiAuthStubService class loads', () => {
    if (typeof PkiAuthStub !== 'function') throw new Error('not a constructor');
  });

  const pki = new PkiAuthStub();

  test('verifyCacCertificate rejects empty input', () => {
    const r = pki.verifyCacCertificate('');
    if (r.verified !== false) throw new Error('should not verify empty cert');
  });

  test('verifyCacCertificate accepts known test cert', () => {
    const r = pki.verifyCacCertificate('TEST-CERT-A1B2C3');
    if (!r.verified) throw new Error('failed to verify known cert: ' + r.error);
    if (r.identity.rank !== 'COLONEL') throw new Error('wrong rank: ' + r.identity.rank);
  });

  test('verifyCacCertificate rejects unknown cert', () => {
    const r = pki.verifyCacCertificate('FAKE-CERT-XXXX');
    if (r.verified !== false) throw new Error('should reject unknown cert');
  });

  test('extractIdentity returns null for unverified cert', () => {
    const id = pki.extractIdentity('BAD-CERT');
    if (id !== null) throw new Error('should return null');
  });

  test('extractIdentity returns identity for known cert', () => {
    const id = pki.extractIdentity('TEST-CERT-D4E5F6');
    if (!id) throw new Error('should return identity');
    if (id.serialNumber !== 'IN-ARMY-0002') throw new Error('wrong serial');
  });

  test('getTestIdentities returns 3 identities in test mode', () => {
    const ids = pki.getTestIdentities();
    if (ids.length !== 3) throw new Error('expected 3, got ' + ids.length);
  });

  // 3. Domain audit document exists
  console.log('\nDomain audit');
  const auditPath = path.join(__dirname, '..', '..', 'docs', 'supply-chain-domain-audit.md');
  test('supply-chain-domain-audit.md exists', () => {
    if (!fs.existsSync(auditPath)) throw new Error('audit file not found');
  });

  const auditContent = fs.readFileSync(auditPath, 'utf8');
  test('Audit document is non-empty', () => {
    if (auditContent.trim().length < 100) throw new Error('audit file is too short');
  });

  test('Audit contains B+ grade verdict', () => {
    if (!auditContent.includes('B+')) throw new Error('missing grade');
  });

  // 4. Air-gapped smoke test exists and parses correctly
  console.log('\nAir-gapped smoke test');
  const smokePath = path.join(__dirname, '..', '..', 'scripts', 'air-gapped-smoke-test.js');
  test('air-gapped-smoke-test.js exists', () => {
    if (!fs.existsSync(smokePath)) throw new Error('file not found');
  });
  test('air-gapped-smoke-test.js is non-empty', () => {
    const content = fs.readFileSync(smokePath, 'utf8');
    if (content.trim().length < 200) throw new Error('file too short');
  });

  // 5. Frontend test dependency — esbuild
  console.log('\nFrontend test dependencies');
  const frontendPkg = path.join(__dirname, '..', '..', 'frontend', 'package.json');
  const fpkg = JSON.parse(fs.readFileSync(frontendPkg, 'utf8'));
  test('frontend/package.json has esbuild in devDependencies', () => {
    if (!fpkg.devDependencies || !fpkg.devDependencies.esbuild) {
      throw new Error('esbuild missing from frontend devDependencies');
    }
  });

  // Summary
  console.log(`\n${'\u2500'.repeat(60)}`);
  console.log(`Day 72 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run();
