'use strict';

/**
 * Day 52 Verification — Error Boundary + Accessibility Pass
 *
 * Reclaimed hardening day (see handoff notes: Days 52-55 replace the
 * original "stakeholder feedback iteration" placeholder, since no live
 * stakeholder session has happened yet — there is no real feedback to
 * iterate on, so these days do concrete pre-demo hardening instead).
 *
 * This day adds the one production-resilience gap the app genuinely had:
 * no error boundary anywhere, meaning any render-time exception in any
 * single page or widget would blank the entire app mid-demo with no
 * recovery path. Also closes a couple of small, verifiable accessibility
 * gaps: a skip-to-content link, and confirms the pre-existing Modal
 * focus-trap/Escape-to-close behavior is still intact.
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

console.log('\n🛡  Group A: ErrorBoundary component');
const ebPath = path.join(FRONT, 'components/ErrorBoundary.jsx');
check('ErrorBoundary.jsx exists', fs.existsSync(ebPath));
const ebSrc = fs.readFileSync(ebPath, 'utf8');
check('ErrorBoundary is a class component (required — no Hooks equivalent exists)',
  /class ErrorBoundary extends React\.Component/.test(ebSrc));
check('ErrorBoundary implements getDerivedStateFromError', ebSrc.includes('getDerivedStateFromError'));
check('ErrorBoundary implements componentDidCatch (logs to console for developers)', ebSrc.includes('componentDidCatch'));
check('ErrorBoundary offers a recovery action, not just a dead end', ebSrc.includes('Try Again') || ebSrc.includes('handleReload'));

console.log('\n🔌 Group B: wired at both the shell level and the per-page level');
const appJsx = fs.readFileSync(path.join(FRONT, 'App.jsx'), 'utf8');
check('App.jsx imports ErrorBoundary', appJsx.includes("from './components/ErrorBoundary.jsx'"));
const boundaryCount = (appJsx.match(/<ErrorBoundary/g) || []).length;
check('at least 2 ErrorBoundary instances (shell-level + per-page, so a page crash cannot take the sidebar down too)',
  boundaryCount >= 2, `found ${boundaryCount}`);
check('the per-page boundary wraps the Suspense/Routes block',
  /<ErrorBoundary[^>]*>[\s\S]*<Suspense[^>]*>[\s\S]*<Routes>/.test(appJsx));

console.log('\n♿ Group C: accessibility — skip link + pre-existing Modal a11y is intact');
check('a skip-to-content link exists', appJsx.includes('skip-link') && appJsx.includes('#main-content'));
check('main content target is focusable (tabIndex) so the skip link actually moves focus',
  /id="main-content"[^>]*tabIndex=\{?-1\}?/.test(appJsx) || /tabIndex=\{?-1\}?[^>]*id="main-content"/.test(appJsx));

const modalSrc = fs.readFileSync(path.join(FRONT, 'components/Modal.jsx'), 'utf8');
check('Modal still traps focus on open', modalSrc.includes('focus()'));
check('Modal still closes on Escape', modalSrc.includes("'Escape'"));
check('Modal still has role=dialog + aria-modal', modalSrc.includes('role="dialog"') && modalSrc.includes('aria-modal'));

console.log('\n🎨 Group D: CSS for the new elements exists');
const cssSrc = fs.readFileSync(path.join(FRONT, 'styles/global.css'), 'utf8');
check('CSS defines .error-boundary-screen', cssSrc.includes('.error-boundary-screen'));
check('CSS defines .skip-link with a focus-visible state', cssSrc.includes('.skip-link') && cssSrc.includes(':focus'));

console.log('\n🏗  Group E: frontend production build succeeds');
try {
  execSync('npm run build', { cwd: path.join(__dirname, '../../frontend'), stdio: 'pipe' });
  check('vite build succeeds', true);
} catch (e) {
  check('vite build succeeds', false, e.stdout?.toString().slice(-500));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Day 52 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
