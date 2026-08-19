'use strict';

/**
 * Day 70 Verification — Security Audit Outcomes + Frontend Test Wiring
 *
 * Makes this day's two outcomes machine-checkable rather than only
 * prose-documented:
 *   A. postcss was upgraded to a patched version (the one npm-audit
 *      finding that was safe to fix without a breaking change).
 *   B. `npm run test:frontend` is wired into the root test:all script,
 *      so the frontend suite (previously silently stale for an unknown
 *      number of days) can never drop out of the regression gate again
 *      without this check itself failing.
 *   C. The specific stale references that were broken (TopBar.jsx,
 *      "Command Login"/"Log In" text) are confirmed gone from the
 *      frontend test file, and the actual current equivalents are
 *      confirmed present in the real components — a regression guard
 *      against re-introducing the same kind of drift silently.
 *
 * Deliberately does NOT re-assert the react-router/esbuild deferral
 * decision as a pass/fail check — that was a documented risk judgment
 * call, not a bug fix, and hard-coding "these vulnerabilities must
 * still exist" as a test would be a strange thing to assert (the
 * moment they're fixed for real, this would need to change anyway).
 * See the Day 70 handoff notes for that reasoning instead.
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function run() {
  console.log('\n🔒 Group A: postcss patched');
  const postcssPkg = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../frontend/node_modules/postcss/package.json'), 'utf8'
  ));
  const [maj, min, patch] = postcssPkg.version.split('.').map(Number);
  // Vulnerable range was <=8.5.17; patched versions are 8.5.18+.
  const isPatched = maj > 8 || (maj === 8 && min > 5) || (maj === 8 && min === 5 && patch >= 18);
  check(`A-01 postcss is patched (installed: ${postcssPkg.version}, need >=8.5.18)`, isPatched);

  console.log('\n🔌 Group B: frontend test wired into test:all');
  const rootPkg = fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8');
  const testAllLine = JSON.parse(rootPkg).scripts['test:all'];
  check('B-01 test:all includes npm run test:frontend', testAllLine.includes('npm run test:frontend'));
  check('B-02 test:frontend script exists and points at the frontend suite', JSON.parse(rootPkg).scripts['test:frontend'] === 'cd frontend && npm test');

  console.log('\n🧹 Group C: stale references fixed, not just deleted');
  const frontendTestSrc = fs.readFileSync(
    path.join(__dirname, '../../frontend/scripts/verify-day-27.cjs'), 'utf8'
  );
  check('C-01 no remaining reference to the nonexistent TopBar.jsx', !frontendTestSrc.includes("loadComponent('components/TopBar.jsx')"));
  check('C-02 no remaining assertion on the stale "Command Login" title', !frontendTestSrc.includes('Command Login'));
  check('C-03 LoginPage assertion now checks the real current wordmark', frontendTestSrc.includes('SANGAM') && frontendTestSrc.includes('wordmark'));

  const sidebarSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/Sidebar.jsx'), 'utf8');
  check('C-04 Sidebar.jsx (TopBar\'s real successor) actually contains the wordmark, confirming the removal reasoning was correct, not guessed', sidebarSrc.includes('SANGAM'));
  const loginSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/LoginPage.jsx'), 'utf8');
  check('C-05 LoginPage.jsx actually contains "AUTHENTICATE", confirming the updated assertion matches real current content', loginSrc.includes('AUTHENTICATE'));

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 70 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
