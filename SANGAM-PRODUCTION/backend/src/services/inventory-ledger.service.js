'use strict';

/**
 * SANGAM Inventory Stock-Take Service  (Day 24)
 *
 * Army units must periodically conduct a Board of Survey (physical stock count).
 * Any discrepancy between the count and system records must be documented,
 * explained, and approved by an officer before the ledger is corrected.
 *
 * Session lifecycle:
 *   OPEN → COUNTING → PENDING_APPROVAL → RECONCILED
 *                                       → CANCELLED (from any pre-reconciled state)
 *
 * Only one active (OPEN or COUNTING) session per unit at a time.
 *
 * Methods:
 *   createSession(params)                      → start a new stock-take
 *   recordCount(sessionId, itemId, count, uid) → log physical count for one item
 *   finalizeSession(sessionId, actorId)        → close counting, compute discrepancies
 *   approveReconciliation(sessionId, approverId) → apply counts, write blockchain block
 *   cancelSession(sessionId, actorId, reason)  → abort
 *   getSession(sessionId)                      → full detail (counts + discrepancies)
 *   getSessionsForUnit(unitId, filters)        → paginated session list
 *   getActiveSession(unitId)                   → current open/counting session or null
 */

const crypto = require('crypto');

const SESSION_STATES = {
  OPEN:             'OPEN',
  COUNTING:         'COUNTING',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  RECONCILED:       'RECONCILED',
  CANCELLED:        'CANCELLED'
};

const ACTIVE_STATES = new Set([SESSION_STATES.OPEN, SESSION_STATES.COUNTING]);

class InventoryLedgerService {

  /**
   * @param {object} db           - pg Pool (null = offline)
   * @param {object} supplyChain  - SupplyChainService instance
   * @param {object} auditLog     - AuditLogService instance
   * @param {object} notifications - NotificationService instance
   */
  constructor(db, supplyChain, auditLog = null, notifications = null) {
    this.db            = db;
    this.supply        = supplyChain;
    this.auditLog      = auditLog;
    this.notifications = notifications;

    this._sessions = new Map();   // sessionId → session
    this._counts   = new Map();   // sessionId → Map(itemId → countRecord)
    this._nextId   = 1;

    this._stats = {
      sessionsCreated:    0,
      sessionsReconciled: 0,
      sessionsCancelled:  0,
      itemsCounted:       0,
      discrepanciesFound: 0
    };
  }

  // ================================================================
  // 1. CREATE SESSION
  // ================================================================

  /**
   * @param {object} params
   *   unitId       {number} required
   *   actorUserId  {number}
   *   notes        {string}
   */
  async createSession(params) {
    const { unitId, actorUserId = null, notes = '' } = params || {};

    if (!unitId) {
      return { success: false, error: 'MISSING_UNIT_ID' };
    }

    // One active session per unit
    const existing = this.getActiveSession(unitId);
    if (existing) {
      return {
        success: false, error: 'ACTIVE_SESSION_EXISTS',
        message: `Unit ${unitId} already has an active session (${existing.id})`,
        existingSessionId: existing.id
      };
    }

    const id  = this._nextId++;
    const now = new Date().toISOString();

    const session = {
      id,
      unitId: parseInt(unitId, 10),
      state:  SESSION_STATES.OPEN,
      notes,
      createdByUserId:  actorUserId,
      approvedByUserId: null,
      cancelledReason:  null,
      itemsExpected:    0,
      itemsCounted:     0,
      discrepancies:    [],
      createdAt:        now,
      updatedAt:        now,
      finalizedAt:      null,
      reconciledAt:     null
    };

    this._sessions.set(id, session);
    this._counts.set(id, new Map());
    this._stats.sessionsCreated++;

    // Pre-populate with items in the unit so counters know what to expect
    const { items } = this.supply.getItemsInScope([parseInt(unitId, 10)]);
    session.itemsExpected = items.length;

    await this._audit({
      userId: actorUserId, action: 'STOCKTAKE_SESSION_CREATE',
      resource: 'stocktake_sessions', resourceId: String(id),
      details: { unitId, itemsExpected: items.length, notes },
      success: true
    });

    return { success: true, session: { ...session } };
  }

  // ================================================================
  // 2. RECORD COUNT
  // ================================================================

