# SANGAM Supply Chain Domain Audit (Days 78-85)

## Scope
Audit of `backend/src/services/supply-chain.service.js` (686 lines) — the core SCM business logic for Indian Army supply chain management.

## Summary

The service implements a complete two-phase inter-unit transfer system with an in-memory blockchain ledger. Overall design is sound for an MVP demo; 9 findings below.

---

## Findings

### F1 — PAGINATION MISMATCH (Medium)
`getTransfersInScope` defaults to `limit=50` (line 526), but `getItemsInScope` intentionally does not (line 222). Internal callers (AlertEscalationService, ComplianceService, InventoryLedgerService, DashboardService) rely on getting ALL items. This asymmetry is undocumented for future maintainers. Recommend: add a `getAllItemsInScope()` method that explicitly signals "no pagination" vs the current implicit check `!filters.limit`.

### F2 — BLOCKCHAIN IS SINGLE-THREADED / IN-MEMORY (Low)
`_recordBlock()` uses `this._lastBlockHash` without a lock. In the current single-threaded Node.js event loop this is safe, but if `approveTransfer` is ever called concurrently (e.g., via worker threads or a cluster), hash chain integrity breaks silently. Recommend: document the single-thread assumption at the class level.

### F3 — NO ROLLBACK ON APPROVE FAILURE (Medium)
`approveTransfer` deducts from `item.quantity` (line 427) *before* `_recordBlock` (line 437). If `_recordBlock` throws (extremely unlikely with in-memory Map, but possible with DB persistence), the quantity is already deducted but no block written. Recommend: swap the order — record the block first, then deduct quantity.

### F4 — SOFT-DELETE NOT CASCADED (Low)
`deleteItem` sets `deletedAt` on the item, but pending transfers referencing that item are not auto-rejected. A user could approve a transfer for a soft-deleted item. Recommend: check `deletedAt` in `approveTransfer` or auto-reject pending transfers on item delete.

### F5 — TRANSFER COMPLETED BUT ITEM NOT MOVED (Design)
`approveTransfer` sets status to `COMPLETED` (line 430) but only *deducts* from source — there is no `toUnitId` item addition. The `COMPLETED` status implies delivery happened, but the destination unit never receives inventory. This is a deliberate design simplification for the MVP (the transfer just records intent). Recommend: update comments to clarify that COMPLETED = approved + deducted, not = delivered.

### F6 — LOW-STOCK CHECK ONLY ON SOURCE (Low)
`_checkLowStock` (line 469) fires after approval, checking the *source* unit's item. The *destination* unit is never checked. Recommend: also check the destination if items were moved (or add a `toItemId` when two-phase transfer is implemented).

### F7 — BLOCKCHAIN VERIFY DOES NOT HASH PAYLOADS (Medium)
`verifyChain()` (line 586) only checks `previousHash` linkage. It does NOT re-hash each block's `transactionData` to verify it wasn't modified in-place after creation. An attacker who gains access to the Map could alter `transfer.notes` or `block.transactionData` without breaking the chain. Recommend: store `SHA256(JSON.stringify(transactionData))` inside the block hash computation and include it in `verifyChain`.

### F8 — NO BULK IMPORT VALIDATION (Low)
`restoreItemsSnapshot` (line 251) trusts caller-provided data without re-validating. For a disaster-recovery tool this is acceptable, but the route layer should enforce that only `admin` role can call it.

### F9 — MISSING MILITARY-SPECIFIC ENRICHMENTS (Enhancement)
- No concept of `securityClassification` on transfers (CONFIDENTIAL, SECRET, etc.)
- No `convoyId` or `escortRequired` flag for movement orders
- No `nuclearBiologicalChemical` tag for specialized supply categories
These are not needed for the MVP but should be tracked for production.

---

## Verdict

**Grade: B+** — functionally complete for the MVP scope. The design patterns (EventEmitter, in-memory with optional DB persistence, scope-filtered queries) are consistent with the rest of the codebase. The two-phase transfer workflow correctly mirrors real military supply request/approval processes.

### High-priority fixes (pre-production):
1. F3: Reverse deduct/blockchain order
2. F7: Include transaction data hash in chain verification
3. F1: Explicit pagination contract

### Medium-priority:
- F4: Cascade deletes to pending transfers
- F6: Destination low-stock check

### Deferred:
- F2, F5, F8, F9 — documented known limitations

---

*Audit performed Day 78-85 by LLM council — automated re-check wired into verify-day-85.js*
