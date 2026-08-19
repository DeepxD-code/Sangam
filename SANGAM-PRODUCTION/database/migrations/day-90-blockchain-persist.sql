-- =============================================================
-- SANGAM Day 90 — Blockchain Ledger Durability
-- Adds transaction_data column so the complete block survives
-- container restarts (council verdict fix #2).
-- =============================================================

ALTER TABLE blockchain_blocks
  ADD COLUMN IF NOT EXISTS transaction_data JSONB;
