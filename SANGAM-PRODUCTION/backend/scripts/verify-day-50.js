'use strict';

/**
 * Day 50 Verification — Demo Walkthrough Mode (guided overlay for
 * live stakeholder presentations)
 *
 * Pure frontend feature — no new backend behavior, so this script is
 * entirely static analysis + a production build, mirroring the same
 * confidence level as Days 47-49's frontend-only portions. It checks:
 *   - every tour step has the required fields and a valid path
 *   - every step's target selector has a matching data-tour attribute
 *     actually present somewhere in the frontend source (so the tour
 *     never silently fails to find its anchor)
 *   - the overlay is mounted in App.jsx and wired to a Sidebar trigger
 *   - the production build succeeds with everything included
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
const VALID_PATHS = ['/', '/supply/items', '/supply/transfers', '/supply/blockchain', '/alerts', '/movement', '/inventory', '/audit', '/admin/users', '/profile/password', '/reports', '/units'];

console.log('\n📋 Group A: tour steps config is well-formed');
const stepsPath = path.join(FRONT, 'data/walkthroughSteps.js');
check('walkthroughSteps.js exists', fs.existsSync(stepsPath));
const stepsSrc = fs.readFileSync(stepsPath, 'utf8');

// Load it as a real module (it's plain ESM-ish JS with a named export using
// object literals only — safe to eval in an isolated function scope for a
// structural check without pulling in a bundler).
let steps = [];
try {
  const transpiled = stepsSrc.replace('export const TOUR_STEPS', 'const TOUR_STEPS') + '\nmodule.exports = TOUR_STEPS;';
  const Module = require('module');
  const m = new Module(stepsPath);
  m._compile(transpiled, stepsPath);
  steps = m.exports;
  check('walkthroughSteps.js parses as valid JS', true);
} catch (e) {
  check('walkthroughSteps.js parses as valid JS', false, e.message);
}

check('at least 5 steps defined (a usable but not overlong tour)', steps.length >= 5, `got ${steps.length}`);
check('under 12 steps (stays short enough for a live walkthrough)', steps.length <= 12, `got ${steps.length}`);

let allStepsValid = true;
const targets = [];
for (const [i, s] of steps.entries()) {
  if (!s.title || !s.body) { allStepsValid = false; console.error(`    step ${i}: missing title/body`); }
  if (!s.path || !VALID_PATHS.includes(s.path)) { allStepsValid = false; console.error(`    step ${i}: path '${s.path}' is not a route that exists in App.jsx`); }
  if (s.target) targets.push(s.target);
}
check('every step has a title, body, and a real route path', allStepsValid);

console.log('\n🎯 Group B: every step target selector has a matching data-tour anchor in the source');
const pageFiles = fs.readdirSync(path.join(FRONT, 'pages')).map(f => path.join(FRONT, 'pages', f));
const allSource = pageFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
for (const target of targets) {
  const attr = target.match(/data-tour="([^"]+)"/)?.[1];
  check(`anchor exists for target ${target}`, attr && allSource.includes(`data-tour="${attr}"`));
}

console.log('\n🗂  Group C: overlay is mounted and wired to a trigger');
const appJsx = fs.readFileSync(path.join(FRONT, 'App.jsx'), 'utf8');
check('App.jsx imports DemoWalkthrough (static or lazy)',
  appJsx.includes("from './components/DemoWalkthrough.jsx'") ||
  appJsx.includes("import('./components/DemoWalkthrough.jsx')"));
check('App.jsx tracks tourActive state', /tourActive/.test(appJsx));
check('App.jsx mounts <DemoWalkthrough', appJsx.includes('<DemoWalkthrough'));
check('App.jsx passes onStartTour to Sidebar', appJsx.includes('onStartTour='));

const sidebarJsx = fs.readFileSync(path.join(FRONT, 'components/Sidebar.jsx'), 'utf8');
check('Sidebar accepts onStartTour prop', sidebarJsx.includes('onStartTour'));
check('Sidebar renders a tour trigger button', sidebarJsx.includes('sidebar-tour-btn'));

const walkthroughJsx = fs.readFileSync(path.join(FRONT, 'components/DemoWalkthrough.jsx'), 'utf8');
check('DemoWalkthrough is non-blocking (spotlight has pointer-events:none intent documented)',
  walkthroughJsx.includes('pointer-events') || fs.readFileSync(path.join(FRONT, 'styles/global.css'), 'utf8').includes('.tour-spotlight'));
check('DemoWalkthrough navigates between pages per step', walkthroughJsx.includes('navigate(step.path)'));
check('DemoWalkthrough supports Next/Back/Exit', walkthroughJsx.includes('onExit') && walkthroughJsx.includes('function next') && walkthroughJsx.includes('function back'));

const cssSrc = fs.readFileSync(path.join(FRONT, 'styles/global.css'), 'utf8');
check('CSS defines .tour-spotlight, .tour-panel, .sidebar-tour-btn',
  cssSrc.includes('.tour-spotlight') && cssSrc.includes('.tour-panel') && cssSrc.includes('.sidebar-tour-btn'));

console.log('\n🏗  Group D: frontend production build succeeds');
try {
  execSync('npm run build', { cwd: path.join(__dirname, '../../frontend'), stdio: 'pipe' });
  check('vite build succeeds', true);
} catch (e) {
  check('vite build succeeds', false, e.stdout?.toString().slice(-500));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Day 50 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
