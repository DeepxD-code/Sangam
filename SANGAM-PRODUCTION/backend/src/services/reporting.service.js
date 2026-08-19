'use strict';

const RBACService = require('./rbac.service');

/**
 * SANGAM Reporting & Analytics Service
 *
 * Command-dashboard layer over every other service.
 *
 * Aggregation pattern (the dual of Day 11's escalation pattern):
 *   scope = RBACService.getCommandScope(userContext.unitId)   // self + descendants
 *   SELECT ... WHERE unit_id = ANY(scope.ids)
 *
 * Every DB-dependent report degrades gracefully when `db` is null
 * (returns { available: false, reason }), matching the resilience
 * pattern established in RBACService / AuditLogService.
 *
 * Mesh-health and part of security-posture are derived entirely from
 * NotificationService's in-memory store — no new tables required.
 */
class ReportingService {

  // 5-minute dashboard cache
  static DASHBOARD_TTL_MS = 5 * 60 * 1000;

  // Default lookback window for transfer / security reports
  static DEFAULT_TRANSFER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  static DEFAULT_SECURITY_WINDOW_HOURS = 24;

  /**
   * @param {object} db                    - pg Pool (optional)
   * @param {RBACService} [rbac]           - reuse an existing instance if available
   * @param {object} [notificationService] - NotificationService instance (optional)
   * @param {object} [auditLogService]     - AuditLogService instance (optional)
   */
  constructor(db, rbac = null, notificationService = null, auditLogService = null) {
    this.db            = db;
    this.rbac          = rbac || new RBACService(db);
    this.notifications = notificationService;
    this.auditLog      = auditLogService;

    this._dashboardCache = new Map(); // `${userId}_${unitId}` -> { at, data }
  }

  // ============================================================
  // SCOPE HELPER
  // ============================================================

  /**
   * Resolve the set of unit IDs a user's reports should aggregate
   * (their own unit plus every subordinate unit).
   */
  async getReportScope(userContext) {
    return this.rbac.getCommandScope(userContext.unitId, this.db);
  }

  // ============================================================
  // 1 · STOCK LEVEL REPORT
  // ============================================================

  /**
   * Aggregate supply_items by unit and category across the user's
   * command scope, plus a flagged list of items below threshold.
   *
   * @param {object} userContext
   * @param {object} [filters] - { category }
   */
  async getStockLevelReport(userContext, filters = {}) {
    const scope = await this.getReportScope(userContext);

    if (!this.db) {
      return {
        available: false,
        reason: 'Database not connected',
        scopeSize: scope.ids.length,
        byUnit: [], totals: { totalQuantity: 0, itemCount: 0, lowStockCount: 0 },
        lowStockItems: []
      };
    }

    const byUnitParams = [scope.ids];
    let byUnitSql = `
      SELECT si.unit_id, cu.unit_code, cu.unit_name, si.category,
             SUM(si.quantity)::int  AS total_quantity,
             COUNT(*)::int          AS item_count,
             SUM(CASE WHEN si.quantity < si.low_stock_threshold THEN 1 ELSE 0 END)::int AS low_stock_count
      FROM   supply_items si
      JOIN   command_units cu ON cu.id = si.unit_id
      WHERE  si.unit_id = ANY($1)
    `;
    if (filters.category) {
      byUnitSql += ` AND si.category = $2`;
      byUnitParams.push(filters.category);
    }
    byUnitSql += `
      GROUP BY si.unit_id, cu.unit_code, cu.unit_name, si.category
      ORDER BY cu.unit_name, si.category
    `;

    const lowStockSql = `
      SELECT si.id, si.item_name, si.category, si.unit_id, cu.unit_code,
             si.quantity, si.low_stock_threshold
      FROM   supply_items si
      JOIN   command_units cu ON cu.id = si.unit_id
      WHERE  si.unit_id = ANY($1) AND si.quantity < si.low_stock_threshold
      ORDER  BY si.quantity ASC
      LIMIT  50
    `;

    const [byUnitResult, lowStockResult] = await Promise.all([
      this.db.query(byUnitSql, byUnitParams),
      this.db.query(lowStockSql, [scope.ids])
    ]);

    const totals = byUnitResult.rows.reduce((acc, row) => {
      acc.totalQuantity += row.total_quantity;
      acc.itemCount     += row.item_count;
      acc.lowStockCount += row.low_stock_count;
      return acc;
    }, { totalQuantity: 0, itemCount: 0, lowStockCount: 0 });

    return {
      available: true,
      scopeSize: scope.ids.length,
      byUnit: byUnitResult.rows,
      totals,
      lowStockItems: lowStockResult.rows
    };
  }

  // ============================================================
  // 2 · TRANSFER ACTIVITY REPORT
  // ============================================================

