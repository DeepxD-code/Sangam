'use strict';
const { execSync } = require('child_process');
const path = require('path');

const days = [
  11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,28,30,
  31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,
  49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,
  67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,
  85,86,87,88,89,90
];

const contracts = [
  'verify-scope-contract.js',
  'verify-actor-attribution-contract.js',
  'verify-notification-wiring-contract.js',
  'verify-rbac-contract.js'
];

let passed = 0, failed = 0;

function run(desc, cmd) {
  try {
    execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    passed++;
  } catch {
    console.error(`\nFAILED: ${desc}`);
    failed++;
  }
}

console.log('SANGAM Full Test Suite (Days 11-90)\n');

for (const d of days) {
  const label = `Day ${d}`;
  run(label, `node backend/scripts/verify-day-${d}.js`);
}

for (const c of contracts) {
  const label = `Contract: ${c}`;
  run(label, `node backend/scripts/${c}`);
}

// Frontend
console.log('\n--- Frontend Tests ---\n');
try {
  execSync('npm test', { stdio: 'inherit', cwd: path.join(__dirname, '..', 'frontend') });
  passed++;
} catch {
  console.error('FAILED: frontend tests');
  failed++;
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} test groups passed`);
if (failed > 0) {
  console.error(`${failed} group(s) failed`);
  process.exitCode = 1;
} else {
  console.log('ALL TESTS PASSED');
}
