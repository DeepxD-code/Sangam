# Day 17 Completion Summary
## Docker Deployment — Full Stack Containerization

**Date:** Day 17 of 90
**Status:** ✅ Complete — 44/44 tests passing (363/363 Days 11–17, zero regressions)

---

## Delivered Today

### Files Created (10 files)

| File | Purpose |
|------|---------|
| `backend/src/app.js`              | Express factory — wires all 6 route sets + shared services |
| `backend/src/server.js`           | Entry point — env validation, DB connect, migrations, graceful shutdown |
| `backend/src/routes/health.routes.js` | `GET /health` — DB latency probe, 200/503 |
| `backend/scripts/run-migrations.js` | Idempotent migration runner, day-ordered, tracked in `schema_migrations` |
| `database/migrations/000-init-schema.sql` | Baseline: `schema_migrations` + `users` tables |
| `Dockerfile`                      | Multi-stage (deps → final), non-root uid 1001, HEALTHCHECK |
| `docker-compose.yml`              | Full stack: pg:16 + app, health-wait, persistent volume |
| `docker-compose.dev.yml`          | Dev override: live source mount, hot reload |
| `.env.example`                    | All vars documented, placeholders only, CHANGE_ME markers |
| `.dockerignore`                   | Excludes .env, node_modules, docs from build context |

**Day 17 total: ~900 lines (plus config files)**

---

## The Startup Sequence (Now Working End-to-End)

```
docker-compose up
  ├─ postgres:16-alpine starts → pg_isready polls every 5s
  └─ app waits (service_healthy)
       │
       ├─ server.js: validateEnv() — exits clearly if any var missing
       ├─ server.js: pg.Pool connect — exits clearly if DB unreachable
       ├─ run-migrations.js: applies pending SQL files (0 → 11 → ... → 16)
       ├─ createApp(db): mounts all routes, builds shared services
       ├─ AuditHardeningService.startIntegritySweep() (Day 16)
       └─ http.listen(:3000) → GET /health → 200 { status:"ok" }
```

---

## Key Design Decisions

**Factory pattern for app.js:** `createApp(db, services, options)` never
imports global state — DB pool and service instances are injected. This
lets Day 17's verify suite test the full Express stack with null/mock
dependencies, same pattern used by Days 11–16.

**Migration tracking in DB:** `schema_migrations` table records each
applied filename. Re-running on an already-migrated DB skips all files
silently. The Day 17 mock-DB tests verified both paths (all-skip and
all-apply).

**`sortKey()` for migration ordering:** `'day-11-...'` vs `'day-2-...'`
would sort incorrectly alphabetically — `sortKey` extracts the first
integer so `0, 11, 12, 13, 14, 15, 16` is always the order regardless of
filename changes.

**Env validation exits clearly:** `validateEnv()` in server.js lists ALL
missing vars in one error, not just the first one. Operators get one read
to know exactly what to set.

**POSTGRES_PASSWORD and JWT_SECRET use `:?` in docker-compose:** The `:?`
syntax causes `docker-compose up` to fail immediately with a readable error
if these aren't set, rather than silently passing an empty string.

---

## The System Is Now Runnable

```bash
cp .env.example .env
# Edit .env — fill in JWT_SECRET, PASSWORD_PEPPER, AUDIT_ENCRYPTION_KEY, POSTGRES_PASSWORD
docker-compose up -d

# Verify
curl http://localhost:3000/health
# {"status":"ok","version":"1.0.0","db":{"connected":true,"latencyMs":2},...}
```

---

## Cumulative Sprint Metrics (Days 11–17 this session)

| Metric | Count |
|--------|-------|
| Services | 8 |
| Route files | 6 (including health) |
| App/server files | 2 (app.js, server.js) |
| Migration files | 7 (000 + days 11–16) |
| Docker/config files | 5 |
| Total tests | 363 |
| Total source lines | 5,544 |

---

## Day 18 Preview

**API Documentation** — auto-generated OpenAPI 3.0 spec from the Express
route definitions, covering all 45+ endpoints with authentication
requirements, request schemas, response examples, and error codes.
Exported as both `openapi.json` and a browsable Swagger HTML page that
can be served at `GET /api/docs` — making the system demonstrable to
Army procurement officers and system integrators without needing access
to the source code.