  /**
   * Summarize transfer activity (in or out of any unit in scope)
   * over a time window, grouped by status, plus the pending queue.
   *
   * @param {object} userContext
   * @param {object} [filters] - { startDate, endDate } ISO strings
   */
  async getTransferReport(userContext, filters = {}) {
    const scope = await this.getReportScope(userContext);

    const startDate = filters.startDate
      || new Date(Date.now() - ReportingService.DEFAULT_TRANSFER_WINDOW_MS).toISOString();
    const endDate = filters.endDate || new Date().toISOString();

    if (!this.db) {
      return {
        available: false,
        reason: 'Database not connected',
        period: { startDate, endDate },
        scopeSize: scope.ids.length,
        byStatus: {}, totals: { totalTransfers: 0, totalQuantity: 0 }, pending: []
      };
    }

    const [statusResult, pendingResult] = await Promise.all([
      this.db.query(`
        SELECT status,
               COUNT(*)::int       AS count,
               SUM(quantity)::int  AS total_qty
        FROM   transfers
        WHERE  (from_unit_id = ANY($1) OR to_unit_id = ANY($1))
          AND  created_at BETWEEN $2 AND $3
        GROUP  BY status
      `, [scope.ids, startDate, endDate]),

      this.db.query(`
        SELECT id, item_id, from_unit_id, to_unit_id, quantity, status, created_at
        FROM   transfers
        WHERE  status = 'PENDING'
          AND  (from_unit_id = ANY($1) OR to_unit_id = ANY($1))
        ORDER  BY created_at ASC
        LIMIT  50
      `, [scope.ids])
    ]);

    const byStatus = {};
    let totalTransfers = 0;
    let totalQuantity  = 0;
    for (const row of statusResult.rows) {
      byStatus[row.status] = { count: row.count, totalQuantity: row.total_qty };
      totalTransfers += row.count;
      totalQuantity  += row.total_qty;
    }

    return {
      available: true,
      period: { startDate, endDate },
      scopeSize: scope.ids.length,
      byStatus,
      totals: { totalTransfers, totalQuantity },
      pending: pendingResult.rows
    };
  }

  // ============================================================
  // 3 · BLOCKCHAIN HEALTH REPORT
  // ============================================================

  /**
   * Basic chain statistics: block count and the most recent block.
   * (Distinct from Day 13's audit-log hash chain — this reports on
   * the supply-chain transaction ledger.)
   */
  async getBlockchainHealthReport() {
    if (!this.db) {
      return { available: false, reason: 'Database not connected' };
    }

    const [countResult, latestResult] = await Promise.all([
      this.db.query(`SELECT COUNT(*)::int AS block_count FROM blockchain_blocks`),
      this.db.query(`
        SELECT block_index, block_hash, transaction_count, created_at
        FROM   blockchain_blocks
        ORDER  BY block_index DESC
        LIMIT  1
      `)
    ]);

    const blockCount = countResult.rows[0] ? countResult.rows[0].block_count : 0;
    const latestBlock = latestResult.rows[0] || null;

    return {
      available:  true,
      blockCount,
      chainEmpty: blockCount === 0,
      latestBlock
    };
  }

  // ============================================================
  // 4 · MESH NETWORK HEALTH (derived from Day 11 notifications)
  // ============================================================

  /**
   * Derive current peer connectivity from MESH_PEER_ONLINE/OFFLINE
   * notification history. Visibility is inherited from
   * NotificationService.getForUser() — i.e. a commander sees peer
   * events from every unit in their command scope, automatically.
   */
  async getMeshHealthReport(userContext) {
    if (!this.notifications) {
      return {
        available: false,
        reason: 'NotificationService not provided',
        totalPeers: 0, onlineCount: 0, offlineCount: 0, peers: []
      };
    }

    const { notifications } = await this.notifications.getForUser(userContext, { limit: 500 });

    const meshEvents = notifications.filter(n =>
      n.type === 'MESH_PEER_ONLINE' || n.type === 'MESH_PEER_OFFLINE'
    );

    // notifications are returned newest-first, so the first occurrence
    // per resourceId is the most recent status for that peer
    const latestByPeer = new Map();
    for (const n of meshEvents) {
      if (!latestByPeer.has(n.resourceId)) latestByPeer.set(n.resourceId, n);
    }

    const peers = Array.from(latestByPeer.values()).map(n => ({
      peerId:         n.resourceId,
      unitId:         n.sourceUnitId,
      online:         n.type === 'MESH_PEER_ONLINE',
      lastEventAt:    n.createdAt,
      lastEventTitle: n.title
    }));

    return {
      available:   true,
      totalPeers:  peers.length,
      onlineCount: peers.filter(p => p.online).length,
      offlineCount: peers.filter(p => !p.online).length,
      peers
    };
  }

  // ============================================================
  // 5 · SECURITY POSTURE REPORT
  // ============================================================

