'use strict';

/**
 * SANGAM Compliance Reporting Service  (Day 20)
 *
 * Produces legally meaningful compliance artefacts from the audit log,
 * supply chain state, and blockchain ledger.
 *
 * Report types:
 *   getChainOfCustody(itemId, scopeUnitIds)        → full item history
 *   getTransferRegister(scopeUnitIds, filters)     → filtered transfer list
 *   getDiscrepancyReport(scopeUnitIds, supply)     → quantity vs blockchain delta
 *   getAuditExport(filters)                        → filtered audit log dump
 *   getComplianceSummary(userContext, services)    → Senior Officer dashboard
 *   exportToCSV(rows)                             → generic CSV serialiser
 *
 * All methods are offline-safe (in-memory first, DB fallback).
 */

class ComplianceService {

  /**
   * @param {object} db             - pg Pool (null in offline mode)
   * @param {object} auditLog       - AuditLogService instance
   * @param {object} supplyChain    - SupplyChainService instance
   * @param {object} notifications  - NotificationService instance
   */
  constructor(db, auditLog, supplyChain, notifications = null) {
    this.db            = db;
    this.auditLog      = auditLog;
    this.supplyChain   = supplyChain;
    this.notifications = notifications;
  }

  // ================================================================
  // 1. CHAIN OF CUSTODY
  // ================================================================

  /**
   * Return the complete custody history of a single supply item.
   *
   * Sources the audit log for all supply-related actions on this item,
   * then chronologically orders them to build a provenance chain.
   *
   * @param {number|string} itemId
   * @param {number[]}      scopeUnitIds  - caller's command scope
   * @returns {{ success, itemId, item, events, exportedAt }}
   */
  async getChainOfCustody(itemId, scopeUnitIds) {
    const id   = parseInt(itemId, 10);
    const item = this.supplyChain.getItemById(id);

    if (!item) {
      return { success: false, error: 'ITEM_NOT_FOUND' };
    }

    // Scope check — item must belong to a unit in the caller's authority
    if (!scopeUnitIds.includes(item.unitId)) {
      return { success: false, error: 'UNIT_OUT_OF_SCOPE' };
    }

    // Pull supply-related audit entries for this item
    const SUPPLY_ACTIONS = new Set([
      'SUPPLY_CREATE', 'SUPPLY_UPDATE', 'SUPPLY_DELETE',
      'SUPPLY_TRANSFER_INITIATE', 'SUPPLY_TRANSFER_APPROVE',
      'SUPPLY_TRANSFER_REJECT'
    ]);

    const entries = this._getAuditEntries({
      resource:   'supply_items',
      resourceId: String(id)
    }).filter(e => SUPPLY_ACTIONS.has(e.action));

    // Also include transfer records that reference this item
    const transferEntries = this._getAuditEntries({
      resource: 'transfers'
    }).filter(e => {
      const d = e.details || {};
      return d.itemId === id || String(d.itemId) === String(id);
    });

    // Merge and sort by timestamp
    const all = [...entries, ...transferEntries]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Deduplicate by id (audit entries may appear in both queries)
    const seen   = new Set();
    const events = [];
    for (const e of all) {
      const key = e.id || `${e.action}-${e.timestamp}`;
      if (!seen.has(key)) {
        seen.add(key);
        events.push(this._formatCustodyEvent(e));
      }
    }

    return {
      success:    true,
      itemId:     id,
      item:       { ...item },
      eventCount: events.length,
      events,
      exportedAt: new Date().toISOString()
    };
  }

  _formatCustodyEvent(entry) {
    return {
      timestamp:  entry.timestamp || entry.createdAt,
      action:     entry.action,
      actorId:    entry.userId,
      resource:   entry.resource,
      resourceId: entry.resourceId,
      success:    entry.success,
      severity:   entry.severity || 'INFO',
      details:    entry.details || {}
    };
  }

  // ================================================================
  // 2. TRANSFER REGISTER
  // ================================================================

