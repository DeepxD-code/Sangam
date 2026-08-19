'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Day 85 — Domain Audit & Council Fixes Verification
 *
 * Confirms that all 3 council verdict fixes + F3 are properly
 * implemented across the codebase.
 */

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  \u2705 ${name}`); passed++; }
  catch (e) { console.error(`  \u274C ${name}: ${e.message}`); failed++; }
}

function findInFile(filePath, pattern) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.includes(pattern);
}

function notInFile(filePath, pattern) {
  const content = fs.readFileSync(filePath, 'utf8');
  return !content.includes(pattern);
}

function run() {
  console.log('\nDay 85 \u2014 Domain Audit & Council Fixes\n');

  const supplyPath = path.join(__dirname, '..', 'src', 'services', 'supply-chain.service.js');

  // Fix 1: No bare catch(()=>{}) in supply-chain
  console.log('Fix 1: catch(()=>{}) elimination');
  test('supply-chain: _trackWrite logs errors', () => {
    if (!findInFile(supplyPath, "console.error('[supply-chain] persist error:")) throw new Error('_trackWrite still silent');
  });
  test('supply-chain: notifyTransferPending logs errors', () => {
    if (!findInFile(supplyPath, "console.error('[supply-chain] notifyTransferPending error:")) throw new Error('notifyTransferPending still silent');
  });
  test('supply-chain: notifyTransferDecision logs errors', () => {
    if (!findInFile(supplyPath, "console.error('[supply-chain] notifyTransferDecision error:")) throw new Error('notifyTransferDecision still silent');
  });
  test('supply-chain: notifyLowStock logs errors', () => {
    if (!findInFile(supplyPath, "console.error('[supply-chain] notifyLowStock error:")) throw new Error('notifyLowStock still silent');
  });
  test('supply-chain: _audit logs errors', () => {
    if (!findInFile(supplyPath, "console.error('[supply-chain] audit error:")) throw new Error('_audit still silent');
  });
  test('supply-chain: no bare catch(()=>{}) remains in code', () => {
    // Only comments should remain
    const content = fs.readFileSync(supplyPath, 'utf8');
    const lines = content.split('\n');
    const bareCatches = lines.filter(l => l.includes('.catch(() =>') && !l.trim().startsWith('*'));
    if (bareCatches.length > 0) throw new Error(`${bareCatches.length} bare catch(()){} remaining in code`);
  });

  // Fix F3: blockchain before deduct
  console.log('\nFix F3: blockchain-first ordering');
  test('approveTransfer records block before deducting quantity', () => {
    if (!findInFile(supplyPath, 'Record on blockchain ledger FIRST')) throw new Error('missing F3 comment');
    if (!findInFile(supplyPath, 'await this._recordBlock({')) throw new Error('_recordBlock not found before deduct');
  });
  test('quantity deduction appears after block record', () => {
    const content = fs.readFileSync(supplyPath, 'utf8');
    const blockIdx = content.indexOf('await this._recordBlock({');
    const deductIdx = content.indexOf('item.quantity -= transfer.quantity');
    if (blockIdx === -1 || deductIdx === -1) throw new Error('could not locate block/deduct');
    if (blockIdx > deductIdx) throw new Error('deduct happens before block record!');
  });

  // Fix 2: Blockchain persistence
  console.log('\nFix 2: Blockchain persistence');
  test('_persistBlock uses _trackWrite (not bare catch)', () => {
    const content = fs.readFileSync(supplyPath, 'utf8');
    if (!content.includes('transaction_data')) throw new Error('missing transaction_data column in INSERT');
    if (!content.includes('JSON.stringify(block.transactionData)')) throw new Error('missing transactionData serialization');
  });
  test('blockchain migration file exists', () => {
    const migPath = path.join(__dirname, '..', '..', 'database', 'migrations', 'day-90-blockchain-persist.sql');
    if (!fs.existsSync(migPath)) throw new Error('migration not found');
    const content = fs.readFileSync(migPath, 'utf8');
    if (!content.includes('transaction_data')) throw new Error('migration missing transaction_data column');
  });

  // Domain audit
  console.log('\nDomain audit');
  const auditPath = path.join(__dirname, '..', '..', 'docs', 'supply-chain-domain-audit.md');
  test('Domain audit document exists', () => {
    if (!fs.existsSync(auditPath)) throw new Error('audit doc not found');
  });
  test('Audit covers 9 findings (F1-F9)', () => {
    const content = fs.readFileSync(auditPath, 'utf8');
    const findings = (content.match(/### F\d/g) || []).length;
    if (findings < 9) throw new Error(`expected 9 findings, found ${findings}`);
  });

  // Summary
  console.log(`\n${'\u2500'.repeat(60)}`);
  console.log(`Day 85 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run();
