'use strict';

const EventEmitter = require('events');
const RBACService  = require('./rbac.service');

/**
 * SANGAM Supply Chain Service
 *
 * Core supply-chain operations: items inventory and inter-unit transfers.
 *
 * This is the first service that exercises the complete stack end-to-end:
 *   auth (Day 14) → RBAC+scope (Day 13) → supply ops (Day 19)
 *   → blockchain record (Day 19) → low-stock notification (Day 11)
 *
 * Works in offline-first mode (in-memory Maps) with optional DB
 * persistence — same pattern as NotificationService and DelegationService.
 *
 * Key design decisions:
 *   - Items have unit_id (which unit holds them) — supply:read is always
 *     filtered to command scope (callers pass scope IDs from RBACService)
 *   - Transfers are two-phase: PENDING (requester) → APPROVED (approver)
 *     → COMPLETED (quantity actually moves); REJECTED short-circuits
 *   - Every APPROVED transfer writes a blockchain block (in-memory ledger)
 *     and fires notifyLowStock() if destination drops below threshold
 *   - quantity is never allowed to go negative (throws INSUFFICIENT_STOCK)
 */
class SupplyChainService extends EventEmitter {

  static TRANSFER_STATUS = {
    PENDING:   'PENDING',
    APPROVED:  'APPROVED',
    REJECTED:  'REJECTED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
  };

  static ITEM_CATEGORIES = [
    'AMMO', 'RATIONS', 'FUEL', 'MEDICAL', 'EQUIPMENT',
    'COMMS', 'VEHICLE_PARTS', 'CLOTHING', 'ENGINEERING', 'GENERAL'
  ];

  constructor(db, rbac = null, notifications = null, auditLog = null) {
    super();
    this.db            = db;
    this.rbac          = rbac || new RBACService(db);
    this.notifications = notifications;
    this.auditLog      = auditLog;

    // In-memory stores
    this._items     = new Map(); // itemId -> item
    this._transfers = new Map(); // transferId -> transfer
    this._blocks    = new Map(); // blockIndex -> block

    this._nextItemId     = 1;
    this._nextTransferId = 1;
    this._nextBlockIndex = 1;
    this._lastBlockHash  = '0'.repeat(64);

    this._stats = {
      itemsCreated: 0, transfersInitiated: 0,
      transfersApproved: 0, transfersRejected: 0,
      blocksRecorded: 0, lowStockAlerts: 0
    };

    // Day 68: tracks in-flight fire-and-forget SQL writes (_persistItem,
    // _persistTransfer, etc.) so bulk-creation callers — the demo seeder,
    // and potentially the bulk-import route — can explicitly wait for
    // dependent rows to actually land in SQL before creating rows that
    // reference them, without changing the live per-request path's
    // deliberate fire-and-forget timing at all. See flushPendingWrites()
    // and the Day 68 handoff notes for the incident that motivated this
    // (a real, observed foreign-key race between items and transfers
    // during rapid bulk seeding against genuine PostgreSQL).
    this._pendingWrites = new Set();
  }

  /**
   * Fire off a best-effort SQL write without blocking the caller (the
   * existing, deliberate pattern for this class), while still tracking
   * it so flushPendingWrites() can wait for it later if needed. Never
   * throws — mirrors the .catch(()=>{}) behavior every existing call
   * site already had.
   */
  _trackWrite(promise) {
    const tracked = promise.catch(err => console.error('[supply-chain] persist error:', err.message));
    this._pendingWrites.add(tracked);
    tracked.finally(() => this._pendingWrites.delete(tracked));
    return tracked;
  }

  /**
   * Waits for every currently in-flight fire-and-forget SQL write to
   * settle. Intended for bulk-creation callers that need dependent rows
   * (e.g. a transfer referencing an item) to exist in SQL before the
   * next write — the live per-request path does NOT call this and is
   * unaffected. Safe to call even when db is null (resolves immediately,
   * nothing to wait for).
   */
  async flushPendingWrites() {
    await Promise.allSettled([...this._pendingWrites]);
  }

  // ============================================================
  // ITEMS
  // ============================================================