  /**
   * Record the physical count for a single item within a session.
   * Calling again for the same item overwrites the previous count.
   *
   * @param {number} sessionId
   * @param {number} itemId
   * @param {number} physicalCount
   * @param {number} actorUserId
   * @param {string} notes
   */
  async recordCount(sessionId, itemId, physicalCount, actorUserId = null, notes = '') {
    const session = this._sessions.get(parseInt(sessionId, 10));
    if (!session) return { success: false, error: 'SESSION_NOT_FOUND' };

    if (!ACTIVE_STATES.has(session.state)) {
      return {
        success: false, error: 'SESSION_NOT_ACTIVE',
        message: `Session is ${session.state}, counts can only be added to OPEN or COUNTING sessions`
      };
    }

    if (physicalCount === undefined || physicalCount === null) {
      return { success: false, error: 'MISSING_COUNT' };
    }

    const count = parseInt(physicalCount, 10);
    if (isNaN(count) || count < 0) {
      return { success: false, error: 'INVALID_COUNT', message: 'count must be ≥ 0' };
    }

    // Verify item exists and belongs to this session's unit
    const item = this.supply.getItemById(itemId);
    if (!item) return { success: false, error: 'ITEM_NOT_FOUND' };
    if (item.unitId !== session.unitId) {
      return {
        success: false, error: 'ITEM_UNIT_MISMATCH',
        message: `Item ${itemId} belongs to unit ${item.unitId}, session is for unit ${session.unitId}`
      };
    }

    const countsMap = this._counts.get(session.id);
    const isUpdate  = countsMap.has(itemId);

    const countRecord = {
      itemId:        parseInt(itemId, 10),
      itemCode:      item.itemCode,
      itemName:      item.itemName,
      systemQty:     item.quantity,
      physicalCount: count,
      delta:         count - item.quantity,
      notes,
      recordedByUserId: actorUserId,
      recordedAt:    new Date().toISOString()
    };

    countsMap.set(parseInt(itemId, 10), countRecord);

    // Move session to COUNTING once first count recorded
    if (session.state === SESSION_STATES.OPEN) {
      session.state = SESSION_STATES.COUNTING;
    }

    session.itemsCounted = countsMap.size;
    session.updatedAt    = new Date().toISOString();

    if (!isUpdate) this._stats.itemsCounted++;

    return { success: true, count: { ...countRecord }, session: { ...session } };
  }

  // ================================================================
  // 3. FINALIZE SESSION
  // ================================================================

  /**
   * Close counting, compute discrepancies, move to PENDING_APPROVAL.
   * Any item in the unit's inventory that was NOT counted is flagged as
   * NOT_COUNTED with delta = null.
   */
  async finalizeSession(sessionId, actorUserId = null) {
    const session = this._sessions.get(parseInt(sessionId, 10));
    if (!session) return { success: false, error: 'SESSION_NOT_FOUND' };

    if (!ACTIVE_STATES.has(session.state)) {
      return {
        success: false, error: 'SESSION_NOT_ACTIVE',
        message: `Cannot finalize a session in state ${session.state}`
      };
    }

    const countsMap  = this._counts.get(session.id);
    const { items }  = this.supply.getItemsInScope([session.unitId]);
    const discrepancies = [];

    for (const item of items) {
      const countRecord = countsMap.get(item.id);
      if (!countRecord) {
        // Item not counted
        discrepancies.push({
          itemId:   item.id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          systemQty: item.quantity,
          physicalCount: null,
          delta:    null,
          type:     'NOT_COUNTED'
        });
      } else if (countRecord.delta !== 0) {
        discrepancies.push({
          itemId:        item.id,
          itemCode:      item.itemCode,
          itemName:      item.itemName,
          systemQty:     countRecord.systemQty,
          physicalCount: countRecord.physicalCount,
          delta:         countRecord.delta,
          type:          countRecord.delta > 0 ? 'SURPLUS' : 'DEFICIT'
        });
      }
    }

    session.state       = SESSION_STATES.PENDING_APPROVAL;
    session.discrepancies = discrepancies;
    session.finalizedAt   = new Date().toISOString();
    session.updatedAt     = new Date().toISOString();
    session.itemsCounted  = countsMap.size;
    this._stats.discrepanciesFound += discrepancies.length;

    await this._audit({
      userId: actorUserId, action: 'STOCKTAKE_SESSION_FINALIZE',
      resource: 'stocktake_sessions', resourceId: String(sessionId),
      details: {
        unitId:      session.unitId,
        itemsCounted: countsMap.size,
        itemsExpected: session.itemsExpected,
        discrepancyCount: discrepancies.length
      },
      success: true,
      severity: discrepancies.length > 0 ? 'WARNING' : 'INFO'
    });

    return {
      success: true,
      session: { ...session },
      discrepancies,
      summary: {
        itemsCounted:    countsMap.size,
        itemsExpected:   session.itemsExpected,
        discrepancies:   discrepancies.length,
        surpluses:       discrepancies.filter(d => d.type === 'SURPLUS').length,
        deficits:        discrepancies.filter(d => d.type === 'DEFICIT').length,
        notCounted:      discrepancies.filter(d => d.type === 'NOT_COUNTED').length
      }
    };
  }

  // ================================================================
  // 4. APPROVE RECONCILIATION
  // ================================================================

