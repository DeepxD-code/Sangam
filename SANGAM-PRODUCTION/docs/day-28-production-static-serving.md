# Day 28 — Production Static Frontend Serving
## SANGAM Supply Chain Management System

---

## Why This Day Exists

Day 27 built a working React dashboard, but it only ran via `npm run
frontend:dev` (a separate Vite dev server on port 5173) talking to a
separately-started backend on port 3000. That's fine for development, but a
real Army demo needs **one command, one port**: `docker-compose up`, browse
to one URL, see the whole system. Day 28 closes that gap.

---

## What Changed

### `backend/src/app.js`
After all `/api/*` routes are mounted, a conditional block checks whether
`frontend/dist/index.html` exists. If it does:
- `express.static(frontendDist)` serves the built JS/CSS assets
- A catch-all `GET` route (everything **except** `/api/*`, via a negative-
  lookahead regex) falls back to `index.html`, so client-side routes (once
  the dashboard grows beyond one screen) don't 404 on a hard refresh

If `frontend/dist/index.html` does **not** exist — which is the case for
every one of the 850+ backend unit tests that call `createApp()` directly
without ever building a frontend — this entire block is skipped. The app
behaves byte-for-byte identically to every prior day: a pure JSON API.
This was the central design constraint: **zero risk to 27 days of existing,
passing tests.**

### `Dockerfile`
Added a new first build stage, `frontend-build`, that runs `npm ci && npm
run build` inside `frontend/` and produces `frontend/dist/`. The final image
stage now `COPY --from=frontend-build /build/frontend/dist ./frontend/dist`
in addition to the existing backend source — so the same container that
serves the API also serves the dashboard.

### `.dockerignore`
Added `dist/` to the ignore list, so a stale host-built `frontend/dist`
never accidentally gets copied into a build context instead of the
freshly-built one (harmless either way, since the build stage overwrites
it, but cleaner and faster).

### `docker-compose.yml` / `docker-compose.dev.yml`
**No changes needed.** The existing single `app` service, exposing one port,
already covers serving both the API and the static frontend from the same
container — that was the point of building it this way rather than adding a
second `frontend` service.

---

## Why a Negative-Lookahead Regex Route, Not a Simple Wildcard

Express 5 changed its routing engine (path-to-regexp v8) from Express 4, and
some wildcard patterns that worked in v4 behave differently or are rejected
outright in v5. Rather than guess, the actual pattern
(`app.get(/^(?!\/api\/).*/, ...)`) was tested directly against a real
Express 5 instance — registering it, then making real HTTP requests against
`/api/test`, `/`, `/dashboard`, and `/api/other` — before being adopted.
Confirmed: API paths match their own routes, non-API paths fall through to
the SPA handler, and *unmatched* API paths correctly fall through to the
JSON 404 handler rather than being swallowed by the SPA catch-all. This
distinction matters: an API consumer hitting a typo'd endpoint needs a JSON
404, not an HTML page that happens to return status 200.

---

## What Was — and Wasn't — Actually Tested

**Docker is not available in this development environment.** `docker build`
was never literally run. Being explicit about this rather than claiming a
verification that didn't happen:

**What was tested for real:**
- The exact frontend-build stage commands (`npm ci`, then `npm run build`)
  were run manually, outside Docker, against a fresh copy of
  `frontend/package.json` + `frontend/package-lock.json` only (replicating
  exactly what Docker's layer-cached `COPY` step provides) — confirmed this
  produces a working `dist/` from the lockfile alone.
- The static-serving + SPA-fallback logic in `app.js` was tested through a
  real, running Express app (not Docker) with both a real Vite-built
  `dist/` and a temporarily-faked one, covering: SPA shell serving, SPA
  fallback for unknown routes, correct asset content-types, API routes
  continuing to work normally, and — critically — unmatched API routes
  still returning JSON 404 rather than the SPA shell.
- The Dockerfile's stage references (`COPY --from=deps`, `COPY
  --from=frontend-build`) were manually traced for correctness against the
  `WORKDIR`/`AS` declarations.
- The path math was manually verified to line up: the final image's
  `WORKDIR /app` plus `COPY --from=frontend-build .../dist ./frontend/dist`
  puts the build at `/app/frontend/dist`, which is exactly what `app.js`'s
  `path.join(__dirname, '..', '..', 'frontend', 'dist')` resolves to from
  `/app/backend/src/app.js`.

**What was NOT tested (would require Docker):**
- An actual `docker build` of the full multi-stage image
- The healthcheck actually working inside a container
- Resource limits, non-root user permissions actually applying correctly
  inside a real container filesystem

**Recommendation for whoever next has Docker access:** run `docker-compose
build && docker-compose up`, confirm `http://localhost:3000/` serves the
dashboard and `http://localhost:3000/api/health` (or `/health`) responds,
before relying on this for an actual stakeholder demo.

---

## Verification

`backend/scripts/verify-day-28.js` (9 tests) — covers both the "dist
absent" code path (proving zero behavioral change to the existing 850+
tests) and the "dist present" code path (SPA shell serving, fallback
routing, asset content-types, API routes unaffected, unmatched API routes
still JSON). Full backend + frontend regression re-run after this change:
878/878 passing, 0 failures.