  /**
   * Create a new supply item for a unit.
   * Requires supply:write permission (enforced at route layer).
   *
   * @param {object} params - { itemCode, itemName, category, unitId, quantity, unitOfMeasure, lowStockThreshold }
   * @returns {{ success: true, item }} or { success: false, error }
   */
  async createItem(params) {
    const { itemCode, itemName, category, unitId, quantity = 0,
            unitOfMeasure = 'EA', lowStockThreshold = 0,
            createdByUserId = null } = params;

    if (!itemCode || !itemName || !category || !unitId) {
      return { success: false, error: 'MISSING_REQUIRED_FIELDS',
               message: 'itemCode, itemName, category, and unitId are required' };
    }

    if (!SupplyChainService.ITEM_CATEGORIES.includes(category)) {
      return { success: false, error: 'INVALID_CATEGORY',
               message: `Category must be one of: ${SupplyChainService.ITEM_CATEGORIES.join(', ')}` };
    }

    const parsedQty = Number(quantity);
    if (isNaN(parsedQty) || parsedQty < 0) {
      return { success: false, error: 'INVALID_QUANTITY',
               message: 'quantity must be a number >= 0' };
    }
    const parsedThreshold = Number(lowStockThreshold);
    if (isNaN(parsedThreshold) || parsedThreshold < 0) {
      return { success: false, error: 'INVALID_THRESHOLD',
               message: 'lowStockThreshold must be a number >= 0' };
    }

    // Check duplicate itemCode
    const existing = Array.from(this._items.values())
      .find(i => i.itemCode === itemCode && i.unitId === unitId && !i.deletedAt);
    if (existing) {
      return { success: false, error: 'ITEM_CODE_EXISTS',
               message: `Item code ${itemCode} already exists for this unit` };
    }

    const item = {
      id: this._nextItemId++,
      itemCode, itemName, category,
      unitId: parseInt(unitId, 10),
      quantity: Math.max(0, parseInt(quantity, 10) || 0),
      unitOfMeasure,
      lowStockThreshold: Math.max(0, parseInt(lowStockThreshold, 10) || 0),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    };

    this._items.set(item.id, item);
    this._stats.itemsCreated++;

    if (this.db) this._trackWrite(this._persistItem(item));

    await this._audit({
      userId: createdByUserId,
      action: 'SUPPLY_CREATE', resource: 'supply_items', resourceId: String(item.id),
      details: { itemCode, itemName, category, unitId, quantity },
      success: true
    });

    this.emit('item:created', item);
    return { success: true, item };
  }

  /**
   * Get items visible to a user (filtered to their command scope).
   *
   * @param {number[]} scopeUnitIds - unit IDs from RBACService.getCommandScope()
   * @param {object}   [filters]   - { category, unitId, lowStockOnly, search }
   */
  getItemsInScope(scopeUnitIds, filters = {}) {
    let items = Array.from(this._items.values())
      .filter(i => !i.deletedAt && scopeUnitIds.includes(i.unitId));

    if (filters.unitId) {
      items = items.filter(i => i.unitId === parseInt(filters.unitId, 10));
    }
    if (filters.category) {
      items = items.filter(i => i.category === filters.category);
    }
    if (filters.lowStockOnly) {
      items = items.filter(i => i.quantity < i.lowStockThreshold);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      items = items.filter(i =>
        i.itemName.toLowerCase().includes(q) ||
        i.itemCode.toLowerCase().includes(q)
      );
    }

    // Sort: unit → category → name
    items.sort((a, b) =>
      a.unitId - b.unitId ||
      a.category.localeCompare(b.category) ||
      a.itemName.localeCompare(b.itemName)
    );

    // Pagination (Day 62), strictly opt-in — unlike getTransfersInScope's
    // "default to 50 if unspecified" pattern, items has 6 internal callers
    // (AlertEscalationService's low-stock scan, ComplianceService's
    // discrepancy report + summary, InventoryLedgerService's stocktake
    // setup, DashboardService's summary widget) that call this with no
    // limit at all and correctness-depend on getting the COMPLETE
    // filtered set — a low-stock scan or discrepancy report that silently
    // only checked the first 50 items in a large unit would be a much
    // worse bug than the one this is fixing. Only the HTTP route passes
    // an explicit limit (from query params); every internal caller is
    // unaffected and keeps getting everything, exactly as before.
    const total = items.length;
    if (!filters.limit) {
      return { items, total };
    }
    const limit  = Math.min(filters.limit, 500);
    const offset = filters.offset || 0;
    return { items: items.slice(offset, offset + limit), total, limit, offset };
  }

