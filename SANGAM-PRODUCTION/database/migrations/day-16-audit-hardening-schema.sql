-- =============================================================
-- SANGAM Day 16: Audit Hardening — Schema Additions
-- =============================================================
-- Day 16 is primarily a SERVICE layer change (AuditHardeningService
-- encrypts/decrypts at the application level). The database schema
-- itself requires minimal changes — the `details` column on
-- audit_logs and `justification` on permission_overrides already
-- exist and store TEXT/JSONB; we just start writing encrypted
-- ciphertext strings instead of plaintext.
--
-- Schema changes here:
--   1. Add `encryption_version` to audit_logs so we can distinguish
--      old plaintext rows from new encrypted rows during a migration
--      or key rotation (lets the service apply lazy decryption only
--      where needed).
--   2. Convert `details` to TEXT (if JSONB) — encrypted ciphertext is
--      not valid JSON, so JSONB would reject it. Done with IF NOT
--      EXISTS guard so it's a no-op on fresh installs that use TEXT.
--   3. Add `encryption_version` to permission_overrides for the same
--      justification field.
-- =============================================================

-- Add encryption_version column to audit_logs
DO $$ BEGIN
  ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS encryption_version SMALLINT DEFAULT 0;
  -- 0 = plaintext (legacy), 1 = AES-256-GCM (Day 16+)
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add encryption_version column to permission_overrides
DO $$ BEGIN
  ALTER TABLE permission_overrides ADD COLUMN IF NOT EXISTS encryption_version SMALLINT DEFAULT 0;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- If details was created as JSONB, alter to TEXT to accept ciphertext.
-- This is safe because existing plaintext JSON can be stored in TEXT,
-- and application-side reads already handle JSON.parse().
DO $$ BEGIN
  -- Only attempt if column type is jsonb
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs'
      AND column_name = 'details'
      AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE audit_logs ALTER COLUMN details TYPE TEXT USING details::text;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- =============================================================
-- INDEX
-- =============================================================

-- Support per-version queries (e.g. "find plaintext rows still to migrate")
CREATE INDEX IF NOT EXISTS idx_audit_encryption_version
  ON audit_logs (encryption_version)
  WHERE encryption_version = 0;

CREATE INDEX IF NOT EXISTS idx_override_encryption_version
  ON permission_overrides (encryption_version)
  WHERE encryption_version = 0;

-- =============================================================
-- HELPER VIEW — encryption coverage summary
-- =============================================================
CREATE OR REPLACE VIEW audit_encryption_status AS
SELECT
  encryption_version,
  COUNT(*)::int AS row_count,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM audit_logs
GROUP BY encryption_version
ORDER BY encryption_version;
