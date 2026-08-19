# SANGAM Day 56-80 — Running Progress Tracker (scratch file, not a deliverable)

Working dir: /home/claude/SANGAM-PRODUCTION/
Baseline: Day 55, 1,716 tests passing, verified against uploaded zip before any changes.
Day 65 baseline (re-verified fresh from the Day 65 production zip before touching
anything for Day 66+): 1,920/1,920 passing, 57 scripts, 0 failures. Confirmed by
actually running `npm install` + `npm run test:all` from a clean extract, not
assumed from the handoff doc alone.

IMPORTANT FRAMING (do not lose this on context trim):
Day 55 handoff explicitly flagged Day 60 as planned "Demo Day" and Days 61-90
as "real stakeholder feedback iteration," with an explicit warning not to
fabricate either. No evidence a real demo has occurred. Treating Day 60 as a
DEMO READINESS checkpoint (not a fabricated event) and Days 61-65 as continued
concrete hardening (not invented feedback). Told to user already — don't
re-litigate, just keep building honestly.

## Status by day

- [x] Day 56 — CompliancePage.jsx (chain of custody, discrepancy report, transfer
      register, audit export, summary). Surfaces Day-20 ComplianceService which had
      zero frontend surface. Files: frontend/src/pages/CompliancePage.jsx (new),
      frontend/src/api/client.js (+6 methods), App.jsx (+route), Sidebar.jsx (+nav,
      minRankLevel:4 heuristic — real gating is per-tab server 403, see page header
      comment re: non-monotonic reports:advanced). verify-day-56.js: 40/40 passing.
      Full suite after: 1,756/1,756 passing (46 scripts). package.json test:all
      already includes day 56.

- [x] Day 57 — DelegationPage.jsx (delegate authority, emergency override, review
      queue). Surfaces Day-15 DelegationService, also zero frontend surface.
      Files: frontend/src/pages/DelegationPage.jsx (new, 4 tabs: My Delegations /
      Granted By Me + New Delegation modal / Emergency Override / Review Queue),
      client.js (+8 methods), App.jsx (+route), Sidebar.jsx (+nav, NO minRankLevel
      — unlike Compliance, delegation/override creation is open to every role;
      only Review Queue tab needs audit:read, handled via per-tab 403 same as
      Day 56). verify-day-57.js: 33/33 passing. Full suite: 1,789/1,789 (47
      scripts). package.json test:all updated to include day 57.