  /**
   * Return all transfers in scope, enriched with audit metadata.
   *
   * @param {number[]} scopeUnitIds
   * @param {object}   filters - { status, startDate, endDate, itemId, limit, offset }
   * @returns {{ success, transfers, total, generatedAt }}
   */
  getTransferRegister(scopeUnitIds, filters = {}) {
    const { status, startDate, endDate, itemId,
            limit = 100, offset = 0 } = filters;

    let { transfers } = this.supplyChain.getTransfersInScope(scopeUnitIds, {
      status, itemId, limit: 500 // pull wide then filter
    });

    // Date filter
    if (startDate) {
      const start = new Date(startDate);
      transfers = transfers.filter(t => new Date(t.createdAt) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      transfers = transfers.filter(t => new Date(t.createdAt) <= end);
    }

    const total = transfers.length;
    const page  = transfers.slice(offset, offset + limit);

    return {
      success:     true,
      transfers:   page.map(t => this._enrichTransfer(t)),
      total,
      limit,
      offset,
      generatedAt: new Date().toISOString()
    };
  }

  _enrichTransfer(t) {
    // Pull the approve/reject audit entry to attach approver detail
    const decisionEntry = this._getAuditEntries({ resource: 'transfers', resourceId: String(t.id) })
      .find(e => e.action === 'SUPPLY_TRANSFER_APPROVE' || e.action === 'SUPPLY_TRANSFER_REJECT');

    return {
      transferId:        t.id,
      itemCode:          t.itemCode,
      itemName:          t.itemName,
      fromUnitId:        t.fromUnitId,
      toUnitId:          t.toUnitId,
      quantity:          t.quantity,
      status:            t.status,
      requestedByUserId: t.requestedByUserId,
      approvedByUserId:  t.approvedByUserId || null,
      notes:             t.notes || '',
      rejectionNote:     t.rejectionNote || '',
      createdAt:         t.createdAt,
      decidedAt:         t.decidedAt || null,
      auditVerified:     !!decisionEntry
    };
  }

  // ================================================================
  // 3. DISCREPANCY REPORT
  // ================================================================

  /**
   * Compare current item quantities against blockchain-derived expected values.
   *
   * For each approved transfer, the source item loses `quantity` units.
   * Expected quantity = initial_quantity - SUM(approved outbound transfers)
   *                                      + SUM(approved inbound transfers)
   *
   * A delta ≠ 0 indicates a direct stock adjustment (may be legitimate)
   * or a tamper event.
   *
   * @param {number[]} scopeUnitIds
   * @returns {{ success, discrepancies, cleanItems, generatedAt }}
   */
  getDiscrepancyReport(scopeUnitIds) {
    const { items } = this.supplyChain.getItemsInScope(scopeUnitIds);
    const { transfers } = this.supplyChain.getTransfersInScope(scopeUnitIds, { limit: 500 });

    // Build item balance from blockchain-visible transfers only
    const balanceDelta = new Map(); // itemId → net transfer delta

    for (const t of transfers) {
      if (t.status !== 'COMPLETED') continue;

      const delta = balanceDelta.get(t.itemId) || 0;
      if (scopeUnitIds.includes(t.fromUnitId)) {
        balanceDelta.set(t.itemId, delta - t.quantity); // outbound
      }
      if (scopeUnitIds.includes(t.toUnitId)) {
        balanceDelta.set(t.itemId, (balanceDelta.get(t.itemId) || 0) + t.quantity); // inbound
      }
    }

    // For each item, compute expected vs actual
    const discrepancies = [];
    const cleanItems    = [];

    for (const item of items) {
      // Pull creation audit entry to find initial quantity
      const createEntry = this._getAuditEntries({
        resource: 'supply_items', resourceId: String(item.id)
      }).find(e => e.action === 'SUPPLY_CREATE');

      const initialQty = createEntry?.details?.quantity ?? item.quantity;
      const transferNet = balanceDelta.get(item.id) || 0;
      const expectedQty = initialQty + transferNet;
      const actualQty   = item.quantity;
      const delta       = actualQty - expectedQty;

      if (delta !== 0) {
        discrepancies.push({
          itemId:       item.id,
          itemCode:     item.itemCode,
          itemName:     item.itemName,
          unitId:       item.unitId,
          initialQty,
          transferNet,
          expectedQty,
          actualQty,
          delta,
          severity:     Math.abs(delta) > 10 ? 'HIGH' : 'LOW'
        });
      } else {
        cleanItems.push({ itemId: item.id, itemCode: item.itemCode });
      }
    }

    return {
      success:        true,
      discrepancies,
      cleanItems,
      totalItems:     items.length,
      discrepancyCount: discrepancies.length,
      generatedAt:    new Date().toISOString()
    };
  }

  // ================================================================
  // 4. AUDIT EXPORT
  // ================================================================

  /**
   * Filtered export of audit log entries.
   *
   * @param {object} filters - { severity, action, userId, resource,
   *                             startDate, endDate, limit }
   * @returns {{ success, entries, total, exportedAt }}
   */
  getAuditExport(filters = {}) {
    const { severity, action, userId, resource,
            startDate, endDate, limit = 500 } = filters;

    let entries = this._getAuditEntries({});

    if (severity) {
      const levels = Array.isArray(severity) ? severity : [severity];
      entries = entries.filter(e => levels.includes(e.severity));
    }
    if (action) {
      entries = entries.filter(e =>
        e.action === action || e.action?.startsWith(action));
    }
    if (userId !== undefined) {
      entries = entries.filter(e => String(e.userId) === String(userId));
    }
    if (resource) {
      entries = entries.filter(e => e.resource === resource);
    }
    if (startDate) {
      const start = new Date(startDate);
      entries = entries.filter(e => new Date(e.timestamp || e.createdAt) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      entries = entries.filter(e => new Date(e.timestamp || e.createdAt) <= end);
    }

    entries.sort((a, b) =>
      new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));

    const capped = entries.slice(0, Math.min(limit, 1000));

    return {
      success:    true,
      entries:    capped.map(e => this._sanitiseAuditEntry(e)),
      total:      entries.length,
      capped:     capped.length < entries.length,
      exportedAt: new Date().toISOString()
    };
  }

  _sanitiseAuditEntry(e) {
    return {
      id:         e.id,
      timestamp:  e.timestamp || e.createdAt,
      userId:     e.userId,
      action:     e.action,
      resource:   e.resource,
      resourceId: e.resourceId,
      success:    e.success,
      severity:   e.severity || 'INFO',
      ipAddress:  e.ipAddress || null,
      logHash:    e.logHash || null,
      // Details may be AES-encrypted; export as-is (decrypt at route layer for authorised callers)
      details:    typeof e.details === 'object' ? e.details : {}
    };
  }

  // ================================================================
  // 5. COMPLIANCE SUMMARY
  // ================================================================

  /**
   * Aggregate compliance metrics for the Senior Officer dashboard.
   *
   * @param {object}   userContext - req.user with unitId
   * @param {number[]} scopeUnitIds
   * @returns {{ success, summary }}
   */
  getComplianceSummary(userContext, scopeUnitIds) {
    // Transfer metrics
    const { transfers, total: totalTransfers } =
      this.supplyChain.getTransfersInScope(scopeUnitIds, { limit: 500 });

    const completed  = transfers.filter(t => t.status === 'COMPLETED').length;
    const rejected   = transfers.filter(t => t.status === 'REJECTED').length;
    const pending    = transfers.filter(t => t.status === 'PENDING').length;
    const approvalRate = totalTransfers > 0
      ? Math.round((completed / totalTransfers) * 100)
      : 100;

    // Item metrics
    const { items } = this.supplyChain.getItemsInScope(scopeUnitIds);
    const lowStockItems = items.filter(i =>
      i.lowStockThreshold > 0 && i.quantity < i.lowStockThreshold);

    // Blockchain integrity
    const chainResult = this.supplyChain.verifyChain();

    // Audit metrics (last 24 h)
    const since24h  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const allAudit  = this._getAuditEntries({});
    const recent24h = allAudit.filter(e =>
      (e.timestamp || e.createdAt) > since24h);
    const securityEvents = allAudit.filter(e =>
      e.severity === 'SECURITY' || e.severity === 'CRITICAL');

    // Supply chain stats
    const supplyStats = this.supplyChain.getStats();

    return {
      success: true,
      summary: {
        transfers: {
          total:        totalTransfers,
          completed,
          rejected,
          pending,
          approvalRate: `${approvalRate}%`
        },
        inventory: {
          totalItems:      items.length,
          lowStockItems:   lowStockItems.length,
          lowStockDetails: lowStockItems.map(i => ({
            itemId:    i.id,
            itemCode:  i.itemCode,
            itemName:  i.itemName,
            quantity:  i.quantity,
            threshold: i.lowStockThreshold,
            unitId:    i.unitId
          }))
        },
        blockchain: {
          chainVerified:   chainResult.verified,
          blockCount:      chainResult.blockCount,
          tamperCount:     chainResult.tampered.length
        },
        audit: {
          entriesLast24h:    recent24h.length,
          securityEvents:    securityEvents.length,
          totalEntries:      allAudit.length
        },
        supplyStats,
        generatedAt: new Date().toISOString()
      }
    };
  }

  // ================================================================
  // CSV EXPORT
  // ================================================================

  /**
   * Serialise an array of objects to CSV.
   * Headers are derived from the first row's keys.
   *
   * @param {object[]} rows
   * @param {string[]} [headers] - explicit column order; defaults to first row keys
   * @returns {string} CSV content
   */
  exportToCSV(rows, headers = null) {
    if (!rows || rows.length === 0) return '';

    const cols = headers || Object.keys(rows[0]);
    const esc  = (v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const lines = [cols.join(',')];
    for (const row of rows) {
      lines.push(cols.map(col => esc(row[col])).join(','));
    }
    return lines.join('\n');
  }

  // ================================================================
  // INTERNAL HELPERS
  // ================================================================

  /**
   * Access the audit log's in-memory stores.
   * AuditLogService uses two buffers:
   *   _writeQueue     — entries queued for DB write (most recent)
   *   _inMemoryBuffer — entries held when DB is unavailable
   *
   * @param {object} filters - { resource, resourceId, action }
   */
  _getAuditEntries(filters = {}) {
    if (!this.auditLog) return [];

    const queue  = this.auditLog._writeQueue      || [];
    const buffer = this.auditLog._inMemoryBuffer  || [];

    // Merge; deduplicate by logHash
    const seen    = new Set();
    const entries = [];
    for (const e of [...queue, ...buffer]) {
      const key = e.logHash || `${e.action}-${e.timestamp}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Deserialise details if stored as JSON string
        const details = typeof e.details === 'string'
          ? (() => { try { return JSON.parse(e.details); } catch { return {}; } })()
          : (e.details || {});
        entries.push({ ...e, details });
      }
    }

    let result = entries;
    if (filters.resource) {
      result = result.filter(e => e.resource === filters.resource);
    }
    if (filters.resourceId) {
      result = result.filter(e => String(e.resourceId) === String(filters.resourceId));
    }
    if (filters.action) {
      result = result.filter(e => e.action === filters.action);
    }

    return result;
  }
}

module.exports = ComplianceService;
