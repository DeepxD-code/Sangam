-- =============================================================
-- SANGAM Day 13: RBAC & Security Schema
-- =============================================================
-- Tables added:
--   army_roles       — Role definitions (maps to Army rank groups)
--   permissions      — Resource:action permission catalogue
--   role_permissions — Many-to-many role ↔ permission mapping
--   command_units    — Army unit hierarchy (SECTION → CORPS)
--   audit_logs       — Tamper-evident hash-chain audit trail
--   refresh_tokens   — JWT refresh token store
-- =============================================================

-- ------------------------------------------------------------
-- 1. Army Roles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS army_roles (
  id           SERIAL      PRIMARY KEY,
  name         VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100)       NOT NULL,
  rank_level   INTEGER            NOT NULL CHECK (rank_level BETWEEN 1 AND 10),
  description  TEXT,
  active       BOOLEAN            NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. Permission Catalogue
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id          SERIAL      PRIMARY KEY,
  resource    VARCHAR(50) NOT NULL,  -- e.g. 'supply'
  action      VARCHAR(50) NOT NULL,  -- e.g. 'approve'
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (resource, action)
);

-- ------------------------------------------------------------
-- 3. Role ↔ Permission (many-to-many)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES army_roles(id)  ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

-- ------------------------------------------------------------
-- 4. Command Unit Hierarchy
-- ------------------------------------------------------------
-- Day 68: moved to 001-command-units-schema.sql, which now runs
-- before this file (and before day-12, which depends on it) — see
-- that file's header comment for the full reasoning. Kept this
-- section header and the "4." numbering in this file's own table-of-
-- contents comment at the top for historical continuity; the table
-- itself now lives earlier in the migration order.

-- ------------------------------------------------------------
-- 5. Tamper-Evident Audit Log (Hash Chain)
--    previousHash + entry content → SHA-256 → logHash
--    Modifying any entry breaks the chain at that point.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id             BIGSERIAL    PRIMARY KEY,
  user_id        INTEGER,
  username       VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
  role_name      VARCHAR(50),
  unit_code      VARCHAR(20),
  action         VARCHAR(100) NOT NULL,
  resource       VARCHAR(100) NOT NULL,
  resource_id    VARCHAR(100),
  details        JSONB,
  ip_address     VARCHAR(45),
  success        BOOLEAN      NOT NULL DEFAULT true,
  failure_reason TEXT,
  severity       VARCHAR(20)  NOT NULL DEFAULT 'INFO'
    CHECK (severity IN ('INFO','WARNING','CRITICAL','SECURITY')),
  previous_hash  CHAR(64)     NOT NULL,
  log_hash       CHAR(64)     NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 6. Refresh Token Store
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           SERIAL       PRIMARY KEY,
  user_id      INTEGER      NOT NULL,
  token_hash   VARCHAR(128) UNIQUE NOT NULL, -- SHA-256(actual_token)
  expires_at   TIMESTAMPTZ  NOT NULL,
  revoked      BOOLEAN      NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- 7. Extend users table with RBAC columns
-- ------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS role               VARCHAR(50)  DEFAULT 'SOLDIER';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS unit_id            INTEGER;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS unit_code          VARCHAR(20);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login         TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER      DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS account_locked     BOOLEAN      DEFAULT false;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- =============================================================
-- INDEXES
-- =============================================================

-- audit_logs: high-volume, lots of filter/sort patterns
CREATE INDEX IF NOT EXISTS idx_audit_user_id    ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_time       ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_severity   ON audit_logs (severity) WHERE severity <> 'INFO';
CREATE INDEX IF NOT EXISTS idx_audit_failures   ON audit_logs (success)  WHERE success = false;
CREATE INDEX IF NOT EXISTS idx_audit_unit       ON audit_logs (unit_code);
CREATE INDEX IF NOT EXISTS idx_audit_resource   ON audit_logs (resource);
CREATE INDEX IF NOT EXISTS idx_audit_composite  ON audit_logs (user_id, action, created_at DESC);

-- command_units indexes: see 001-command-units-schema.sql (Day 68)

-- refresh_tokens
CREATE INDEX IF NOT EXISTS idx_refresh_user     ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_expires  ON refresh_tokens (expires_at);

-- role_permissions lookup
CREATE INDEX IF NOT EXISTS idx_role_perm_role   ON role_permissions (role_id);

-- =============================================================
-- SEED DATA
-- =============================================================

-- Army roles
INSERT INTO army_roles (name, display_name, rank_level, description)
VALUES
  ('SOLDIER',           'Soldier / Sepoy / Constable',                   1,  'Basic enlisted — read-only'),
  ('NCO',               'Non-Commissioned Officer (Naik / Havildar)',     3,  'NCO — can record transactions'),
  ('JCO',               'Junior Commissioned Officer (Subedar)',          5,  'JCO — company-level management'),
  ('LOGISTICS_OFFICER', 'Logistics Staff Officer (Quartermaster / AQMG)', 6,  'Full supply chain management'),
  ('OFFICER',           'Commissioned Officer (Lieutenant – Major)',      7,  'Command and control access'),
  ('SENIOR_OFFICER',    'Senior Officer (Lt Col / Colonel)',              8,  'Battalion/brigade oversight'),
  ('COMMANDER',         'Formation Commander (Brigadier – General)',      9,  'Division/corps level access'),
  ('AUDITOR',           'Internal Auditor / Inspector / VCAO',           4,  'Read-only plus audit logs'),
  ('SYSTEM_ADMIN',      'System Administrator (Technical Staff)',         10, 'Full system access')
ON CONFLICT (name) DO NOTHING;

-- Day 67: a hardcoded 12-unit sample hierarchy ("21 Corps HQ" ...) used to be
-- seeded here directly via SQL. It has been removed — proven (via pg-mem,
-- since no live Postgres is reachable in this sandbox) to deterministically
-- corrupt command_units on the very first real run: this migration's raw
-- INSERT and the runtime seed-demo-data.js script (SEED_DEMO_DATA=true) both
-- independently assign unit ids starting at 1 for two entirely different,
-- unrelated demo hierarchies ("21 Corps" here vs. "14 RR Brigade" there).
-- UnitManagementService._dbWrite()'s `ON CONFLICT (id) DO UPDATE` then
-- silently overwrites unit_name/active/location/commander_id on the
-- migration's rows while leaving their unit_code/unit_type/parent_unit_id
-- untouched — producing self-contradictory rows (e.g. unit_code='CORPS-21'
-- paired with unit_name='14 RAJPUTANA RIFLES BRIGADE'). This table's data
-- was never read back by the live app either way (it always serves from
-- UnitManagementService's in-memory Map — see that file's header), so this
-- was invisible to every demo/UI check but corrupted the SQL audit trail
-- from the first boot with a real database. Nothing else in this codebase
-- (no other migration, no app code, no docs) referenced these 12 specific
-- unit codes. See verify-day-67.js for the permanent regression guard and
-- the Day 67 handoff notes for the full incident writeup. seed-demo-data.js
-- (via SEED_DEMO_DATA=true) is this project's one real, actively-used demo
-- dataset; it needs no separate SQL-level counterpart.