- [x] Day 58 — Notification digest + preferences (handoff's own candidate list).
      Extended NotificationBell.jsx with a 3-way view switcher (🔔 recent /
      📊 digest / ⚙ settings) rather than a new page, since this is inherently
      part of the existing bell dropdown. client.js (+3 methods), global.css
      (+Day 58 section). verify-day-58.js: 17/17 passing.
      ⚠ SIGNIFICANT BUG FOUND & FIXED (not introduced by Day 58 — pre-existing
      since Day 42): notification.routes.js's factory only declared
      `(db, sharedAudit)`, silently dropping the shared NotificationService
      instance app.js has always passed as a 3rd argument. JS doesn't error on
      unused extra args, so the routes quietly built their OWN disconnected
      NotificationService. Practical effect: notifications triggered by real
      actions (low stock, transfer decisions, etc., via the shared instance
      every OTHER service uses) never reached the HTTP notification endpoints
      for ANY user, since Day 42 — GET /notifications, /unread-count, /digest
      were all silently empty of real system events. Found because Day 58's
      verify script was the first test to cross the boundary (create via
      shared instance → read via real HTTP). Fixed by adding
      `sharedNotifications = null` as a 3rd param + fallback, matching the
      already-correct pattern in delegation/reporting/supply/compliance
      routes.js (all independently confirmed correct via direct signature
      check — this was isolated to notification.routes.js only). Added
      permanent guard: verify-notification-wiring-contract.js (4/4 passing).
      Full suite: 1,810/1,810 (49 scripts, incl. new contract guard).

- [x] Day 59 — Three items, but #2 and #3 were significantly reprioritized after
      grounding checks found bigger real issues than originally planned:

      1. Dashboard tour-prompt: DashboardPage.jsx already received `onStartTour`
         via pageProps but never used it. Added a dismissible banner (brass
         left-border, localStorage-remembered dismissal — legitimate use here,
         this is the real deployed app, not a claude.ai artifact). CSS: new
         "DAY 59" section in global.css.

      2. ~~CSV column customization~~ → REPRIORITIZED. Found all 4 CSV export
         types (stock-levels/transfers/unit-roster/mesh-health) query Postgres
         directly and return `available:false` + empty rows when db is null —
         this app's PRIMARY default mode — with ReportsPage giving zero
         indication why, silently downloading 0-byte files. Fixed by checking
         GET /health (already existed, already reports db.connected) once on
         mount and disabling+labeling export buttons when disconnected, rather
         than building column-picker UI for a feature that's silently broken
         in the primary demo mode. client.js: +getHealth() (handles the
         intentional 503-when-disconnected status). global.css:
         .report-card-disabled.

      3. Demo-data reset → REPRIORITIZED into something more fundamental.
         ⚠ MAJOR FINDING: there was no working path AT ALL to get demo data
         into a real, running, browser-accessible server. `npm run seed:demo`
         builds its own disposable services (db=null, always, even with
         Postgres available) that vanish when the script exits — it can never
         affect a separately-running `npm start` process, since Node
         processes don't share memory. server.js had zero seeding hook.
         Confirmed via: (a) buildServices() hardcodes db=null for every
         service regardless of DATABASE_URL, (b) server.js's start() has no
         seedDemoData call anywhere, (c) services write-through to Postgres
         but never hydrate FROM it on construction (checked
         unit-management.service.js directly — no bootstrap/load method).
         Fixed: server.js now has an opt-in SEED_DEMO_DATA=true startup hook
         that calls seedDemoData(app.locals.services) directly — the actual
         live instances every route serves from — documented in .env.example.
         Also made seedDemoData() itself idempotent: detects prior seeding via
         the brigade's UNIT_CODE_EXISTS and skips cleanly instead of
         duplicating (this was the original, smaller "duplicate risk" finding
         from Day 55 grounding — folded into the bigger fix). "Reset the demo"
         = restart the process (in-memory state doesn't survive a restart
         regardless).
         ⚠ CAVEAT: the server.js + SEED_DEMO_DATA integration is NOT
         end-to-end tested — this sandbox has no real Postgres (network
         config only allows npm/pip/github domains, no DB ports), and
         server.js unconditionally requires a real DB connection to boot.
         Verified via careful code review + `node -c` syntax check +
         confirming every service seedDemoData touches (rbac, units, users,
         supply, notifications, movement, inventory, alerts) is present on
         app.locals.services with matching method signatures. The
         idempotency guard itself (seedDemoData called twice on the same
         services) IS fully tested — that part doesn't need Postgres.
         Deep should verify `SEED_DEMO_DATA=true npm start` (or the
         docker-compose equivalent) once against a real Postgres instance
         before relying on it for the actual demo. Flagging this prominently
         rather than claiming untested code is verified.

      verify-day-59.js: 11/11 passing (health contract + seeder idempotency
      — the two genuinely testable pieces). Full suite: 1,821/1,821 (50
      scripts).
- [x] Day 60 — RBAC edge-case tests + Demo Readiness Package.

      RBAC: found a THIRD documentation error while building this (after
      the JCO/reports:advanced one from Day 57) — my own Day 56/57 comments
      claimed SENIOR_OFFICER holds audit:export; it actually only holds
      audit:read (a different, overlapping-but-not-identical permission —
      audit:export = {AUDITOR, COMMANDER, SYSTEM_ADMIN} only, 3 roles, not
      the 4 I'd claimed). Neither Day 56 nor 57's tests happened to
      exercise SENIOR_OFFICER against either permission, so it went
      undetected. Fixed the comments in verify-day-57.js and built
      verify-rbac-contract.js (permanent guard): computes the
      ROLE_PERMISSIONS matrix programmatically rather than trusting
      hardcoded snapshots (catches typos, confirms SYSTEM_ADMIN has all 25
      permissions, confirms unique rank levels, computes the full
      non-monotonic permission set live — 7 total: supply:write,
      supply:delete, blockchain:write, reports:advanced, audit:read,
      audit:export, supply:export), plus real HTTP tests for the
      SENIOR_OFFICER distinction, JWT edge cases (missing/expired/
      malformed/tampered-signature/wrong-secret — zero prior coverage),
      and a full reports:advanced sweep across all 9 roles (not just the 2
      Day 56 happened to use). 22/22 passing.

      Demo Readiness Package:
      - verify-day-60.js: extends Day 55's original proven golden-path
        smoke test with the four days built since (Compliance, Delegation,
        Notification digest, Day 59 health check) in one continuous
        narrative against one server. 13/13 passing — the tested basis
        for the runbook's suggested flow, not an untested narrative.
      - SANGAM-DEMO-RUNBOOK.md — startup (docker-compose + bare npm start,
        both need SEED_DEMO_DATA=true per Day 59), login credentials, the
        proven 10-step demo flow, a rehearsal checklist, and an explicit
        restatement of the outstanding risk.
      - SANGAM-STAKEHOLDER-ONE-PAGER.md — external leave-behind: what it
        is/does/doesn't do yet (honest), why built this way, soft next step.

      Full suite: 1,856/1,856 (52 scripts, incl. verify-rbac-contract.js
      and verify-day-60.js as new permanent guards).

      Framing reminder (still true): readiness checkpoint, not a record
      that a real demo happened. Days 61-65 continue as concrete,
      verifiable hardening — not invented stakeholder feedback.

- [x] Day 61 — Rate limiting beyond login. Before this, `RateLimiter`
      (Day 22) was only ever applied to `/auth/login`. Added to the 4
      mutating bulk-operation endpoints (`/api/bulk/import-items,
      transfers, approve, update-quantity` — each can create/modify many
      records per call, a bigger abuse surface than any single-record
      endpoint) at 20/5min/user, and emergency override creation
      (`/api/delegation/overrides` — meant to be rare by design) at
      5/hour/user. Both keyed by authenticated user, not IP, matching the
      pattern of these routes already requiring a valid token.
      Own-test-bugs caught and fixed along the way (worth noting the
      pattern): my first pass at verify-day-61.js used the wrong URL
      (`/bulk/...` — copied from bulk.routes.js's own JSDoc comment,
      which was itself wrong; real mount is `/api/bulk`, confirmed
      against app.js and now fixed in the comment too) and the wrong
      request body shape (`adjustments` vs the real `updates` field,
      and expected 200 instead of the real 207 Multi-Status for partial-
      success bulk responses) — caught because I added a "first request
      actually reaches the handler" sanity check rather than just
      trusting "never got a 429" as proof the limiter works, which
      would have silently passed against a 404 the whole time.
      verify-day-61.js: 10/10 passing. Full suite: 1,866/1,866 (53 scripts).

- [x] Day 62 — Real UI pagination for Items/Transfers.

      Transfers: backend already had working limit/offset at both layers
      (confirmed before touching anything); only needed frontend wiring —
      replaced the flat `limit:100` with real PREV/NEXT page controls,
      reusing AuditLogPage's existing `.pagination`/`.pagination-info` CSS
      (not invented fresh).

      Items: a bigger, more significant gap than my Day 55-era note
      claimed ("pagination already exists on items/transfers/blockchain"
      — that was WRONG for items specifically, a note-accuracy mistake
      caught and now corrected). `getItemsInScope()` had NO limit/offset
      at any layer — route didn't parse the params, service returned the
      complete unbounded array unconditionally, always.
      ⚠ CAUGHT BEFORE SHIPPING: naively mirroring transfers' "default to
      50 if unspecified" pattern would have been a serious, silent
      regression — 6 internal callers (AlertEscalationService's low-stock
      scan, ComplianceService's discrepancy report + summary,
      InventoryLedgerService's stocktake setup ×2, DashboardService's
      summary widget) call getItemsInScope() with no limit and
      correctness-depend on getting the COMPLETE set; a truncated-to-50
      low-stock scan on a unit with 80 items would silently miss 30 of
      them. Fixed by making the SERVICE layer's pagination strictly
      opt-in (only applies when filters.limit is explicitly passed —
      internal callers never pass it, so they're byte-for-byte unaffected)
      while the ROUTE layer defaults to limit=50 for real HTTP consumers.
      verify-day-62.js's Group B specifically seeds 60 real items in one
      unit and proves internal-caller-shaped calls still return all 60.
      Frontend: ItemListPage + TransferListPage both get PAGE_SIZE=50,
      offset state (reset to page 1 on filter change), PREV/NEXT controls.
      client.js: getSupplyItems now forwards limit/offset (previously
      silently dropped them even if passed).

      verify-day-62.js: 13/13 passing. Full suite: 1,879/1,879 (54 scripts).

- [x] Day 63 — Admin snapshot export/restore for Units + Supply Items.

      Deliberately scoped narrow, not a full system backup: Users
      excluded (password hash round-tripping through JSON adds real
      security risk for little benefit), Transfers/Blockchain excluded
      (real state machines + an actual audit trail — naive replay/replace
      risks corrupting the hash chain or duplicating notifications),
      Notifications/audit log excluded (historical events, not state).
      This is "recover command structure + stock levels after a restart,"
      not a time machine — stated plainly in the route file's own header
      comment rather than implied.

      New: admin.routes.js (GET /api/admin/snapshot, POST
      /api/admin/restore, both system:admin/SYSTEM_ADMIN only). Added
      exportSnapshot()/restoreSnapshot() to UnitManagementService and
      exportItemsSnapshot()/restoreItemsSnapshot() to SupplyChainService
      — deliberately NOT reusing getUnitsInScope() (defaults to
      activeOnly:true, would silently drop deactivated units from a
      backup) or a filtered accessor for items; dedicated, unambiguous
      methods instead. Restore is a direct Map replacement preserving
      exact IDs (so item→unit references stay valid) and correctly
      advances each service's internal ID counter past the restored max
      so subsequent normal creates don't collide — this exact behavior
      is what verify-day-63.js's Group D specifically proves, not just
      assumed.

      verify-day-63.js: 16/16 passing, including a real mutate→restore→
      verify-exact-recovery round trip. Full suite: 1,895/1,895 (55
      scripts).

- [x] Day 64 — Accessibility + keyboard-shortcut polish.

      Modal.jsx (reused by TransferListPage/DelegationPage/
      UserManagementPage/etc. — fixed once, helps everywhere): added
      focus trap (Tab/Shift+Tab now cycle within an open modal instead of
      escaping to the page behind it) and focus restoration (closing
      returns focus to whatever triggered it — previously nothing did).

      New: KeyboardShortcuts.jsx — GitHub-style "g then letter" nav (g d
      = Dashboard, g i = Items, g t = Transfers, g b = Blockchain, g a =
      Alerts, g m = Movement, g v = Inventory, g r = Reports, g u =
      Units, g c = Compliance, g l = Delegation) + "?" help overlay.
      Fully ignored while focus is in any input/textarea/select/
      contentEditable, so it never interferes with typing.

      ⚠ TWO REAL PRE-EXISTING BUGS FOUND via a general-purpose "every
      var(--x) needs a matching --x: definition" sweep (not specific to
      any one color — this would catch the whole bug class going
      forward, now a permanent check in verify-day-64.js):
        1. --border-dim referenced 12+ times since BEFORE Day 55 (report-
           card hover, tab-active, etc.) but never defined anywhere —
           confirmed by directly checking the original Day 55 upload,
           not just the current state. Silently a no-op — hover/emphasis
           borders never actually changed color. Fixed: defined as
           #606C56 (chosen by computing contrast against the actual
           background tones, not eyeballed).
        2. --accent-gold (9 usages!), --bg-hover (3), --font-body (3),
           --bg-base (1) — also never defined, also pre-existing, also
           none introduced by Days 56-64. Fixed as aliases to
           already-defined, already-verified tokens (--accent-brass,
           --bg-surface-2, --font-ui, --bg-surface respectively) — no
           new colors invented, reusing what's already audited.
      ALSO found via computed (not eyeballed) WCAG contrast ratios:
      --status-critical (#B33A3A) failed WCAG AA even at the 3:1
      "large-text" floor (2.83:1 against --bg-surface) despite being
      used as literal small text/pill color in many places, including my
      own Day 56/57 severity indicators. Fixed: brightened to #E36868,
      which clears the stricter 4.5:1 normal-text bar against all three
      background tones — verified with the actual luminance formula, not
      approximated.

      No component-testing framework exists in this project (checked —
      no jest/vitest/testing-library/jsdom in either package.json),
      consistent with its real-HTTP-only testing philosophy. Modal's
      focus trap and the shortcut interaction logic are NOT covered by
      automated tests — verified via code review only, stated plainly
      rather than claiming coverage that doesn't exist. What IS
      automated: the contrast math (permanent regression guard against
      future color changes going backward) and the undefined-CSS-
      variable sweep.

      verify-day-64.js: 14/14 passing (one self-correction along the way
      — my first version of the undefined-variable check had two bugs of
      its own: it flagged fallback-having var(--x, y) usages as unsafe
      when they're actually fine by design, and it matched literal text
      inside my own explanatory CSS comment as if it were a real var()
      usage. Both fixed before trusting the result). Full suite:
      1,909/1,909 (56 scripts).

- [x] Day 65 — Final regression + SANGAM-HANDOFF-DAY65.md + production zip.
      (Note: this scratch file's own "NOT YET STARTED" marker was stale —
      corrected retroactively on Day 66. The actual handoff doc confirms
      completion: 1,920/1,920, 57 scripts. Trust the handoff doc / test
      output over this scratch file if they ever disagree.)

- [x] Day 66 — Fixed hierarchical command scope in offline mode. Investigated
      the "on the horizon" ID-alignment note from memory by reading the real
      code (not assuming) and found something more consequential than the
      note described: RBACService.getCommandScope() unconditionally
      collapsed to SELF-ONLY scope whenever db is null — this project's
      default, non-negotiable offline-first runtime mode. Every one of the
      1,920 Day-65 assertions runs with db=null, so this path had zero
      coverage: a Commander's scope never actually included subordinate
      units' data in the mode this system is built and demoed in.
      Root cause: the hierarchical expansion only existed as a SQL
      recursive CTE against command_units; there was no in-memory
      equivalent, and RBACService had no reference to the live
      UnitManagementService instance to fall back to.
      Fix: added UnitManagementService.getDescendantScope(unitId) (self +
      active descendants, mirrors the SQL CTE's {ids,codes} shape, with two
      DOCUMENTED deliberate divergences: self always included even if
      inactive/unfound — never scope a user below self — and codes/ids
      built via BFS with a cycle guard). Wired it to RBACService via a
      module-level static registry (RBACService.setSharedUnitService /
      getSharedUnitService / _resetSharedUnitService), NOT constructor
      injection — traced that `new RBACService(db)` is called ad-hoc in
      ~10 places (AuthMiddleware inside EVERY route factory, rbac.routes.js,
      4 services' default-fallback branches) and none of them share a
      single instance, so constructor DI would've required touching every
      route factory signature. A static registry set once in app.js (right
      after `units` is constructed) reaches every instance with a 3-line
      change. Verified safe for concurrent-instance risk: checked every
      verify-day-NN.js script that builds >1 app/server (17, 28, 59) and
      confirmed all are strictly sequential (build→listen→assert→close),
      never concurrent, so "last write wins" never crosses two live apps.
      Also traced (and did NOT touch): getChainOfCommand() has the same
      db=null→[] gap but ZERO callers anywhere in the live app — genuinely
      dead code, not a live bug, left alone rather than fixed-without-need.
      Also confirmed: the "inactive parent with active child" edge case
      (which would test getDescendantScope's per-level active filtering
      under stress) is provably UNREACHABLE through the real service API —
      deactivateUnit() refuses if active children exist, reactivateUnit()
      refuses if the parent is inactive — so it's correctly NOT tested as
      a live scenario (would've been testing an unreachable state).
      verify-day-66.js: 29/29 passing on first real run (Group A: direct
      getDescendantScope unit tests incl. multi-level, leaf, unknown-unit
      fallback parity, string-vs-number id; Group B: registration
      mechanics incl. unregistered/old-behavior-preserved, registered,
      malformed-registration defensive fallback; Group C: full HTTP
      integration via real /api/units + /api/supply/items calls proving
      a Commander at hierarchy root sees all descendants' units AND items,
      while a Commander at a leaf sees only their own — no upward or
      sideways leakage; Group D: a leaf unit deactivating correctly drops
      out of its parent's scope).
      Full regression: 1,949/1,949 (1,920 + 29 new), 0 failures, exit 0.
      Cross-checked EVERY individual day's pass count against the Day 65
      baseline log line-by-line — byte-identical across all 53 day
      scripts and all 4 contract guards; only new line is Day 66's own.
- [x] Day 67 — Fixed SQL command_units integrity + closed the "db-connected
      code path has zero test coverage" gap partially. Reframed the Day 66
      note about this being "lower priority, future-production-only": it
      is NOT — docker-compose.yml bundles a real local Postgres, so the
      SQL-CTE path (not Day 66's offline fallback) is what actually runs
      in the documented, intended demo deployment. server.js hard-requires
      DATABASE_URL unconditionally (exits(1) without it) — there is
      currently no way to boot this app via its own entry point without a
      real (if local) Postgres, so "offline-first" here means "no
      internet/cloud dependency," not "no database at all."
      PROVEN (not theorized) using pg-mem (in-memory Postgres engine,
      installed as a devDependency only — never imported by src/ code)
      running the ACTUAL production code (run-migrations.js, app.js,
      seed-demo-data.js) against real SQL semantics: the migration's
      hardcoded 12-unit seed ("21 Corps HQ"...) and the runtime demo
      seeder ("14 RR Brigade"...) both assign command_units ids starting
      at 1 for two entirely unrelated hierarchies. _dbWrite()'s
      `ON CONFLICT (id) DO UPDATE` then silently overwrote unit_name/
      active/location on the migration's rows while leaving unit_code/
      unit_type/parent_unit_id untouched — confirmed self-contradictory
      rows appearing on the very first simulated real-Postgres run (e.g.
      id=1 ended up with unit_code='CORPS-21' + unit_name='14 RAJPUTANA
      RIFLES BRIGADE'). Precisely scoped the actual impact: the live app
      NEVER reads command_units back from SQL (confirmed, again, via code
      search), so this does NOT affect what the Army stakeholder sees in
      the demo UI — it silently corrupts the SQL audit trail only, which
      matters for direct DB inspection and the eventual production
      rewrite mentioned in memory's purpose/context, not for the demo
      itself. Confirmed nothing else in the codebase (no migration, no
      app code, no docs) referenced the 12 removed unit codes before
      removing them.
      Fix: removed the colliding migration seed (kept the table/index
      DDL — Postgres still gets a command_units table, just no longer a
      second, colliding demo dataset). Also fixed, found by reading the
      same file closely: updateUnit/deactivateUnit/reactivateUnit/
      reassignUnit never called _dbWrite() at all (only createUnit did),
      so SQL never reflected ANY post-creation change (rename, relocate,
      reassign commander, deactivate, reactivate, re-parent all stayed
      in-memory-only forever). Added the missing _dbWrite() calls to all
      four methods, and extended _dbWrite's UPDATE SET list to include
      parent_unit_id (previously excluded, which would have silently
      dropped re-parenting even after adding the call). unit_type/
      unit_code remain deliberately excluded — no method ever changes
      them post-creation.
      verify-day-67.js: 17/17 passing. Group A: post-fix migration + real
      seed-demo-data.js → SQL exactly matches in-memory, zero mismatched
      rows. Group B: first-ever _dbWrite round-trip coverage for create/
      update/deactivate/reactivate/reassign, each checked directly
      against SQL. Group C: HONESTLY SCOPED — attempted to test the SQL
      recursive-CTE branch of RBACService.getCommandScope() directly (the
      ACTUAL path that runs in the real docker-compose deployment) but
      discovered pg-mem does not implement recursive CTEs at all
      (confirmed via pg-mem's own explicit error message, isolated with a
      minimal 4-row test table before concluding anything about SANGAM's
      own SQL — this is a tooling limitation, not a project bug: the CTE
      in rbac.service.js is standard, textbook PostgreSQL recursive-CTE
      syntax with no exotic features). Rewrote Group C to test only what
      can genuinely be proven here (the query is actually reached, not
      skipped by the db=null branch; getCommandScope degrades gracefully
      to self-only when the query throws, rather than crashing) and
      explicitly logs what's skipped and why, rather than silently
      omitting it or falsely claiming automated proof. Group D: restart/
      reseed idempotency — a second, fresh in-memory service reseeding
      against the same underlying DB produces zero duplicate/orphaned
      rows.
      Full regression: 1,966/1,966 (1,949 + 17 new), 0 failures, exit 0.
      Diffed every individual day-result line against the Day 66 clean
      run: byte-identical, only the new Day 67 line added.
- [x] Day 68 — Installed real PostgreSQL 16 locally (apt-get; archive.ubuntu.com
      is allowlisted) and ran this project's actual production code against a
      genuine database for the first time in its history — not pg-mem, not
      theory. This immediately surfaced two more real, previously-invisible
      bugs beyond Day 67's, plus definitively resolved Day 67's open item.
      OPERATIONAL NOTE: disk state (installed packages, DB data files,
      node_modules) survives across turn boundaries in this sandbox; the
      Postgres DAEMON PROCESS does not — needs `service postgresql start`
      again each turn it's needed. Worth remembering for the rest of this
      session and worth stating plainly in the final handoff: this real-
      Postgres validation is a one-time, manual confirmation performed
      during this session, NOT something `npm test` can re-run in an
      arbitrary future environment (no real Postgres guaranteed installed).
      BUG 1 — migration ordering: day-12-reporting-schema.sql has hard FKs
      to command_units(id), but command_units was defined inside
      day-13-rbac-schema.sql, which sorts AFTER day-12 (numeric filename
      sort: 12 < 13) — migrations were structurally guaranteed to fail on
      any genuinely fresh database. Confirmed via the real migration
      runner failing with "relation command_units does not exist" on the
      very first real run. Fix: extracted command_units into a NEW file,
      001-command-units-schema.sql (sorts right after 000-init-schema,
      before every day-NN file) — did NOT rename any existing day-NN
      file, to preserve this project's real, meaningful development
      history (each day-NN name reflects the actual day it was built).
      Re-ran all 8 migrations against a freshly dropped-and-recreated
      real database afterward: all applied cleanly, in order, zero errors.
      BUG 2 — supply_items schema mismatch: _persistItem()'s INSERT
      referenced a created_at column that supply_items has NEVER had
      (confirmed against the real day-12 schema: only 9 columns, ending
      in updated_at, no created_at). This is NOT a race — every single
      item write has failed 100% of the time whenever db was non-null,
      silently, since the day this code was written, swallowed by the
      pre-existing .catch(()=>{}). This was, in turn, the actual root
      cause of every transfers_item_id_fkey violation seen in real
      Postgres logs (no items ever existed in SQL, so every transfer's FK
      check necessarily failed). Fixed by removing the phantom column
      from the column list, VALUES placeholders, and params array.
      Cross-checked _persistTransfer and _persistBlock against their real
      table schemas too while in the area — both already correct, no
      further mismatches found.
      BUG 3 — fire-and-forget write race (real, distinct from Bug 2, also
      confirmed via genuine Postgres logs): command_units_parent_unit_id_
      fkey violations during rapid bulk seeding — a child unit's insert
      racing ahead of its own parent's insert, since UnitManagementService.
      _dbWrite() and SupplyChainService._persistItem/_persistTransfer are
      all deliberately fire-and-forget at the call site (never awaited),
      a consistent, INTENTIONAL architectural pattern across this codebase
      so a flaky/slow Postgres never adds latency or failure to the live,
      user-facing request path. That design goal is sound and was NOT
      touched. What WAS added: a flushPendingWrites() method on both
      services (tracks in-flight fire-and-forget promises in a Set,
      resolves once they've all settled) that ONLY bulk-creation callers
      (the demo seeder; potentially the Day 61/62 bulk-import route, not
      yet checked) opt into — the live per-request path calls it nowhere
      and is completely unaffected. Wired explicit flush calls into
      seed-demo-data.js at each real dependency boundary: after the
      brigade (before battalions reference it), after all battalions
      (before the company references alphaBnId), after all units (before
      items reference unit_id), and after all items (before transfers
      reference item_id).
      RESOLVED Day 67's open item, for real: with the schema bug and race
      both fixed, ran the full demo reseed against a clean real Postgres
      database end-to-end. Postgres log showed exactly ONE error for the
      entire run — the expected, deliberately-caught "does schema_
      migrations exist yet" bootstrap check (confirmed by reading
      run-migrations.js's own code comment: "schema_migrations doesn't
      exist yet — return empty set") — zero unexpected/unhandled errors.
      SQL row counts exactly matched in-memory: 5 units, 20 items, 7
      transfers, all consistent. THEN — the actual point of Day 67's open
      item — called RBACService.getCommandScope() directly against this
      real, correctly-seeded Postgres for the first time ever: root scope
      correctly returned all 5 units {ids:[1,2,4,3,5]}; a leaf battalion
      correctly returned self-only; a mid-level unit with one child
      correctly returned self+child; an unknown unit correctly returned
      empty. The recursive CTE is now GENUINELY PROVEN CORRECT, not just
      "believed correct by manual syntax review" as Day 67 had to leave it.
      (Minor, understood non-issue: a raw ad-hoc test script using `pg.Pool`
      directly without an explicit process.exit() left the Node process
      alive briefly after all work completed and logging finished — a
      known `pg` Pool/event-loop quirk in throwaway scripts, not a bug in
      any shipped code; confirmed benign by adding explicit process.exit(0)
      and getting exit code 0 cleanly on retry.)
      verify-day-68.js: 13/13 passing. Group A: a GENERAL static-analysis
      guard (no database needed) that reads every migration file's
      REFERENCES clauses and confirms the target table is created by that
      file or an earlier one in sort order — protects against this whole
      CLASS of mistake recurring, not just this one instance; first
      version had a false-positive from an over-fragile intra-file
      statement-splitting regex, simplified to a more robust file-level
      check instead of chasing perfect SQL parsing. Group B: proves
      _persistItem's fix via pg-mem (item write now actually lands in
      SQL, previously impossible). Group C: proves the flushPendingWrites
      contract deterministically with a controllable slow fake db (resolves
      immediately before the write lands; flush genuinely waits for it;
      never throws even on a failing write; safe no-op when db is null) —
      pg-mem itself can't reproduce genuine connection-pool races, so this
      tests the new capability's contract rather than the race itself.
      Full regression: 1,979/1,979 (1,966 + 13 new), 0 failures, exit 0.
      Diffed every day-result line against the Day 67 clean run:
      byte-identical, only the new Day 68 line added.
- [x] Day 69 — Systematic audit of every OTHER service's SQL persistence,
      closing out the DB-archaeology thread opened Days 66-68. Confirmed
      movement-order/inventory-ledger/alert-escalation/compliance services
      have ZERO SQL persistence at all (documented fact, not a bug — these
      domains simply have no SQL audit trail). Checked delegation.service.js
      and notification.service.js's INSERTs against their real table
      schemas: both correct, no mismatches (unlike supply-chain's Day 68
      bug). Smoke-tested notification + audit-log writes against real
      Postgres (still running this session, restarted after another
      idle-timeout down): both landed correctly, zero new errors.
      audit-log.service.js already uses a real BEGIN/COMMIT/ROLLBACK
      transaction with properly-awaited writes — a different, more
      careful pattern than the fire-and-forget one elsewhere. Noted but
      NOT fixed: day-16 adds audit_logs.encryption_version but the INSERT
      never sets it, so it silently defaults to 0 regardless of whether
      `details` was actually encrypted — a metadata-accuracy question,
      doesn't crash/corrupt, carried forward rather than dug into without
      full confidence in the encryption code's intent.
      Found and fixed the SAME fire-and-forget race exposure as Day 68's
      seeder, in bulk-operations.service.js: importItemsFromCSV (many
      createItem calls in a loop) and bulkTransfer (many createTransfer
      calls) neither called flushPendingWrites(). Added both, right
      before each method's final _audit() call, reusing Day 68's existing
      mechanism — zero new infrastructure needed. Live single-item POST
      /supply/items and /supply/transfers paths untouched.
      verify-day-69.js: 9/9 passing (static no-persistence confirmation
      for the 4 clean services; bulk-import + bulk-transfer functional
      checks via pg-mem; source-level regression guard confirming the
      flush calls exist and run before _audit in both methods, so a
      future edit that accidentally drops them gets caught even without
      reproducing the underlying race).
      Full regression: 1,988/1,988 (1,979 + 9 new), 0 failures, exit 0,
      diff confirms only the new Day 69 line added.
- [x] Day 70 — Security/hardening pass. npm audit: backend clean (1 low,
      unrelated to shipped code). Frontend had 5 (3 moderate, 2 high).
      Ran `npm audit fix` (non-forcing): safely upgraded postcss to
      8.5.23, fixing the HIGH-severity path-traversal issue with zero
      test/build impact (confirmed: 16/16 frontend tests still pass,
      `npm run build` still succeeds cleanly). Remaining 4 (3 moderate,
      1 high per esbuild/react-router) all require BREAKING upgrades
      (vite 5→8, react-router-dom 6→7) — investigated real exposure
      before deciding whether to force them: esbuild's CVE is dev-
      server-only (any website can query the Vite dev server) - not
      present in production builds, and this is an internal demo, not a
      dev server exposed to the public internet. react-router's two
      CVEs are an open-redirect (needs a user-controlled navigate()/
      <Link to=> target) and an SSR-hydration constructor-injection
      (needs SSR). Checked every navigate() call site in this codebase:
      all either use hardcoded internal route strings from local config
      objects (KeyboardShortcuts, DemoWalkthrough) or location.pathname
      (same-origin only, structurally can't carry a redirect payload) —
      no user/attacker-controlled navigation target exists anywhere.
      This app has no SSR at all (pure Vite SPA). DECISION: deferred
      both breaking upgrades — real exposure in this specific app is
      effectively nil for both, and forcing a major react-router
      version bump this close to a demo, with only 16 assertions of
      frontend test coverage to catch regressions, is a worse trade
      than the (already very low) risk being deferred. Documented
      clearly rather than silently ignored or blindly forced.
      SEPARATE, real finding while investigating: frontend's ONE test
      file (scripts/verify-day-27.cjs, `npm test` / `npm run test:frontend`)
      was NEVER wired into the root test:all script, and had gone
      completely stale as a result — it referenced TopBar.jsx (no longer
      exists; functionality absorbed into Sidebar.jsx per that file's Day
      32 header comment, sometime between Day 28 and Day 58) and expected
      LoginPage text ("Command Login" / "Log In") that no longer matches
      the Day 33 ops-console redesign ("SANGAM" wordmark / "AUTHENTICATE
      →"). Both breakages meant the entire file failed to even load
      (esbuild fails the whole run on one unresolvable import), so ALL
      14 of its other, still-relevant assertions (Widget, BlockchainSeal,
      ActivityFeed, dashboard-data-shape contract) had been silently not
      running this whole time too. Fixed both stale references against
      the ACTUAL current file contents (not assumptions), confirmed all
      16 assertions pass, and wired `npm run test:frontend` into the
      root test:all so this can't silently rot again.
      NOT done today (identified, carried forward): expanding frontend
      coverage to newer components (NotificationBell, TransferDetailModal,
      AlertDetailModal, Sidebar) — Sidebar specifically needs a Router
      context wrapper and bundles further local components, more setup
      than proportionate for this pass.
      Full regression (backend + frontend together, for the first time):
      2,004/2,004 passing (1,988 backend + 16 frontend), 0 failures,
      exit 0. Backend day-result lines diffed byte-identical against
      Day 69's run — confirms this day's changes touched frontend/
      tooling only, zero backend impact.

## Things already checked and confirmed — don't re-derive these

- Pagination: transfers and blockchain genuinely had working limit/offset
  before Day 62 (confirmed by direct code reading, not assumption).
  ⚠ CORRECTION (caught during Day 62): my earlier blanket claim "already
  exists on items/transfers/blockchain" was WRONG for items — it had none
  at any layer. Fixed Day 62, opt-in at the service layer specifically to
  avoid breaking 6 internal callers that need the unbounded set (see Day
  62 entry above for full detail). Lesson: a claim covering "X/Y/Z" isn't
  actually verified just because it was checked for one of them — verify
  each one, not the group.
- Postgres persistence already properly wired (not a stub) — DATABASE_URL + pg Pool
  in server.js. Not a gap.
- API docs already exist: docs.routes.js serves Swagger/OpenAPI. Not a gap.
- Seed script (backend/scripts/seed-demo-data.js) has NO clear/reset logic —
  reruns duplicate data. Real gap, feeds Day 59's demo-data-reset item.
- RBAC non-monotonic: reports:advanced held by AUDITOR(4), LOGISTICS_OFFICER(6),
  SENIOR_OFFICER(8), COMMANDER(9), SYSTEM_ADMIN(10) — NOT JCO(5), NOT OFFICER(7).
  ⚠ CORRECTION (caught during Day 57): JCO does NOT have reports:advanced —
  only LOGISTICS_OFFICER does. I mis-stated this in CompliancePage.jsx's own
  comment and in verify-day-56.js's header comment (both fixed during Day 57);
  the actual Day 56 test *code* always correctly used LOGISTICS_OFFICER, only
  the prose was wrong. Use LOGISTICS_OFFICER, never JCO, as the "has
  reports:advanced" example role going forward. audit:read holders:
  AUDITOR(4), SENIOR_OFFICER(8), COMMANDER(9), SYSTEM_ADMIN(10).
  ⚠ SECOND CORRECTION (caught during Day 60): audit:export is NOT the same
  4-role set as audit:read — I claimed this in Day 57's header comment and
  it was wrong. audit:export = {AUDITOR, COMMANDER, SYSTEM_ADMIN} only (3
  roles) — SENIOR_OFFICER has audit:read but NOT audit:export. Neither Day
  56 nor 57's tests happened to exercise SENIOR_OFFICER against either
  permission specifically, so this went undetected until Day 60 computed
  the full matrix programmatically (verify-rbac-contract.js). Lesson
  reinforced: don't hand-transcribe the permission matrix into comments at
  all if avoidable — prefer computing from RBACService directly, the way
  verify-rbac-contract.js now does, which self-corrects if the matrix ever
  changes rather than going stale like a hardcoded snapshot would.
  Client never receives a permissions array — only role (string) + rankLevel
  (number) — so any new page with non-monotonic gating needs role-string
  checks or (preferred, established pattern) per-section try/catch on real
  403s, NOT a rankLevel threshold alone.
- client.js request() throws ApiError(message, status, payload) for ANY
  non-2xx — compliance routes return non-2xx for all their error paths, so
  frontend code should always rely on try/catch, never expect a resolved
  {success:false} from these specific endpoints.
- Existing reusable CSS not to reinvent: .tab-bar/.tab/.tab-active (was defined
  but unused before Day 56 — now used by CompliancePage too), .td-timeline/
  .td-event/.td-event-icon/.td-event-body/.td-event-label/.td-event-time/
  .td-event-connector (from TransferDetailModal/AlertDetailModal), .report-card/
  .report-note, .sev-badge/.sev-pill/.sev-info/.sev-warning/.sev-critical/
  .sev-security, .audit-table/.audit-row-fail/.audit-time/.audit-action,
  .state-screen/.state-error/.spinner, .table-scroll/.table-empty/.item-table/
  .item-name-cell/.item-code-cell, .filter-bar/.form-input, .feedback-banner
  (.error/.success)/.feedback-close, .widget-grid + <Widget code/headline/unit/
  subline/breakdown/interactive/delay> (generic stat card, already used by
  DashboardPage — reuse, don't invent new stat card markup).
- Widget import: `import Widget from '../components/Widget.jsx'`
- data-tour anchors exist on only 6 of 16 pages (the ones in the fixed 8-step
  Day 50 walkthrough) — NOT every page needs one. Compliance/Delegation pages
  correctly have none; this is consistent, not an oversight.

## Verification discipline (keep doing this every day)

1. Read the actual route file + service file for exact request/response shapes
   before writing ANY frontend code that calls them. Do not infer from memory
   or from similar-sounding endpoints.
2. `npx vite build` after frontend changes to catch syntax/import errors before
   writing the verify script.
3. Real HTTP integration verify-day-NN.js (server on random port, real JWTs via
   jwt.sign with role/unitId overrides, real fetch/http requests) — this project's
   established, hard-learned rule: stubbed unit tests miss real runtime bugs.
4. Run the SINGLE new day's script first, fix any failures, THEN run full
   `npm run test:all` to confirm zero regressions before moving to the next day.
5. package.json test:all day-loop: check whether the new day number is already
   in the loop before assuming you need to add it (may already be there from
   an earlier pass in this same long session — check, don't assume either way).

- [x] Day 71 — Orphaned-capability scan (Days 56-58 pattern), applied to
      the FULL 130-route backend surface. Found a genuinely significant
      bug: AUDITOR — role description "read-only across all data plus
      full audit log access" — was completely locked out of the Audit
      Log page, at THREE independent layers: (1) backend /api/reports/
      audit-log required system:admin (AUDITOR has audit:read, the
      purpose-built permission, not system:admin); (2) Sidebar.jsx gated
      /audit at rankLevel>=5 (adminOnly), AUDITOR is rankLevel 4; (3)
      AuditLogPage.jsx had its own independent, stricter hardcoded check
      (user.role === 'SYSTEM_ADMIN') that would've blocked direct
      navigation even after fixing the first two. Verified safety before
      fixing each: confirmed AUDITOR is the ONLY role at rankLevel 4 (no
      collision risk from loosening); confirmed SYSTEM_ADMIN has BOTH
      audit:read and system:admin (so the backend fix only adds access).
      Fixed all three consistently (audit:read permission; minRankLevel:4
      matching the existing Compliance-link pattern; rankLevel>=4 check),
      updated the now-inaccurate error message text too.
      Also found: POST /api/rbac/audit-logs/verify-integrity (hash-chain
      tamper detection over the audit log's own cryptographic chain) was
      fully built, correctly permissioned, and mounted since day-13 — but
      never called from anywhere in the frontend. Added client.js's
      verifyAuditIntegrity(), and a "⛓ VERIFY INTEGRITY" button + result
      banner in AuditLogPage.jsx (reusing existing .page-header-right and
      a new small .integrity-banner CSS block matching .alert-card's
      established visual language — checked for existing reusable classes
      first rather than inventing new ones freely). Confirmed frontend
      still builds cleanly with all changes.
      verify-day-71.js: 17/17 passing after two rounds of self-correction
      — first run found 3 failures that turned out to be bugs in the TEST
      itself, not the fix: a too-narrow slice window that missed
      minRankLevel:4, then a second boundary bug where a wider window
      bled into the next, unrelated link's legitimate adminOnly:true;
      and two cases of a naive substring check matching the fix's own
      explanatory comments (which legitimately quote the OLD broken
      pattern in backticks to document why it changed) rather than live
      code — fixed by checking the specific active-code assignment
      pattern / stripping comment lines before checking. Verified each
      failure by direct inspection before "fixing" anything, confirming
      each time it was the test's precision at fault, not the real code.
      Group A tests the permission fix over genuine HTTP (AUDITOR gets
      200, SOLDIER still correctly gets 403). Group C tests the
      integrity-check capability with a GENUINE hash chain built through
      the real AuditLogService.log() (not hand-computed hashes) via
      pg-mem — clean chain verifies true; directly tampering with a
      stored log_hash is detected and correctly cascades forward through
      subsequent entries (expected hash-chain behavior, not a bug); the
      offline (db=null) path throws a clear, catchable error matching how
      both the route and the new frontend banner handle it.
      Full regression: 2,029/2,029 (2,012 + 17 new), 0 failures, exit 0,
      diff confirms only the new Day 71 line added.

---

## CHECKPOINT — Day 71, requested by user mid-session

User asked for a packaged zip + a plan for the remaining days of the
90-day sprint (originally scoped to Day 90 per memory's "Purpose &
context", though this session's explicit instruction was "proceed till
day 80"). Packaging at Day 71 rather than continuing to 80 first, per
this explicit request. The Days 72-90 plan goes in the handoff doc, not
here — this file is a scratch log, not the deliverable.

