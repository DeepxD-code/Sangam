# Day 27 — React Dashboard UI Spike
## SANGAM Supply Chain Management System

---

## Why This Day Exists

The LLM Council's Day 21 verdict was unambiguous: the absence of any frontend
UI is the single highest-priority risk to demo viability. Twenty-six days of
backend work — 850 passing tests, 16 services, 15 routes — was, until today,
completely invisible to anyone who isn't comfortable reading `curl` output.
Day 26 built the data contract (`GET /api/dashboard/summary`); Day 27 builds
the screen that consumes it.

This is explicitly a **spike**: a working proof of concept that proves the
architecture and gives the team something to point a stakeholder at, not the
polished vertical-slice demo (that's Days 28–60 per the council roadmap).

---

## What Got Built

A React 18 + Vite single-page app (`frontend/`) with:

- **Login screen** — calls the real `POST /api/auth/login`, stores the access
  and refresh tokens, restores the session via `GET /api/auth/me` on reload.
- **Command Dashboard** — a single screen with seven SITREP-style widgets
  (Units, Personnel, Supply, Transfers, Movement, Stock-take, plus a bespoke
  Blockchain integrity seal) and a recent-activity feed, all driven by one
  call to `GET /api/dashboard/summary`. Auto-refreshes every 30 seconds to
  match the backend's cache TTL.

---

## Design Direction

The brief: an Army logistics officer needs situational awareness in under
five seconds — not a SaaS analytics dashboard. The design plan, worked
through deliberately rather than defaulting to generic patterns:

**Color** — desaturated military olive/charcoal background (`#11140F`,
`#1B2018`) with a brass accent (`#C9A227`) and a status palette of olive-green
/ burnt-amber / brick-red rather than neon green/red. This is a genuine
choice grounded in insignia and dispatch-board color conventions, not the
generic "near-black with acid-green accent" AI-dashboard default.

**Type** — three deliberate roles: a condensed stencil-adjacent display face
(Oswald) for headers, a monospace face (IBM Plex Mono) for all data — unit
codes, quantities, timestamps, the things a logistics officer actually reads
— and a restrained humanist sans (Inter) for interactive chrome only. The
monospace-for-data convention mirrors real military manifest and dispatch
documents.

**Layout** — a SITREP card grid using three-letter section codes (UNT / PER /
SUP / TRF / MOV / STK / BLK) rather than generic numbered markers, since
these mirror real radio call-sign/log abbreviation conventions and the
sections are parallel categories, not a sequence.

**Signature element** — the Blockchain Integrity Seal: a circular stamp motif
showing VERIFIED (or TAMPER, in brick-red, if `verifyChain()` ever returns
false). Every other widget is a quiet, disciplined data card; this is the one
place the design spends its risk, because tamper-evident ledger integrity is
SANGAM's actual differentiator over a conventional supply system — the visual
should say so.

Full token system and component-by-component rationale: `frontend/README.md`.

---

## Two Real Contract Bugs Found and Fixed While Building This

Building a real client against the real backend (rather than testing services
in isolation) surfaced two further bugs neither the 834 backend unit tests
nor the Day 26 dashboard work had caught:

1. **`POST /api/auth/login` returns `accessToken`, not `token`.** The first
   draft of `api/client.js` read `result.token` — which is `undefined` for
   every real login response. Fixed by reading `result.accessToken` and
   `result.refreshToken`, matching `AuthService._issueTokens()`'s actual
   return shape exactly.

2. **`POST /api/auth/logout` requires a `refreshToken` in the request body**
   (`auth.routes.js` returns 400 `INVALID_REQUEST` without one) — the first
   draft of the logout call sent no body at all. Fixed by storing the
   refresh token returned at login and sending it on logout.

**Pattern, again:** every contract bug this session was caught only by tracing
the *real* service/route source code line-by-line, not by trusting an
interface inferred from naming conventions or documentation comments. The
project's recurring lesson (Day 26: `scope.ids` vs plain array; Day 27: these
two) is the same lesson twice over — verify request/response shapes against
the actual implementation, every time a new consumer is built against an
existing API.

---

## Architectural Clarification Surfaced This Session

`AuthService.login()` requires a connected PostgreSQL database — it throws
`DATABASE_REQUIRED` and the route returns 503 if `db` is `null`. This is *not*
a bug: credentials and lockout state must be durably persisted, and the
project's `docker-compose.yml` already provisions a Postgres container for
exactly this reason. The "offline-first" promise applies to **operational
data** (supply, units, transfers, movement — all the Day 19–26 in-memory
services) so the Army can keep moving stores and recording transfers without
network access in the field; it was never meant to apply to the initial
login handshake, which reasonably assumes connectivity to the unit's local
server. Documented here so this isn't mistaken for a gap in future sessions.

---

## Verification

Without a browser available in this environment, verification used three
layers, each catching a different class of bug:

1. **`vite build`** — clean compile, 38 modules, zero errors. Catches
   syntax/JSX/import errors.
2. **Component-level SSR smoke test** (`frontend/scripts/verify-day-27.cjs`,
   19 tests) — uses `esbuild` to transpile each component on the fly and
   `react-dom/server.renderToStaticMarkup` to render it against mock data
   shaped **exactly** like the real Day 26 `dashboard.service.js` response.
   Catches prop-shape mismatches and render-time crashes.
3. **Full-stack integration test** (ephemeral, not committed) — booted the
   real Express backend, a real `vite preview` server, and a real `vite dev`
   server in-process, with a signed JWT, and confirmed: the backend serves
   real dashboard data (200), the built frontend's `index.html` serves
   correctly, and **both** `vite dev`'s and `vite preview`'s proxy configs
   correctly forward `/api/*` to the backend (empirically tested, not assumed
   — Vite's preview-proxy behavior wasn't something to take on faith).

What this does **not** cover (would require a real browser): click handlers,
form submission DOM events, visual layout/CSS rendering, and the `useEffect`
timing in `App.jsx`/`DashboardPage.jsx`. Those were instead covered by
careful manual cross-reference of every API call site against the real
backend route/service source — the same discipline that caught the two
contract bugs above.

---

## Known Gaps / Next Steps

- No automatic token refresh on 401 — session simply requires re-login after
  the 8-hour access-token expiry. Acceptable for a spike; real refresh-token
  rotation already exists on the backend (Day 14) and should be wired in
  during the Days 28–60 vertical-slice phase.
- No production static-file serving wired up yet — the backend doesn't yet
  serve `frontend/dist/`. Needs a `Day 28+` task: either an Express static
  mount or an nginx reverse-proxy layer in `docker-compose.yml`.
- Single view only — no client-side routing. Fine for a one-screen spike;
  will need a router once drill-down screens (e.g. clicking the SUP widget
  to see the full item list) are built.
- `npm audit` flags a moderate dev-server-only vulnerability in esbuild
  (fix requires a breaking Vite 8 upgrade). Does not affect the production
  build output; deferred.
