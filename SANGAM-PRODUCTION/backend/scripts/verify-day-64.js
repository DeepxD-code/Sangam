'use strict';

/**
 * Day 64 Verification — Accessibility: Contrast Audit + Keyboard Polish
 *
 * Three things were built this day:
 *   1. Modal.jsx: focus trap (Tab/Shift+Tab now cycle within an open
 *      modal instead of escaping to the page behind it) + focus
 *      restoration (closing a modal returns focus to whatever triggered
 *      it). Reused by TransferListPage, DelegationPage,
 *      UserManagementPage, etc. — fixing it once helps everywhere.
 *   2. KeyboardShortcuts.jsx: "g then a letter" navigation + "?" help
 *      overlay, ignored while typing in any input/textarea/select.
 *   3. Two real, pre-existing color issues found via computed WCAG
 *      contrast ratios (not eyeballing): --border-dim was referenced
 *      12+ times since before Day 55 but never defined (silently a
 *      no-op the whole time), and --status-critical failed WCAG AA even
 *      at the 3:1 "large text" threshold (2.83:1 against bg-surface) —
 *      used as literal small text/pill color in many places. Both fixed
 *      at the single :root definition, so the fix cascades everywhere
 *      automatically rather than needing per-usage changes.
 *
 * No component-testing framework exists in this project (confirmed —
 * grep of both package.json files for jest/vitest/testing-library/jsdom
 * returns nothing), consistent with its real-HTTP-only testing
 * philosophy. This script therefore covers what's genuinely testable at
 * that layer: the contrast math itself (as a permanent regression guard
 * against future color changes going backward) and a general-purpose
 * "every var(--x) reference has a matching --x: definition" sweep — the
 * exact check that would have caught --border-dim automatically, had it
 * existed earlier. Modal's focus trap and the keyboard shortcut
 * interaction logic are NOT covered here — verified via code review and
 * manual behavior tracing only, not automated. Stating this plainly
 * rather than claiming coverage that doesn't exist.
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else    { console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function relLuminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
function contrastRatio(hex1, hex2) {
  const l1 = relLuminance(hexToRgb(hex1));
  const l2 = relLuminance(hexToRgb(hex2));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

async function run() {
  const cssPath = path.join(__dirname, '../../frontend/src/styles/global.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // ── Group A: no undefined CSS custom properties ──────────────
  // General-purpose sweep, not specific to the two colors this day
  // happened to fix — catches the whole bug class going forward.
  console.log('\n🎨 Group A: every var(--x) has a matching --x: definition');
  {
    // Strip CSS comments first — otherwise example/explanatory text
    // inside a /* ... */ comment (like this file's own Day 64 notes)
    // can produce false-positive matches.
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set([...cssNoComments.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map(m => m[1]));

    // Only var(--x) usages WITHOUT a fallback are actually unsafe —
    // var(--x, someFallback) degrades gracefully by design even if --x
    // is never defined (this project uses that pattern deliberately in
    // a few places, e.g. --radius-sm, --text-muted, --bg-card).
    const usedNoFallback = new Set(
      [...cssNoComments.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)].map(m => m[1])
    );
    const undefinedVars = [...usedNoFallback].filter(v => !defined.has(v));
    console.log(`  ℹ ${defined.size} custom properties defined, ${usedNoFallback.size} referenced WITHOUT a fallback (the ones that matter for this check)`);
    check('A-01 no fallback-less var(--x) reference lacks a matching --x: definition (this exact check would have caught the --border-dim bug)',
      undefinedVars.length === 0, `undefined: ${undefinedVars.join(', ')}`);
  }

  // ── Group B: computed WCAG contrast — the current values ─────
  console.log('\n📐 Group B: WCAG AA contrast ratios (computed, not eyeballed)');
  const colorDefs = {};
  for (const m of css.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/gm)) {
    colorDefs[m[1]] = m[2];
  }
  check('B-01 --border-dim is now defined', !!colorDefs['--border-dim'], JSON.stringify(colorDefs['--border-dim']));
  check('B-02 --status-critical is defined', !!colorDefs['--status-critical']);

  const backgrounds = ['--bg-deep', '--bg-surface', '--bg-surface-2'];
  const statusColors = ['--status-critical', '--status-good', '--status-warn'];
  for (const bg of backgrounds) {
    for (const fg of statusColors) {
      if (!colorDefs[bg] || !colorDefs[fg]) continue;
      const ratio = contrastRatio(colorDefs[bg], colorDefs[fg]);
      // 3:1 is WCAG AA's floor even for large text/UI components — the
      // bar Day 64's fix specifically targeted for status-critical,
      // which previously fell below it.
      check(`B-03 ${fg} on ${bg}: ${ratio.toFixed(2)}:1 clears the WCAG AA large-text/UI floor (>=3:1)`,
        ratio >= 3, `got ${ratio.toFixed(2)}:1`);
    }
  }
  {
    // status-critical specifically needed to clear the stricter 4.5:1
    // normal-text bar, since it's used for small pill/badge text.
    const ratio = contrastRatio(colorDefs['--bg-surface'], colorDefs['--status-critical']);
    check('B-04 --status-critical on --bg-surface clears the stricter 4.5:1 normal-text AA bar (was 2.83:1 before Day 64)',
      ratio >= 4.5, `got ${ratio.toFixed(2)}:1`);
  }

  // ── Group C: primary text remains excellent (regression check) ──
  console.log('\n📖 Group C: primary/secondary text contrast unaffected (regression check)');
  {
    const ratio = contrastRatio(colorDefs['--bg-surface'], colorDefs['--text-primary']);
    check('C-01 --text-primary on --bg-surface still comfortably exceeds AA (untouched by this day\'s changes)',
      ratio >= 7, `got ${ratio.toFixed(2)}:1`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 64 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
