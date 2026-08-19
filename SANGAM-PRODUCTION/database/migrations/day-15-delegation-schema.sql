-- =============================================================
-- SANGAM Day 15: Delegation & Override Schema
-- =============================================================
-- Tables added:
--   delegations          — temporary, scoped permission grants
--   permission_overrides — single-use emergency exceptions
--
-- Both tables are append-mostly (like audit_logs / notifications):
-- a delegation is REVOKED (revoked_at set), never deleted; an override
-- is USED and/or REVIEWED (used_at / reviewed_at set), never deleted.
-- This preserves a complete history for after-action review.
-- =============================================================

-- ------------------------------------------------------------
-- 1. Delegations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delegations (
  id                SERIAL       PRIMARY KEY,
  delegator_user_id INTEGER      NOT NULL,
  delegate_user_id  INTEGER      NOT NULL,
  permission        VARCHAR(50)  NOT NULL,
  unit_id           INTEGER      NOT NULL REFERENCES command_units(id),
  reason            TEXT         NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ  NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoked_by        INTEGER,
  revocation_reason TEXT,

  CHECK (expires_at > created_at),
  CHECK (delegator_user_id <> delegate_user_id)
);

-- ------------------------------------------------------------
-- 2. Permission Overrides (emergency, single-use)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_overrides (
  id                SERIAL       PRIMARY KEY,
  user_id           INTEGER      NOT NULL,
  permission        VARCHAR(50)  NOT NULL,
  attempted_unit_id INTEGER      REFERENCES command_units(id),
  justification     TEXT         NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ  NOT NULL,
  used_at           TIMESTAMPTZ,
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       INTEGER,

  CHECK (expires_at > created_at),
  CHECK (char_length(justification) >= 10)
);

-- =============================================================
-- INDEXES
-- =============================================================

-- Hot path: "does this user have an active delegation for X?"
CREATE INDEX IF NOT EXISTS idx_delegations_delegate
  ON delegations (delegate_user_id, permission)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_delegations_delegator
  ON delegations (delegator_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_delegations_expires
  ON delegations (expires_at);

-- Hot path: "does this user have an active override for X at unit Y?"
CREATE INDEX IF NOT EXISTS idx_overrides_active
  ON permission_overrides (user_id, permission, attempted_unit_id)
  WHERE used_at IS NULL;

-- Review queue: unreviewed overrides, oldest first
CREATE INDEX IF NOT EXISTS idx_overrides_pending_review
  ON permission_overrides (created_at)
  WHERE reviewed_at IS NULL;

-- =============================================================
-- HELPER VIEWS
-- =============================================================

-- Currently-active delegations (not revoked, not expired)
CREATE OR REPLACE VIEW active_delegations AS
SELECT id, delegator_user_id, delegate_user_id, permission, unit_id, reason,
       created_at, expires_at
FROM   delegations
WHERE  revoked_at IS NULL
  AND  expires_at > NOW();

-- Overrides awaiting Senior-Officer review, with hours-pending for
-- escalation (Day 11 SECURITY_ALERT already fires at issuance; this
-- view supports a periodic "still unreviewed" sweep)
CREATE OR REPLACE VIEW pending_override_reviews AS
SELECT id, user_id, permission, attempted_unit_id, justification,
       created_at, used_at,
       EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0 AS hours_pending
FROM   permission_overrides
WHERE  reviewed_at IS NULL
ORDER  BY created_at ASC;