  // ================================================================
  // SNAPSHOT / RESTORE  (Day 63 — admin-only backup tooling)
  // ================================================================

  /**
   * Return every item, including soft-deleted ones — a backup should be
   * able to reconstruct exact prior state, not just what's currently
   * visible. (Contrast with getItemsInScope(), which correctly excludes
   * soft-deleted items for normal operational use — that exclusion is
   * intentional there and would be wrong here.)
   */
  exportItemsSnapshot() {
    return [...this._items.values()].map(i => ({ ...i }));
  }

  /**
   * Replace all items with a previously-exported snapshot, preserving
   * exact IDs and advancing the ID counter past the restored max. Direct
   * state replacement for disaster recovery, not the normal createItem()
   * path — the snapshot was already valid when exported.
   */
  restoreItemsSnapshot(itemsArray) {
    if (!Array.isArray(itemsArray)) {
      return { success: false, error: 'INVALID_SNAPSHOT', message: 'Expected an array of items' };
    }
    this._items = new Map(itemsArray.map(i => [i.id, { ...i }]));
    const maxId = itemsArray.reduce((max, i) => Math.max(max, i.id || 0), 0);
    this._nextItemId = maxId + 1;
    return { success: true, count: itemsArray.length };
  }

  /**
   * Get a single item by ID (no scope check — caller must verify).
   */
  getItemById(id) {
    const item = this._items.get(parseInt(id, 10));
    return item && !item.deletedAt ? item : null;
  }

  /**
   * Update item quantity directly (e.g., for stock-taking / adjustments).
   * Requires supply:write. Quantity cannot go below 0.
   */
  async updateItem(id, updates, actorUserId = null) {
    const item = this.getItemById(id);
    if (!item) return { success: false, error: 'ITEM_NOT_FOUND' };

    const before = { ...item };

    if (updates.quantity !== undefined) {
      const newQty = parseInt(updates.quantity, 10);
      if (isNaN(newQty) || newQty < 0) {
        return { success: false, error: 'INVALID_QUANTITY', message: 'Quantity must be ≥ 0' };
      }
      item.quantity = newQty;
    }
    if (updates.itemName)          item.itemName = updates.itemName;
    if (updates.lowStockThreshold !== undefined) {
      item.lowStockThreshold = Math.max(0, parseInt(updates.lowStockThreshold, 10) || 0);
    }
    if (updates.unitOfMeasure)     item.unitOfMeasure = updates.unitOfMeasure;

    item.updatedAt = new Date().toISOString();

    await this._audit({
      userId: actorUserId, action: 'SUPPLY_UPDATE',
      resource: 'supply_items', resourceId: String(id),
      details: { before: { quantity: before.quantity }, after: { quantity: item.quantity } },
      success: true
    });

    // Check low-stock after update
    await this._checkLowStock(item);

    this.emit('item:updated', item);
    return { success: true, item };
  }

  /**
   * Soft-delete an item. Requires supply:delete.
   */
  async deleteItem(id, actorUserId = null) {
    const item = this.getItemById(id);
    if (!item) return { success: false, error: 'ITEM_NOT_FOUND' };

    item.deletedAt = new Date().toISOString();
    item.updatedAt = item.deletedAt;

    await this._audit({
      userId: actorUserId, action: 'SUPPLY_DELETE',
      resource: 'supply_items', resourceId: String(id), success: true
    });

    this.emit('item:deleted', item);
    return { success: true };
  }

  // ============================================================
  // TRANSFERS
  // ============================================================

