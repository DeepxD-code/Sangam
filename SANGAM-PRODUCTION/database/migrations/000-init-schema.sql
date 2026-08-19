-- =============================================================
-- SANGAM Day 000: Baseline Schema
-- This runs FIRST before all day-N migrations.
-- Establishes the users table and schema_migrations tracker.
-- =============================================================

-- Migration tracking (idempotent self-reference)
CREATE TABLE IF NOT EXISTS schema_migrations (
  id           SERIAL      PRIMARY KEY,
  filename     VARCHAR(200) UNIQUE NOT NULL,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms  INTEGER
);

-- Users table (referenced by Day 13 RBAC, Day 14 auth)
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL       PRIMARY KEY,
  username        VARCHAR(100) UNIQUE NOT NULL,
  display_name    VARCHAR(200) NOT NULL,
  email           VARCHAR(200),
  password_hash   VARCHAR(255),
  role            VARCHAR(50)  NOT NULL DEFAULT 'SOLDIER',
  unit_id         INTEGER,
  unit_code       VARCHAR(20),
  last_login      TIMESTAMPTZ,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  account_locked  BOOLEAN  NOT NULL DEFAULT false,
  locked_until    TIMESTAMPTZ,
  active          BOOLEAN  NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Basic indexes on users
CREATE INDEX IF NOT EXISTS idx_users_username    ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_role        ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_unit_id     ON users (unit_id);
CREATE INDEX IF NOT EXISTS idx_users_active      ON users (active) WHERE active = true;

-- Default system admin account (password must be changed on first login)
-- Password: AdminSANGAM@2026 (bcrypt hash — change immediately in production)
INSERT INTO users (username, display_name, role, unit_code)
VALUES ('admin', 'System Administrator', 'SYSTEM_ADMIN', 'HQ')
ON CONFLICT (username) DO NOTHING;
