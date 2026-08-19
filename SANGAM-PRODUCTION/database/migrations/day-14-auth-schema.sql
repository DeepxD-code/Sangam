-- =============================================================
-- SANGAM Day 14: Auth Login Flow — Schema Additions
-- =============================================================
-- AuthService relies on:
--   users.password_hash, users.locked_until  (added here defensively —
--     account_locked / failed_login_count / last_login were added in
--     the Day 13 migration)
--   refresh_tokens (created in Day 13 migration — used here for
--     rotation; no structural change needed)
--
-- This migration is intentionally small: Day 14 is a SERVICE addition
-- (login/refresh/lockout logic) more than a schema addition. The one
-- new column (locked_until) plus a username index and an operational
-- view are all that's required.
-- =============================================================

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until   TIMESTAMPTZ;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------

-- Login is a lookup by username — this is the hottest query in the system
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (username);

-- Operational: "show me everyone currently locked out"
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users (locked_until)
  WHERE account_locked = true;

-- ------------------------------------------------------------
-- Operational view — locked accounts dashboard
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW locked_accounts AS
SELECT id, username, display_name, role, unit_code,
       failed_login_count, locked_until,
       (locked_until IS NOT NULL AND locked_until <= NOW()) AS eligible_for_auto_unlock
FROM   users
WHERE  account_locked = true
ORDER  BY locked_until ASC;
