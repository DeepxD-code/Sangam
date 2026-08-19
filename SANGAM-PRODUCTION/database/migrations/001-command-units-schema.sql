-- =============================================================
-- SANGAM: Command Unit Hierarchy Schema
-- =============================================================
-- Day 68: extracted from day-13-rbac-schema.sql into its own,
-- earlier-numbered file. command_units was originally defined
-- inside day-13, but day-12-reporting-schema.sql has hard foreign
-- key references to command_units(id) (supply_items.unit_id,
-- transfers.from_unit_id/to_unit_id) plus a reporting view joining
-- against it. Migration files run in numeric filename order
-- (000, 11, 12, 13, ...), so day-12 was running BEFORE day-13 ever
-- created the table it depends on — confirmed for real (not
-- theorized) by running the actual migration runner against a real
-- local PostgreSQL 16 instance installed for this purpose, which
-- failed with: relation "command_units" does not exist. This had
-- never been caught before because no test in this project's
-- history — offline in-memory suite or otherwise — had ever run the
-- full migration chain against a real database; see the Day 68
-- handoff notes for the full incident writeup.
--
-- Numbered 001 (rather than renaming any existing day-NN file) to
-- preserve this project's day-numbered migration history exactly as
-- it actually happened — this fix adds a new file rather than
-- rewriting which development day produced which existing file.
-- Sorts immediately after 000-init-schema.sql and before every
-- day-NN file via run-migrations.js's numeric sortKey().
-- =============================================================

CREATE TABLE IF NOT EXISTS command_units (
  id             SERIAL       PRIMARY KEY,
  unit_name      VARCHAR(100) NOT NULL,
  unit_type      VARCHAR(30)  NOT NULL
    CHECK (unit_type IN ('SECTION','PLATOON','COMPANY','BATTALION',
                         'BRIGADE','DIVISION','CORPS','COMMAND')),
  unit_code      VARCHAR(20)  UNIQUE NOT NULL,
  parent_unit_id INTEGER      REFERENCES command_units(id),
  commander_id   INTEGER,     -- FK to users.id (set after users table exists)
  location       VARCHAR(100),
  active         BOOLEAN      NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- command_units: recursive CTE traversal (RBACService.getCommandScope)
CREATE INDEX IF NOT EXISTS idx_units_parent     ON command_units (parent_unit_id);
CREATE INDEX IF NOT EXISTS idx_units_type       ON command_units (unit_type);
CREATE INDEX IF NOT EXISTS idx_units_code       ON command_units (unit_code);
CREATE INDEX IF NOT EXISTS idx_units_active     ON command_units (active) WHERE active = true;