  /**
   * Initiate a transfer request. Requires supply:transfer.
   * Creates a PENDING transfer; a user with supply:approve must approve it.
   *
   * @param {object} params - { itemId, fromUnitId, toUnitId, quantity, requestedByUserId, notes }
   */
  async initiateTransfer(params) {
    const { itemId, fromUnitId, toUnitId, quantity, requestedByUserId, notes = '' } = params;

    if (!itemId || !fromUnitId || !toUnitId || !quantity) {
      return { success: false, error: 'MISSING_REQUIRED_FIELDS',
               message: 'itemId, fromUnitId, toUnitId, and quantity are required' };
    }

    const parsedQty = parseInt(quantity, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      return { success: false, error: 'INVALID_QUANTITY', message: 'Quantity must be > 0' };
    }

    const item = this.getItemById(itemId);
    if (!item) return { success: false, error: 'ITEM_NOT_FOUND' };

    if (item.unitId !== parseInt(fromUnitId, 10)) {
      return { success: false, error: 'ITEM_NOT_IN_FROM_UNIT',
               message: 'Item does not belong to the specified fromUnit' };
    }

    if (item.quantity < parsedQty) {
      return { success: false, error: 'INSUFFICIENT_STOCK',
               message: `Only ${item.quantity} units available, requested ${parsedQty}` };
    }

    const transfer = {
      id: this._nextTransferId++,
      itemId: parseInt(itemId, 10),
      itemName: item.itemName,
      itemCode: item.itemCode,
      fromUnitId: parseInt(fromUnitId, 10),
      toUnitId:   parseInt(toUnitId, 10),
      quantity:   parsedQty,
      status: SupplyChainService.TRANSFER_STATUS.PENDING,
      requestedByUserId: requestedByUserId || null,
      approvedByUserId:  null,
      notes,
      createdAt: new Date().toISOString(),
      decidedAt: null
    };

    this._transfers.set(transfer.id, transfer);
    this._stats.transfersInitiated++;

    if (this.db) this._trackWrite(this._persistTransfer(transfer));

    await this._audit({
      userId: requestedByUserId, action: 'SUPPLY_TRANSFER_INITIATE',
      resource: 'transfers', resourceId: String(transfer.id),
      details: { itemId, itemCode: item.itemCode, fromUnitId, toUnitId, quantity: parsedQty },
      success: true
    });

    // Notify potential approvers at fromUnit
    if (this.notifications) {
      await this.notifications.notifyTransferPending({
        transferId: transfer.id,
        itemName:   item.itemName,
        quantity:   parsedQty,
        fromUnitId: parseInt(fromUnitId, 10),
        toUnitId:   parseInt(toUnitId, 10)
      }).catch(err => console.error('[supply-chain] notifyTransferPending error:', err.message));
    }

    this.emit('transfer:initiated', transfer);
    return { success: true, transfer };
  }

  /**
   * Approve a transfer. Requires supply:approve.
   * Deducts quantity from fromUnit item; writes a blockchain block.
   */
  async approveTransfer(transferId, approverUserId) {
    const transfer = this._transfers.get(parseInt(transferId, 10));
    if (!transfer) return { success: false, error: 'TRANSFER_NOT_FOUND' };
    if (transfer.status !== SupplyChainService.TRANSFER_STATUS.PENDING) {
      return { success: false, error: 'INVALID_STATUS',
               message: `Cannot approve a ${transfer.status} transfer` };
    }

    const item = this.getItemById(transfer.itemId);
    if (!item) return { success: false, error: 'ITEM_NOT_FOUND' };

    if (item.quantity < transfer.quantity) {
      return { success: false, error: 'INSUFFICIENT_STOCK',
               message: `Stock dropped since request: ${item.quantity} available, ${transfer.quantity} needed` };
    }

    // Record on blockchain ledger FIRST — if this fails, quantity isn't
    // deducted and the transfer stays PENDING (F3 fix per Day 85 audit)
    const block = await this._recordBlock({
      type: 'TRANSFER',
      transferId: transfer.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      quantity: transfer.quantity,
      fromUnitId: transfer.fromUnitId,
      toUnitId:   transfer.toUnitId,
      approvedBy: approverUserId
    });

    // Deduct from source (after successful block record)
    item.quantity -= transfer.quantity;
    item.updatedAt = new Date().toISOString();

    transfer.status           = SupplyChainService.TRANSFER_STATUS.COMPLETED;
    transfer.approvedByUserId = approverUserId;
    transfer.decidedAt        = new Date().toISOString();

    this._stats.transfersApproved++;

    // Store blockchain reference on the transfer for detail view
    transfer.blockIndex = block.blockIndex;
    transfer.blockHash  = block.blockHash;

    await this._audit({
      userId: approverUserId, action: 'SUPPLY_TRANSFER_APPROVE',
      resource: 'transfers', resourceId: String(transferId),
      details: { itemId: transfer.itemId, itemCode: item.itemCode, quantity: transfer.quantity,
                 fromUnitId: transfer.fromUnitId, blockIndex: block.blockIndex },
      success: true
    });

    // Notify requester (personal)
    if (this.notifications) {
      await this.notifications.notifyTransferDecision({
        transferId: transfer.id, itemName: item.itemName,
        approved: true, requestedByUserId: transfer.requestedByUserId
      }).catch(err => console.error('[supply-chain] notifyTransferDecision error:', err.message));
    }

    // Check if source item is now low-stock
    await this._checkLowStock(item);

    this.emit('transfer:approved', transfer, block);
    return { success: true, transfer, block };
  }

