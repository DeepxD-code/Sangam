'use strict';

/**
 * SANGAM Bulk Operations Service  (Day 21)
 *
 * Provides batch-level supply operations:
 *
 *   importItemsFromCSV(csvText, unitId, actorUserId)
 *     → Parse CSV, validate each row, create items in bulk.
 *       Returns per-row success/failure; partial success allowed.
 *
 *   bulkTransfer(transfers[], actorUserId)
 *     → Initiate multiple transfers in one call.
 *       Each transfer is independent; failures do not roll back successes.
 *
 *   bulkApprove(transferIds[], approverUserId)
 *     → Approve multiple PENDING transfers.
 *       Processes sequentially to prevent race conditions on shared items.
 *
 *   bulkUpdateQuantity(updates[], actorUserId)
 *     → Batch stock adjustments (e.g. after physical stock-take).
 *
 *   exportItemsToCSV(items[])
 *     → Serialise item array to CSV for download.
 *
 * Design:
 *   - Offline-first: works with SupplyChainService in-memory state
 *   - Partial success semantics: each row/transfer is processed independently
 *   - Result always contains { succeeded[], failed[], summary }
 *   - Max batch size enforced (100 rows for import, 50 for bulk ops)
 *   - Single audit entry per bulk operation (not per row) to avoid log spam
 */

const BULK_LIMITS = {
  CSV_IMPORT:      100,
  BULK_TRANSFER:    50,
  BULK_APPROVE:     50,
  BULK_UPDATE:     100
};

class BulkOperationsService {

  /**
   * @param {object} supplyChain - SupplyChainService instance
   * @param {object} auditLog    - AuditLogService instance
   * @param {object} rbac        - RBACService instance
   */
  constructor(supplyChain, auditLog = null, rbac = null) {
    this.supply   = supplyChain;
    this.auditLog = auditLog;
    this.rbac     = rbac;
  }

  // ================================================================
  // 1. CSV IMPORT
  // ================================================================

  /**
   * Parse and import supply items from CSV text.
   *
   * Expected CSV columns (case-insensitive, order-independent):
   *   itemCode, itemName, category, quantity, unitOfMeasure,
   *   lowStockThreshold
   *
   * unitId is taken from the parameter (all rows must belong to same unit).
   *
   * @param {string}        csvText
   * @param {number|string} unitId
   * @param {number|string} actorUserId
   * @returns {{ success, succeeded, failed, summary }}
   */
  async importItemsFromCSV(csvText, unitId, actorUserId = null) {
    if (!csvText || typeof csvText !== 'string') {
      return { success: false, error: 'EMPTY_CSV', message: 'CSV text is required' };
    }
    if (!unitId) {
      return { success: false, error: 'MISSING_UNIT_ID' };
    }

    const { headers, rows, parseError } = this._parseCSV(csvText);
    if (parseError) {
      return { success: false, error: 'CSV_PARSE_ERROR', message: parseError };
    }
    if (rows.length === 0) {
      return { success: false, error: 'NO_DATA_ROWS', message: 'CSV has headers but no data rows' };
    }
    if (rows.length > BULK_LIMITS.CSV_IMPORT) {
      return {
        success: false, error: 'BATCH_TOO_LARGE',
        message: `Maximum ${BULK_LIMITS.CSV_IMPORT} rows per import`
      };
    }

    // Normalise headers
    const normHeader = (h) => h.trim().toLowerCase().replace(/[\s_-]+/g, '');
    const normHeaders = headers.map(normHeader);

    const col = (row, name) => {
      const idx = normHeaders.indexOf(normHeader(name));
      return idx >= 0 ? (row[idx] || '').trim() : '';
    };

    const succeeded = [];
    const failed    = [];

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i];
      const rowNum = i + 2; // 1-based, +1 for header row

      const params = {
        itemCode:          col(row, 'itemCode'),
        itemName:          col(row, 'itemName'),
        category:          col(row, 'category'),
        unitId:            parseInt(unitId, 10),
        quantity:          parseInt(col(row, 'quantity') || '0', 10),
        unitOfMeasure:     col(row, 'unitOfMeasure') || 'EA',
        lowStockThreshold: parseInt(col(row, 'lowStockThreshold') || '0', 10)
      };

      // Row-level validation
      if (!params.itemCode) {
        failed.push({ row: rowNum, error: 'MISSING_ITEM_CODE', data: params });
        continue;
      }
      if (!params.itemName) {
        failed.push({ row: rowNum, error: 'MISSING_ITEM_NAME', data: params });
        continue;
      }
      if (isNaN(params.quantity) || params.quantity < 0) {
        failed.push({ row: rowNum, error: 'INVALID_QUANTITY',
                      message: 'quantity must be ≥ 0', data: params });
        continue;
      }

