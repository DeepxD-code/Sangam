# Day 17: Docker Deployment
## SANGAM Supply Chain Management System

---

## The Goal: `docker-compose up` on a Fresh Machine

By end of Day 17 the entire SANGAM stack — Node.js backend, PostgreSQL,
all 16 days of migrations — starts with one command on any machine that
has Docker. No manual DB setup. No manual migration runs. No guessing
which environment variables are required.

This is not a luxury. A system that can only run on the developer's
machine is not a demoable MVP.

---

## What Gets Wired Up Today

Three things that have been built in isolation now get connected:

### 1. The Express App (`backend/src/app.js`)

Every service and route built in Days 11–16 gets mounted here:

```
POST   /auth/*           → auth.routes.js     (Day 14)
GET/POST /rbac/*         → rbac.routes.js     (Day 13)
GET/POST /notifications/* → notification.routes.js (Day 11)
GET    /reports/*        → reporting.routes.js (Day 12)
POST   /delegation/*     → delegation.routes.js (Day 15)
GET    /health           → health.routes.js   (Day 17)
```

The app uses a **factory pattern** — `createApp(db, services)` — so the
Express instance is created by injecting a DB pool and shared service
instances, rather than importing them at the module level. This keeps the
app fully testable without a real DB.

### 2. The Migration Runner (`scripts/run-migrations.js`)

Walks every `.sql` file in `database/migrations/`, ordered by day number:

```
000-init-schema.sql     → baseline (users, baseline tables)
day-11-notifications-schema.sql
day-12-reporting-schema.sql
day-13-rbac-schema.sql
day-14-auth-schema.sql
day-15-delegation-schema.sql
day-16-audit-hardening-schema.sql
```

Tracks which migrations have run in a `schema_migrations` table.
Idempotent — re-running on an already-migrated DB skips completed steps.
Safe to call on every container start.

### 3. Docker Files

**`Dockerfile`** — multi-stage build:
```
Stage 1 (deps):  node:22-alpine + npm ci --only=production
Stage 2 (final): copy app source + deps + run as non-root uid 1001
                 EXPOSE 3000, HEALTHCHECK, CMD node backend/src/server.js
```

**`docker-compose.yml`** — full stack:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment: POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
    volumes: sangam_data (persistent)
    healthcheck: pg_isready every 5s

  app:
    build: .
    depends_on: db (condition: service_healthy)
    environment: NODE_ENV, DATABASE_URL, JWT_SECRET, PASSWORD_PEPPER,
                 AUDIT_ENCRYPTION_KEY
    ports: "3000:3000"
    command: node backend/src/server.js
```

**`docker-compose.dev.yml`** — dev override:
```yaml
services:
  app:
    volumes: ./backend:/app/backend  # live source mount
    command: npx nodemon backend/src/server.js
    environment: LOG_LEVEL: debug
```

---

## The Startup Sequence

```
docker-compose up
  │
  ├─ db container starts → pg_isready healthcheck polling
  │
  └─ app container waits (depends_on: db → service_healthy)
       │
       ├─ server.js: connect pg Pool
       │
       ├─ run-migrations.js: apply pending .sql files
       │
       ├─ AuditHardeningService.startIntegritySweep()   (Day 16)
       │
       └─ Express listen on :3000
              │
              └─ GET /health → { status:"ok", db:true, uptime:N }
```

The `HEALTHCHECK` in the Dockerfile polls `GET /health` every 30 seconds.
If the endpoint returns a non-200 for 3 consecutive checks, Docker marks
the container unhealthy and can restart it automatically.

---

## Environment Variable Management

Every secret is documented in `.env.example`. Required vars:

| Variable | Day | Notes |
|---|---|---|
| `NODE_ENV` | — | `production` / `development` |
| `PORT` | — | default 3000 |
| `DATABASE_URL` | — | postgres://user:pass@host:5432/dbname |
| `JWT_SECRET` | 13 | ≥ 32 random chars |
| `JWT_EXPIRY` | 13 | e.g. `8h` |
| `PASSWORD_PEPPER` | 14 | ≥ 32 random chars |
| `AUDIT_ENCRYPTION_KEY` | 16 | exactly 64 hex chars (32 bytes) |
| `LOG_LEVEL` | — | `info` / `debug` / `warn` |

`server.js` validates that all required vars are present at startup and
exits with a clear error if any are missing — no silent failures.

---

## The `/health` Endpoint

```json
GET /health

200 OK
{
  "status": "ok",
  "version": "1.0.0",
  "nodeEnv": "production",
  "uptime": 3600,
  "db": {
    "connected": true,
    "latencyMs": 2
  }
}
```

503 if DB is unreachable. Used by Docker HEALTHCHECK, load balancers,
and external monitoring. Requires no authentication.

---

## What Day 17 Does NOT Include

- HTTPS / TLS termination → handled by reverse proxy (nginx, Traefik)
  in front of the container in a real deployment
- Redis → not needed; rate limiting (Day 14) and notification subscriptions
  (Day 11) are in-memory, appropriate for a single-node demo
- Kubernetes manifests → post-MVP; docker-compose is sufficient for demo
- Secrets management (Vault, AWS Secrets Manager) → post-MVP

---

## Day 18 Preview

**API Documentation** — auto-generated OpenAPI 3.0 spec from the Express
routes, covering all 44+ endpoints with request/response schemas, auth
requirements, and example bodies. Makes the system demonstrable to Army
procurement officers who need to see what the system exposes before
approving integration.