  /**
   * Reject a transfer. Requires supply:approve.
   */
  async rejectTransfer(transferId, rejectorUserId, reason = '') {
    const transfer = this._transfers.get(parseInt(transferId, 10));
    if (!transfer) return { success: false, error: 'TRANSFER_NOT_FOUND' };
    if (transfer.status !== SupplyChainService.TRANSFER_STATUS.PENDING) {
      return { success: false, error: 'INVALID_STATUS',
               message: `Cannot reject a ${transfer.status} transfer` };
    }

    const item = this.getItemById(transfer.itemId);
    if (!item) return { success: false, error: 'ITEM_NOT_FOUND' };

    transfer.status        = SupplyChainService.TRANSFER_STATUS.REJECTED;
    transfer.decidedAt     = new Date().toISOString();
    transfer.rejectionNote = reason;

    this._stats.transfersRejected++;

    await this._audit({
      userId: rejectorUserId, action: 'SUPPLY_TRANSFER_REJECT',
      resource: 'transfers', resourceId: String(transferId),
      details: { itemId: transfer.itemId, itemCode: transfer.itemCode, reason }, success: true
    });

    if (this.notifications) {
      await this.notifications.notifyTransferDecision({
        transferId: transfer.id, itemName: item.itemName,
        approved: false, requestedByUserId: transfer.requestedByUserId
      }).catch(err => console.error('[supply-chain] notifyTransferDecision error:', err.message));
    }

    this.emit('transfer:rejected', transfer);
    return { success: true, transfer };
  }

  /**
   * Get transfers visible to a user (filtered by command scope).
   */
  getTransfersInScope(scopeUnitIds, filters = {}) {
    let transfers = Array.from(this._transfers.values())
      .filter(t => scopeUnitIds.includes(t.fromUnitId) ||
                   scopeUnitIds.includes(t.toUnitId));

    if (filters.status) {
      transfers = transfers.filter(t => t.status === filters.status);
    }
    if (filters.itemId) {
      transfers = transfers.filter(t => t.itemId === parseInt(filters.itemId, 10));
    }

    transfers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const limit  = Math.min(filters.limit || 50, 500);
    const offset = filters.offset || 0;

    return {
      transfers: transfers.slice(offset, offset + limit),
      total:     transfers.length,
      limit, offset
    };
  }

  getTransferById(id) {
    return this._transfers.get(parseInt(id, 10)) || null;
  }

  // ============================================================
  // BLOCKCHAIN LEDGER
  // ============================================================

  async _recordBlock(transactionData) {
    const previousHash = this._lastBlockHash;
    const blockIndex   = this._nextBlockIndex++;
    const content = JSON.stringify({
      previousHash,
      blockIndex,
      transactionData,
      timestamp: new Date().toISOString()
    });
    const blockHash = require('crypto')
      .createHash('sha256').update(content).digest('hex');

    const block = {
      blockIndex,
      blockHash,
      previousHash,
      transactionData,
      transactionCount: 1,
      createdAt: new Date().toISOString()
    };

    this._blocks.set(blockIndex, block);
    this._lastBlockHash = blockHash;
    this._stats.blocksRecorded++;

    if (this.db) this._trackWrite(this._persistBlock(block));
    this.emit('block:created', block);
    return block;
  }

