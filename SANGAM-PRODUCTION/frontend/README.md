# SANGAM Command Dashboard — Frontend (Day 27 Spike)

A React + Vite single-page app that consumes the Day 26 `GET /api/dashboard/summary`
endpoint to give an Army logistics officer a single-screen situational overview:
units, personnel, supply position, transfers, movement orders, blockchain ledger
integrity, stock-take status, and recent activity.

This is a **spike** — a working proof of concept built to close the LLM Council's
#1 flagged risk (no UI exists). It is not yet the polished vertical-slice demo
(that's Days 28–60 per the council roadmap).

## Quick start

```bash
# from the frontend/ directory
npm install
npm run dev
```

The dev server runs on `http://localhost:5173` and proxies `/api/*` requests to
the backend (default `http://localhost:3000`, override via `VITE_API_PROXY_TARGET`
— see `.env.example`).

You'll need the backend running with a connected PostgreSQL database, since
`POST /api/auth/login` requires DB-backed credential storage (this is a deliberate
backend design choice — see `docs/day-27-react-dashboard-spike.md` for why).

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

## Test

```bash
npm test
```

Runs `scripts/verify-day-27.cjs` — a component-level smoke test using
`react-dom/server` to render every component against mock data shaped exactly
like the real backend's response (see the script's header comment for what
this does and does not cover).

## Structure

```
src/
  api/client.js          — fetch wrapper, JWT/refresh-token storage
  components/
    Widget.jsx            — generic SITREP stat-card (reused by 6 of 7 sections)
    BlockchainSeal.jsx     — bespoke ledger-integrity seal (the one signature element)
    ActivityFeed.jsx       — recent audit activity list
    TopBar.jsx             — header bar with session info
  pages/
    LoginPage.jsx
    DashboardPage.jsx       — fetches and renders GET /api/dashboard/summary
  styles/global.css         — design tokens + all styling (single file)
  App.jsx                   — session restore + login/dashboard routing
  main.jsx                  — React entry point
```

## Design direction

Field-dispatch / ops-room console aesthetic, not corporate SaaS. Desaturated
military olive/brass/brick palette (not generic near-black+neon). A condensed
display face + monospace data face + restrained humanist UI face. The one
deliberate visual risk is the blockchain integrity "seal" — everything else is
a quiet, disciplined data grid. Full rationale in
`docs/day-27-react-dashboard-spike.md`.

## Known limitations (by design, for a spike)

- No client-side routing library — single view, login-gated.
- No automatic token refresh on 401 (the dev session simply requires re-login
  after the 8h access-token expiry; refresh-token rotation exists on the
  backend but isn't wired into the client yet).
- Vite's dev-server proxy is for local development convenience only; production
  deployment should serve the built `dist/` behind a reverse proxy alongside
  the backend (Day 28+ task, see Dockerfile/docker-compose.yml at the project root).
