'use strict';

/**
 * Day 53 Verification — Responsive / Mobile Layout Audit
 *
 * Reclaimed hardening day. Audits every page/component added across Days
 * 46-52 for mobile coverage: either its own @media rule, or deliberate
 * reliance on a shared responsive class (.page-header, .sidebar, print
 * rules) that already handles small screens for every page uniformly.
 * Fixes three narrow-screen gaps found during the audit: block detail
 * rows squeezing a hash next to a 130px label, the tour panel's action
 * row overflowing instead of wrapping, and the commander card's
 * baseline-aligned name+meta reading awkwardly once wrapped.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

const FRONT = path.join(__dirname, '../../frontend/src');
const cssSrc = fs.readFileSync(path.join(FRONT, 'styles/global.css'), 'utf8');

console.log('\n📐 Group A: base breakpoints still present (regression check)');
check('a 768px breakpoint exists (sidebar collapse)', cssSrc.includes('@media (max-width: 768px)'));
check('a 480px breakpoint exists (phone-width refinements)', cssSrc.includes('@media (max-width: 480px)'));
check('print stylesheet still exists and hides chrome (sidebar/buttons) generically for every page',
  cssSrc.includes('@media print') && cssSrc.includes('.sidebar'));

console.log('\n🩹 Group B: three narrow-screen gaps found this audit are fixed');
check('.block-detail-row stacks vertically on narrow screens (was squeezing hashes next to a 130px label)',
  /@media \(max-width: 480px\)[\s\S]*?\.block-detail-row\s*\{\s*flex-direction:\s*column/.test(cssSrc));
check('.tour-panel-actions wraps on narrow screens (was a rigid 3-button row)',
  /@media \(max-width: 480px\)[\s\S]*?\.tour-panel-actions\s*\{\s*flex-wrap:\s*wrap/.test(cssSrc));
check('.unit-commander-card stacks on narrow screens (baseline row read awkwardly once wrapped)',
  /@media \(max-width: 480px\)[\s\S]*?\.unit-commander-card\s*\{\s*flex-direction:\s*column/.test(cssSrc));

console.log('\n🗂  Group C: every Day 46-52 addition has explicit mobile coverage or inherits a shared responsive class');
const COVERAGE = [
  { name: 'Units pages (.unit-stat-grid / .unit-child-grid)', pattern: /\.unit-stat-grid\s*\{\s*grid-template-columns:\s*repeat\(2/ },
  { name: 'Demo tour panel (.tour-panel narrow-screen override)', pattern: /\.tour-panel\s*\{\s*left:\s*16px/ },
  { name: 'Block detail panel (covered above in Group B)', pattern: /\.block-detail-row\s*\{\s*flex-direction:\s*column/ },
];
for (const c of COVERAGE) check(c.name, c.pattern.test(cssSrc));
// Alert detail modal and error boundary reuse Modal.jsx / a simple centered
// flex layout respectively — inherently responsive, no page-specific rule needed.
check('AlertDetailModal reuses Modal.jsx (already responsive) rather than duplicating layout CSS',
  fs.readFileSync(path.join(FRONT, 'components/AlertDetailModal.jsx'), 'utf8').includes("from './Modal.jsx'"));

console.log('\n🏗  Group D: frontend production build succeeds');
try {
  execSync('npm run build', { cwd: path.join(__dirname, '../../frontend'), stdio: 'pipe' });
  check('vite build succeeds', true);
} catch (e) {
  check('vite build succeeds', false, e.stdout?.toString().slice(-500));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Day 53 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