      const result = await this.supply.createItem(params);
      if (result.success) {
        succeeded.push({ row: rowNum, itemId: result.item.id, itemCode: params.itemCode });
      } else {
        failed.push({ row: rowNum, error: result.error, message: result.message, data: params });
      }
    }

    // Day 69: same fire-and-forget SQL write exposure identified and
    // fixed in seed-demo-data.js on Day 68 — a bulk import can create
    // many items in a tight loop, and a client that immediately acts on
    // one of them (e.g. creating a transfer in a follow-up request)
    // could race the item's own not-yet-landed SQL write. Flushing here
    // means every succeeded item has actually landed in SQL by the time
    // this request's response is sent, without changing the live
    // single-item creation path (POST /supply/items) at all.
    await this.supply.flushPendingWrites();

    await this._audit({
      userId: actorUserId, action: 'BULK_IMPORT',
      resource: 'supply_items',
      details: {
        unitId, totalRows: rows.length,
        succeeded: succeeded.length, failed: failed.length
      },
      success: failed.length < rows.length
    });

    return {
      success:   true,
      succeeded,
      failed,
      summary: {
        totalRows:     rows.length,
        successCount:  succeeded.length,
        failureCount:  failed.length,
        partialSuccess: succeeded.length > 0 && failed.length > 0
      }
    };
  }

  // ================================================================
  // 2. BULK TRANSFER INITIATE
  // ================================================================

  /**
   * Initiate multiple transfers in one call.
   *
   * @param {Array<{ itemId, fromUnitId, toUnitId, quantity, notes }>} transfers
   * @param {number|string} actorUserId
   * @returns {{ success, succeeded, failed, summary }}
   */
  async bulkTransfer(transfers, actorUserId = null) {
    if (!Array.isArray(transfers) || transfers.length === 0) {
      return { success: false, error: 'EMPTY_LIST', message: 'transfers array is required' };
    }
    if (transfers.length > BULK_LIMITS.BULK_TRANSFER) {
      return {
        success: false, error: 'BATCH_TOO_LARGE',
        message: `Maximum ${BULK_LIMITS.BULK_TRANSFER} transfers per batch`
      };
    }

    const succeeded = [];
    const failed    = [];

    for (let i = 0; i < transfers.length; i++) {
      const t   = transfers[i];
      const idx = i + 1;

      if (!t.itemId || !t.fromUnitId || !t.toUnitId || !t.quantity) {
        failed.push({ index: idx, error: 'MISSING_FIELDS',
                      message: 'itemId, fromUnitId, toUnitId, quantity required', input: t });
        continue;
      }

      const result = await this.supply.initiateTransfer({
        itemId:            t.itemId,
        fromUnitId:        t.fromUnitId,
        toUnitId:          t.toUnitId,
        quantity:          t.quantity,
        requestedByUserId: actorUserId,
        notes:             t.notes || ''
      });

      if (result.success) {
        succeeded.push({ index: idx, transferId: result.transfer.id, input: t });
      } else {
        failed.push({ index: idx, error: result.error, message: result.message, input: t });
      }
    }

    // Day 69: same reasoning as importItemsFromCSV's flush above.
    await this.supply.flushPendingWrites();

    await this._audit({
      userId: actorUserId, action: 'BULK_TRANSFER_INITIATE',
      resource: 'transfers',
      details: { count: transfers.length, succeeded: succeeded.length, failed: failed.length },
      success: succeeded.length > 0
    });

    return {
      success: true,
      succeeded, failed,
      summary: {
        totalRequested: transfers.length,
        successCount:   succeeded.length,
        failureCount:   failed.length
      }
    };
  }

  // ================================================================
  // 3. BULK APPROVE
  // ================================================================

  /**
   * Approve multiple PENDING transfers.
   * Processed sequentially (order matters when items share stock).
   *
   * @param {number[]}      transferIds
   * @param {number|string} approverUserId
   * @returns {{ success, succeeded, failed, summary }}
   */
  async bulkApprove(transferIds, approverUserId) {
    if (!Array.isArray(transferIds) || transferIds.length === 0) {
      return { success: false, error: 'EMPTY_LIST', message: 'transferIds array required' };
    }
    if (transferIds.length > BULK_LIMITS.BULK_APPROVE) {
      return {
        success: false, error: 'BATCH_TOO_LARGE',
        message: `Maximum ${BULK_LIMITS.BULK_APPROVE} approvals per batch`
      };
    }

    const succeeded = [];
    const failed    = [];

    for (const id of transferIds) {
      const result = await this.supply.approveTransfer(id, approverUserId);
      if (result.success) {
        succeeded.push({
          transferId: id,
          blockIndex: result.block?.blockIndex,
          itemCode:   result.transfer?.itemCode
        });
      } else {
        failed.push({ transferId: id, error: result.error, message: result.message });
      }
    }

    await this._audit({
      userId: approverUserId, action: 'BULK_TRANSFER_APPROVE',
      resource: 'transfers',
      details: {
        count: transferIds.length,
        succeeded: succeeded.length, failed: failed.length
      },
      success: succeeded.length > 0,
      severity: 'INFO'
    });

    return {
      success: true,
      succeeded, failed,
      summary: {
        totalRequested:  transferIds.length,
        approved:        succeeded.length,
        failureCount:    failed.length,
        blocksCreated:   succeeded.filter(s => s.blockIndex).length
      }
    };
  }

  // ================================================================
  // 4. BULK QUANTITY UPDATE
  // ================================================================

  /**
   * Batch stock adjustments after a physical stock-take.
   *
   * @param {Array<{ itemId, quantity, reason? }>} updates
   * @param {number|string} actorUserId
   * @returns {{ success, succeeded, failed, summary }}
   */
  async bulkUpdateQuantity(updates, actorUserId = null) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return { success: false, error: 'EMPTY_LIST', message: 'updates array required' };
    }
    if (updates.length > BULK_LIMITS.BULK_UPDATE) {
      return {
        success: false, error: 'BATCH_TOO_LARGE',
        message: `Maximum ${BULK_LIMITS.BULK_UPDATE} updates per batch`
      };
    }

    const succeeded = [];
    const failed    = [];

    for (let i = 0; i < updates.length; i++) {
      const u   = updates[i];
      const idx = i + 1;

      if (u.itemId === undefined || u.quantity === undefined) {
        failed.push({ index: idx, error: 'MISSING_FIELDS',
                      message: 'itemId and quantity required', input: u });
        continue;
      }

      const parsedQty = parseInt(u.quantity, 10);
      if (isNaN(parsedQty) || parsedQty < 0) {
        failed.push({ index: idx, error: 'INVALID_QUANTITY',
                      message: 'quantity must be ≥ 0', input: u });
        continue;
      }

      const result = await this.supply.updateItem(u.itemId, { quantity: parsedQty }, actorUserId);
      if (result.success) {
        succeeded.push({ index: idx, itemId: u.itemId, newQuantity: parsedQty });
      } else {
        failed.push({ index: idx, error: result.error, message: result.message, input: u });
      }
    }

    await this._audit({
      userId: actorUserId, action: 'BULK_QUANTITY_UPDATE',
      resource: 'supply_items',
      details: { count: updates.length, succeeded: succeeded.length, failed: failed.length },
      success: succeeded.length > 0
    });

    return {
      success: true,
      succeeded, failed,
      summary: {
        totalRequested: updates.length,
        successCount:   succeeded.length,
        failureCount:   failed.length
      }
    };
  }

  // ================================================================
  // 5. EXPORT ITEMS TO CSV
  // ================================================================

  /**
   * Serialise an array of supply items to CSV.
   *
   * @param {object[]} items - from SupplyChainService.getItemsInScope()
   * @returns {string} CSV text
   */
  exportItemsToCSV(items) {
    if (!items || items.length === 0) return '';

    const headers = [
      'itemCode', 'itemName', 'category', 'unitId',
      'quantity', 'unitOfMeasure', 'lowStockThreshold',
      'createdAt', 'updatedAt'
    ];

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const lines = [headers.join(',')];
    for (const item of items) {
      lines.push(headers.map(h => esc(item[h])).join(','));
    }
    return lines.join('\n');
  }

  // ================================================================
  // STATIC LIMITS
  // ================================================================

  static get LIMITS() { return BULK_LIMITS; }

  // ================================================================
  // INTERNAL HELPERS
  // ================================================================

  /**
   * Parse CSV text into { headers, rows, parseError }.
   * Handles quoted fields with embedded commas and newlines.
   */
  _parseCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      .filter(l => l.trim());

    if (lines.length === 0) {
      return { headers: [], rows: [], parseError: 'CSV content is empty' };
    }

    const parseRow = (line) => {
      const result = [];
      let cur  = '';
      let inQ  = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
          result.push(cur); cur = '';
        } else {
          cur += ch;
        }
      }
      result.push(cur);
      return result;
    };

    const headers = parseRow(lines[0]);
    const rows    = lines.slice(1).map(parseRow);

    return { headers, rows, parseError: null };
  }

  async _audit(entry) {
    if (this.auditLog) await this.auditLog.log(entry).catch(err => console.error('[bulk-operations] audit error:', err.message));
  }
}

module.exports = BulkOperationsService;
