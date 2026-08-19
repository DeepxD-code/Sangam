-- =============================================================
-- SANGAM Day 11: Notification & Alert Service Schema
-- =============================================================
-- Tables added:
--   notifications             — broadcast/personal alert definitions
--   notification_reads        — per-user read/acknowledge tracking
--   notification_preferences  — per-user type mute settings
--
-- Design note: notifications are immutable (never deleted/edited
-- after creation) — mirroring the audit_logs immutability model
-- from Day 13. "Dismiss" = per-user read + acknowledge record.
--
-- Note: source_unit_id intentionally has NO foreign key constraint
-- to command_units. This keeps the notification system decoupled —
-- it degrades gracefully (global visibility check) if the unit
-- hierarchy table is unavailable, consistent with RBACService's
-- own fallback behaviour in getCommandScope().
-- =============================================================

-- ------------------------------------------------------------
-- 1. Notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL    PRIMARY KEY,
  type            VARCHAR(30)  NOT NULL
    CHECK (type IN (
      'LOW_STOCK','TRANSFER_PENDING','TRANSFER_APPROVED','TRANSFER_REJECTED',
      'MESH_PEER_OFFLINE','MESH_PEER_ONLINE','SYNC_CONFLICT',
      'SECURITY_ALERT','BLOCKCHAIN_TAMPER','SYSTEM_ANNOUNCEMENT'
    )),
  severity        VARCHAR(10)  NOT NULL DEFAULT 'MEDIUM'
    CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  title           VARCHAR(200) NOT NULL,
  message         TEXT         NOT NULL,

  -- Scoped-broadcast targeting
  source_unit_id  INTEGER,                 -- NULL = Army-wide
  min_rank_level  INTEGER      NOT NULL DEFAULT 1 CHECK (min_rank_level BETWEEN 1 AND 10),

  -- Personal targeting (overrides scope when set)
  target_user_id  INTEGER,
  target_role     VARCHAR(50),

  -- What this notification is about
  resource_type   VARCHAR(50),
  resource_id     VARCHAR(100),

  requires_ack    BOOLEAN      NOT NULL DEFAULT false,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- 2. Per-user Read / Acknowledge Tracking
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id BIGINT      NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id          INTEGER     NOT NULL,
  read_at          TIMESTAMPTZ,
  acknowledged_at  TIMESTAMPTZ,
  PRIMARY KEY (notification_id, user_id)
);

-- ------------------------------------------------------------
-- 3. Per-user Type Preferences
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id           INTEGER     NOT NULL,
  notification_type VARCHAR(30) NOT NULL,
  enabled           BOOLEAN     NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, notification_type)
);

-- =============================================================
-- INDEXES
-- =============================================================

-- Hot path: "give me visible, unread, recent notifications"
CREATE INDEX IF NOT EXISTS idx_notif_created       ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_source_unit   ON notifications (source_unit_id) WHERE source_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notif_target_user   ON notifications (target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notif_type          ON notifications (type);
CREATE INDEX IF NOT EXISTS idx_notif_severity      ON notifications (severity) WHERE severity IN ('HIGH','CRITICAL');
CREATE INDEX IF NOT EXISTS idx_notif_requires_ack  ON notifications (requires_ack) WHERE requires_ack = true;
CREATE INDEX IF NOT EXISTS idx_notif_expires       ON notifications (expires_at) WHERE expires_at IS NOT NULL;

-- notification_reads: per-user unread lookups
CREATE INDEX IF NOT EXISTS idx_notif_reads_user    ON notification_reads (user_id);
CREATE INDEX IF NOT EXISTS idx_notif_reads_unread  ON notification_reads (user_id) WHERE read_at IS NULL;

-- =============================================================
-- HELPER VIEW — pending acknowledgements (command dashboard)
-- =============================================================
CREATE OR REPLACE VIEW pending_acknowledgements AS
SELECT n.id, n.type, n.severity, n.title, n.message,
       n.source_unit_id, n.min_rank_level, n.created_at
FROM   notifications n
WHERE  n.requires_ack = true
  AND  NOT EXISTS (
        SELECT 1 FROM notification_reads r
        WHERE  r.notification_id = n.id
          AND  r.acknowledged_at IS NOT NULL
      )
ORDER  BY n.severity DESC, n.created_at ASC;
