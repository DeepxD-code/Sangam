-- =============================================================
-- SANGAM Day 12: Reporting & Analytics — Supporting Schema
-- =============================================================
-- ReportingService aggregates across three tables that originate
-- from earlier sprint days (supply_items, transfers,
-- blockchain_blocks). These CREATE TABLE IF NOT EXISTS statements
-- are a SAFETY NET — they do not redefine those tables if already
-- present, but ensure a fresh database can run the full reporting
-- suite standalone for demo purposes.
--
-- No new tables are introduced for mesh-health or the
-- pending-acknowledgment portion of security-posture — those are
-- derived live from Day 11's notifications table and Day 13's
-- audit_logs table respectively.
-- =============================================================

-- ------------------------------------------------------------
-- 1. Supply Items (inventory, per unit)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_items (
  id                  SERIAL       PRIMARY KEY,
  item_code           VARCHAR(50)  UNIQUE NOT NULL,
  item_name           VARCHAR(150) NOT NULL,
  category            VARCHAR(50)  NOT NULL,
  unit_id             INTEGER      NOT NULL REFERENCES command_units(id),
  quantity            INTEGER      NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_of_measure     VARCHAR(20)  NOT NULL DEFAULT 'EA',
  low_stock_threshold INTEGER      NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. Transfers (between units)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
  id            SERIAL       PRIMARY KEY,
  item_id       INTEGER      NOT NULL REFERENCES supply_items(id),
  from_unit_id  INTEGER      NOT NULL REFERENCES command_units(id),
  to_unit_id    INTEGER      NOT NULL REFERENCES command_units(id),
  quantity      INTEGER      NOT NULL CHECK (quantity > 0),
  status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','COMPLETED','CANCELLED')),
  requested_by  INTEGER,
  approved_by   INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  decided_at    TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- 3. Blockchain Blocks (supply-chain transaction ledger)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blockchain_blocks (
  block_index       BIGINT       PRIMARY KEY,
  block_hash        CHAR(64)     NOT NULL,
  previous_hash     CHAR(64)     NOT NULL,
  transaction_count INTEGER      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================
-- INDEXES — support the WHERE unit_id = ANY($1) aggregation pattern
-- =============================================================

-- supply_items: stock-level report groups by (unit_id, category)
CREATE INDEX IF NOT EXISTS idx_supply_items_unit      ON supply_items (unit_id);
CREATE INDEX IF NOT EXISTS idx_supply_items_category  ON supply_items (unit_id, category);
CREATE INDEX IF NOT EXISTS idx_supply_items_low_stock ON supply_items (unit_id)
  WHERE quantity < low_stock_threshold;

-- transfers: report filters by unit (either direction) + time window + status
CREATE INDEX IF NOT EXISTS idx_transfers_from         ON transfers (from_unit_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to           ON transfers (to_unit_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status       ON transfers (status);
CREATE INDEX IF NOT EXISTS idx_transfers_created      ON transfers (created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_pending      ON transfers (from_unit_id, to_unit_id)
  WHERE status = 'PENDING';

-- blockchain_blocks: latest-block lookup
CREATE INDEX IF NOT EXISTS idx_blocks_created         ON blockchain_blocks (created_at DESC);

-- =============================================================
-- HELPER VIEW — per-unit stock summary (used by dashboards beyond
-- ReportingService too, e.g. future mobile widgets)
-- =============================================================
CREATE OR REPLACE VIEW unit_stock_summary AS
SELECT cu.id AS unit_id, cu.unit_code, cu.unit_name, cu.unit_type,
       COUNT(si.id)::int                                                AS item_count,
       COALESCE(SUM(si.quantity), 0)::int                               AS total_quantity,
       COALESCE(SUM(CASE WHEN si.quantity < si.low_stock_threshold
                          THEN 1 ELSE 0 END), 0)::int                    AS low_stock_count
FROM   command_units cu
LEFT JOIN supply_items si ON si.unit_id = cu.id
GROUP  BY cu.id, cu.unit_code, cu.unit_name, cu.unit_type;