  getBlocks(limit = 20) {
    const blocks = Array.from(this._blocks.values())
      .sort((a, b) => b.blockIndex - a.blockIndex)
      .slice(0, Math.min(limit, 100));
    return { blocks, totalBlocks: this._blocks.size };
  }

  getBlockByIndex(idx) {
    return this._blocks.get(parseInt(idx, 10)) || null;
  }

  /** Verify the in-memory blockchain's hash chain integrity. */
  verifyChain() {
    const blocks = Array.from(this._blocks.values())
      .sort((a, b) => a.blockIndex - b.blockIndex);

    const tampered = [];
    let previousHash = '0'.repeat(64);

    for (const block of blocks) {
      if (block.previousHash !== previousHash) {
        tampered.push({ blockIndex: block.blockIndex, reason: 'previousHash mismatch' });
      }
      previousHash = block.blockHash;
    }

    return {
      verified: tampered.length === 0,
      blockCount: blocks.length,
      tampered
    };
  }

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  async _checkLowStock(item) {
    if (item.quantity < item.lowStockThreshold && this.notifications) {
      this._stats.lowStockAlerts++;
      await this.notifications.notifyLowStock({
        itemName:   item.itemName,
        currentQty: item.quantity,
        threshold:  item.lowStockThreshold,
        unitId:     item.unitId,
        itemId:     item.id
      }).catch(err => console.error('[supply-chain] notifyLowStock error:', err.message));
    }
  }

  async _audit(entry) {
    if (this.auditLog) await this.auditLog.log(entry).catch(err => console.error('[supply-chain] audit error:', err.message));
  }

  async _persistItem(item) {
    if (!this.db) return;
    // Day 68: supply_items has no created_at column at all (see
    // day-12-reporting-schema.sql) — this INSERT referenced one anyway,
    // meaning it failed with a Postgres error on every single call since
    // the day it was written, 100% of the time, whenever db was
    // non-null. Silently swallowed by the .catch(()=>{}) at the call
    // site, so supply_items has always been completely empty in SQL —
    // confirmed by running this against a real, temporarily-installed
    // local PostgreSQL 16 for the first time in this project's history.
    await this.db.query(`
      INSERT INTO supply_items
        (id, item_code, item_name, category, unit_id, quantity,
         unit_of_measure, low_stock_threshold, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET
        quantity = EXCLUDED.quantity, updated_at = EXCLUDED.updated_at
    `, [item.id, item.itemCode, item.itemName, item.category, item.unitId,
        item.quantity, item.unitOfMeasure, item.lowStockThreshold,
        item.updatedAt]);
  }

  async _persistTransfer(transfer) {
    if (!this.db) return;
    await this.db.query(`
      INSERT INTO transfers
        (id, item_id, from_unit_id, to_unit_id, quantity, status,
         requested_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
        approved_by = $9, decided_at = $10
    `, [transfer.id, transfer.itemId, transfer.fromUnitId, transfer.toUnitId,
        transfer.quantity, transfer.status, transfer.requestedByUserId,
        transfer.createdAt, transfer.approvedByUserId, transfer.decidedAt]);
  }

  async _persistBlock(block) {
    if (!this.db) return;
    await this.db.query(`
      INSERT INTO blockchain_blocks
        (block_index, block_hash, previous_hash, transaction_count, transaction_data, created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (block_index) DO NOTHING
    `, [block.blockIndex, block.blockHash, block.previousHash,
        block.transactionCount, JSON.stringify(block.transactionData), block.createdAt]);
  }

  getStats() {
    return {
      ...this._stats,
      activeItems:      Array.from(this._items.values()).filter(i => !i.deletedAt).length,
      pendingTransfers: Array.from(this._transfers.values())
        .filter(t => t.status === 'PENDING').length,
      chainLength:      this._blocks.size
    };
  }
}

module.exports = SupplyChainService;