  /**
   * Combine Day 13's audit log (SECURITY/CRITICAL event counts) with
   * Day 11's pending-acknowledgment count for the user's visible
   * notifications.
   *
   * @param {object} userContext
   * @param {number} [hours] - audit lookback window
   */
  async getSecurityPostureReport(userContext, hours = ReportingService.DEFAULT_SECURITY_WINDOW_HOURS) {
    const result = {
      windowHours: hours,
      auditAvailable: false,
      securityEventCount: 0,
      criticalEventCount: 0,
      pendingAcknowledgments: 0
    };

    if (this.db) {
      try {
        const since = new Date(Date.now() - hours * 3_600_000).toISOString();
        const rows = await this.db.query(`
          SELECT severity, COUNT(*)::int AS c
          FROM   audit_logs
          WHERE  created_at >= $1
            AND  severity IN ('SECURITY','CRITICAL')
          GROUP  BY severity
        `, [since]);

        result.auditAvailable = true;
        for (const row of rows.rows) {
          if (row.severity === 'SECURITY') result.securityEventCount = row.c;
          if (row.severity === 'CRITICAL') result.criticalEventCount = row.c;
        }
      } catch {
        result.auditAvailable = false;
      }
    }

    if (this.notifications) {
      const { notifications } = await this.notifications.getForUser(userContext, { limit: 500 });
      result.pendingAcknowledgments =
        notifications.filter(n => n.requiresAck && !n.acknowledged).length;
    }

    return result;
  }

  // ============================================================
  // 6 · UNIT ROSTER REPORT
  // ============================================================

  /**
   * List every unit in the user's command scope with its type/code/name.
   */
  async getUnitRosterReport(userContext) {
    const scope = await this.getReportScope(userContext);

    if (!this.db) {
      return {
        available: false,
        reason: 'Database not connected',
        scopeSize: scope.ids.length,
        units: []
      };
    }

    const result = await this.db.query(`
      SELECT id, unit_name, unit_type, unit_code, parent_unit_id
      FROM   command_units
      WHERE  id = ANY($1)
      ORDER  BY unit_type, unit_name
    `, [scope.ids]);

    return {
      available: true,
      scopeSize: scope.ids.length,
      units: result.rows
    };
  }

  // ============================================================
  // DASHBOARD SUMMARY (cached)
  // ============================================================

  /**
   * Run all six reports and return one consolidated payload.
   * Cached for DASHBOARD_TTL_MS per (userId, unitId).
   *
   * @param {object} userContext
   * @param {object} [options] - { forceRefresh: boolean }
   */
  async getDashboardSummary(userContext, options = {}) {
    const cacheKey = `${userContext.userId}_${userContext.unitId}`;

    if (!options.forceRefresh) {
      const cached = this._dashboardCache.get(cacheKey);
      if (cached && (Date.now() - cached.at) < ReportingService.DASHBOARD_TTL_MS) {
        return cached.data;
      }
    }

    const [stock, transfers, blockchain, mesh, security, roster] = await Promise.all([
      this.getStockLevelReport(userContext).catch(() => ({ available: false, reason: 'error' })),
      this.getTransferReport(userContext).catch(()   => ({ available: false, reason: 'error' })),
      this.getBlockchainHealthReport().catch(()      => ({ available: false, reason: 'error' })),
      this.getMeshHealthReport(userContext).catch(() => ({ available: false, reason: 'error' })),
      this.getSecurityPostureReport(userContext).catch(() => ({ available: false, reason: 'error' })),
      this.getUnitRosterReport(userContext).catch(() => ({ available: false, reason: 'error' }))
    ]);

    const data = {
      generatedAt: new Date().toISOString(),
      unitScope: roster.scopeSize ?? null,
      stock, transfers, blockchain, mesh, security, roster
    };

    this._dashboardCache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  /** Invalidate the dashboard cache for one user, or everyone if userId omitted. */
  clearDashboardCache(userId = null) {
    if (userId === null) {
      this._dashboardCache.clear();
      return;
    }
    for (const key of this._dashboardCache.keys()) {
      if (key.startsWith(`${userId}_`)) this._dashboardCache.delete(key);
    }
  }

  // ============================================================
  // CSV EXPORT (generic)
  // ============================================================

  /**
   * Serialize an array of flat row-objects to CSV. Headers are
   * derived from the first row's keys.
   *
   * @param {object[]} rows
   * @returns {string} CSV text (empty string if rows is empty)
   */
  exportReportToCSV(rows) {
    if (!rows || rows.length === 0) return '';

    const headers = Object.keys(rows[0]);
    const escape = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;

    const lines = [headers.map(escape).join(',')];
    for (const row of rows) {
      lines.push(headers.map(h => escape(row[h])).join(','));
    }
    return lines.join('\n');
  }
}

module.exports = ReportingService;