  /**
   * Officer approves the discrepancies; system quantities updated to match
   * physical counts. A blockchain block is written for each reconciled item.
   * Items that were NOT_COUNTED are left unchanged.
   */
  async approveReconciliation(sessionId, approverUserId = null) {
    const session = this._sessions.get(parseInt(sessionId, 10));
    if (!session) return { success: false, error: 'SESSION_NOT_FOUND' };

    if (session.state !== SESSION_STATES.PENDING_APPROVAL) {
      return {
        success: false, error: 'INVALID_STATE',
        message: `Session must be in PENDING_APPROVAL state (current: ${session.state})`
      };
    }

    const countsMap   = this._counts.get(session.id);
    const reconciled  = [];
    const skipped     = [];

    for (const [itemId, countRecord] of countsMap.entries()) {
      if (countRecord.delta === 0) {
        skipped.push({ itemId, reason: 'NO_DISCREPANCY' });
        continue;
      }

      // Update system quantity to match physical count
      const updateResult = await this.supply.updateItem(
        itemId,
        { quantity: countRecord.physicalCount },
        approverUserId
      );

      if (updateResult.success) {
        reconciled.push({
          itemId,
          itemCode:      countRecord.itemCode,
          oldQty:        countRecord.systemQty,
          newQty:        countRecord.physicalCount,
          delta:         countRecord.delta
        });
      } else {
        skipped.push({ itemId, reason: updateResult.error });
      }
    }

    session.state            = SESSION_STATES.RECONCILED;
    session.approvedByUserId = approverUserId;
    session.reconciledAt     = new Date().toISOString();
    session.updatedAt        = new Date().toISOString();
    this._stats.sessionsReconciled++;

    await this._audit({
      userId: approverUserId, action: 'STOCKTAKE_RECONCILE',
      resource: 'stocktake_sessions', resourceId: String(sessionId),
      details: {
        unitId: session.unitId,
        reconciledItems: reconciled.length,
        skippedItems:    skipped.length
      },
      success: true, severity: 'WARNING'
    });

    return {
      success: true,
      session:    { ...session },
      reconciled,
      skipped,
      summary: {
        totalCounted:    countsMap.size,
        reconciledCount: reconciled.length,
        skippedCount:    skipped.length
      }
    };
  }

  // ================================================================
  // 5. CANCEL SESSION
  // ================================================================

  async cancelSession(sessionId, actorUserId = null, reason = '') {
    const session = this._sessions.get(parseInt(sessionId, 10));
    if (!session) return { success: false, error: 'SESSION_NOT_FOUND' };

    if (session.state === SESSION_STATES.RECONCILED) {
      return { success: false, error: 'ALREADY_RECONCILED',
               message: 'Cannot cancel a reconciled session' };
    }
    if (session.state === SESSION_STATES.CANCELLED) {
      return { success: false, error: 'ALREADY_CANCELLED' };
    }

    session.state           = SESSION_STATES.CANCELLED;
    session.cancelledReason = reason;
    session.updatedAt       = new Date().toISOString();
    this._stats.sessionsCancelled++;

    await this._audit({
      userId: actorUserId, action: 'STOCKTAKE_SESSION_CANCEL',
      resource: 'stocktake_sessions', resourceId: String(sessionId),
      details: { unitId: session.unitId, reason },
      success: true
    });

    return { success: true, session: { ...session } };
  }

  // ================================================================
  // 6. GET SESSION
  // ================================================================

  getSession(sessionId) {
    const session = this._sessions.get(parseInt(sessionId, 10));
    if (!session) return null;

    const countsMap = this._counts.get(session.id) || new Map();
    const counts    = [...countsMap.values()];

    return {
      ...session,
      counts,
      countedItemIds: counts.map(c => c.itemId)
    };
  }

  // ================================================================
  // 7. GET SESSIONS FOR UNIT
  // ================================================================

  getSessionsForUnit(unitId, filters = {}) {
    const { state, limit = 20, offset = 0 } = filters;
    const uid = parseInt(unitId, 10);

    let sessions = [...this._sessions.values()].filter(s => s.unitId === uid);
    if (state) sessions = sessions.filter(s => s.state === state);

    sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = sessions.length;
    const page  = sessions.slice(offset, offset + limit);

    return { sessions: page.map(s => ({ ...s })), total, limit, offset };
  }

  // ================================================================
  // 8. GET ACTIVE SESSION
  // ================================================================

  getActiveSession(unitId) {
    const uid = parseInt(unitId, 10);
    return [...this._sessions.values()]
      .find(s => s.unitId === uid && ACTIVE_STATES.has(s.state)) || null;
  }

  // ================================================================
  // STATIC METADATA
  // ================================================================

  static get SESSION_STATES() { return SESSION_STATES; }

  getStats() {
    return { ...this._stats, totalSessions: this._sessions.size };
  }

  // ================================================================
  // INTERNALS
  // ================================================================

  async _audit(entry) {
    if (this.auditLog) await this.auditLog.log(entry).catch(err => console.error('[inventory-ledger] audit error:', err.message));
  }
}

module.exports = InventoryLedgerService;
