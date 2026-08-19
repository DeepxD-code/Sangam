'use strict';

/**
 * SANGAM Live Command Dashboard Service  (Day 26)
 *
 * Pure read-aggregator over the in-memory services built in Days 19-25.
 * Holds no state of its own besides a short-lived response cache.
 *
 * Unlike Day 12's ReportingService (which queries PostgreSQL directly and
 * returns `{ available: false }` when offline), this service reads live
 * in-memory state — the same state the REST API itself serves from. This
 * is the data source the React dashboard (Day 27) is built against.
 *
 * Single entry point: getSummary(userContext, scopeIds, options)
 */

class DashboardService {

  static CACHE_TTL_MS = 30 * 1000; // 30 seconds — live enough, cheap enough

  /**
   * @param {object} services
   *   supply      {SupplyChainService}
   *   units       {UnitManagementService}
   *   users       {UserManagementService}
   *   inventory   {InventoryLedgerService}
   *   movement    {MovementOrderService}
   *   auditLog    {AuditLogService}
   */
  constructor(services = {}) {
    this.supply    = services.supply    || null;
    this.units     = services.units     || null;
    this.userMgmt  = services.users     || null;
    this.inventory = services.inventory || null;
    this.movement  = services.movement  || null;
    this.auditLog  = services.auditLog  || null;
    this.alerts    = services.alerts    || null; // Day 31: AlertEscalationService singleton

    this._cache = new Map(); // cacheKey -> { at, data }
  }

  // ================================================================
  // MAIN ENTRY POINT
  // ================================================================

  /**
   * @param {object}   userContext  - req.user (id, unitId, role, ...)
   * @param {number[]} scopeIds     - caller's command scope (unwrapped .ids array)
   * @param {object}   options      - { forceRefresh }
   */
  async getSummary(userContext, scopeIds, options = {}) {
    const cacheKey = `${userContext.userId}_${userContext.unitId}`;

    if (!options.forceRefresh) {
      const cached = this._cache.get(cacheKey);
      if (cached && (Date.now() - cached.at) < DashboardService.CACHE_TTL_MS) {
        return { ...cached.data, cached: true };
      }
    }

    const [units, personnel, supply, transfers, movement, blockchain, stocktake, alertsSection] =
      await Promise.all([
        this._unitsSection(scopeIds).catch(()     => ({ available: false })),
        this._personnelSection(scopeIds).catch(()  => ({ available: false })),
        this._supplySection(scopeIds).catch(()     => ({ available: false })),
        this._transfersSection(scopeIds).catch(()  => ({ available: false })),
        this._movementSection(scopeIds).catch(()   => ({ available: false })),
        this._blockchainSection().catch(()         => ({ available: false })),
        this._stocktakeSection(scopeIds).catch(()  => ({ available: false })),
        this._alertsSection(scopeIds).catch(()     => ({ available: false }))
      ]);

    const recentActivity = this._recentActivity(scopeIds, 10);

    const data = {
      success: true,
      generatedAt: new Date().toISOString(),
      scope: {
        unitId:    userContext.unitId,
        scopeSize: scopeIds.length
      },
      units, personnel, supply, transfers, movement, blockchain, stocktake,
      alerts: alertsSection,
      recentActivity,
      cached: false
    };

    this._cache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  /** Invalidate the cache for one user, or everyone if userId omitted. */
  clearCache(userId = null) {
    if (userId === null) { this._cache.clear(); return; }
    for (const key of this._cache.keys()) {
      if (key.startsWith(`${userId}_`)) this._cache.delete(key);
    }
  }

  // ================================================================
  // SECTION: UNITS
  // ================================================================

  async _unitsSection(scopeIds) {
    if (!this.units) return { available: false, reason: 'Unit service not available' };

    const { units, total } = this.units.getUnitsInScope(scopeIds, { activeOnly: false });

    const byType = {};
    let active = 0;
    for (const u of units) {
      byType[u.unitType] = (byType[u.unitType] || 0) + 1;
      if (u.active) active++;
    }

    return { available: true, total, active, inactive: total - active, byType };
  }

  // ================================================================
  // SECTION: PERSONNEL
  // ================================================================

  async _personnelSection(scopeIds) {
    if (!this.userMgmt) return { available: false, reason: 'User service not available' };

    const stats = this.userMgmt.getUserStats(scopeIds);
    return {
      available: true,
      total:    stats.totalUsers,
      active:   stats.active,
      inactive: stats.inactive,
      locked:   stats.locked,
      byRole:   stats.byRole
    };
  }

  // ================================================================
  // SECTION: SUPPLY
  // ================================================================

  async _supplySection(scopeIds) {
    if (!this.supply) return { available: false, reason: 'Supply service not available' };

    const { items, total } = this.supply.getItemsInScope(scopeIds);

    const byCategory = {};
    const lowStock   = [];
    for (const item of items) {
      byCategory[item.category] = (byCategory[item.category] || 0) + 1;
      if (item.lowStockThreshold > 0 && item.quantity < item.lowStockThreshold) {
        lowStock.push({
          itemId: item.id, itemCode: item.itemCode, itemName: item.itemName,
          quantity: item.quantity, threshold: item.lowStockThreshold, unitId: item.unitId
        });
      }
    }

    return {
      available: true,
      totalItems:    total,
      lowStockCount: lowStock.length,
      lowStockItems: lowStock.slice(0, 5), // top 5 for dashboard widget
      byCategory
    };
  }

  // ================================================================
  // SECTION: TRANSFERS
  // ================================================================

  async _transfersSection(scopeIds) {
    if (!this.supply) return { available: false, reason: 'Supply service not available' };

    const { transfers, total } = this.supply.getTransfersInScope(scopeIds, { limit: 500 });

    const pending   = transfers.filter(t => t.status === 'PENDING').length;
    const completed = transfers.filter(t => t.status === 'COMPLETED').length;
    const rejected  = transfers.filter(t => t.status === 'REJECTED').length;

    const since24h = Date.now() - 24 * 60 * 60 * 1000;
    const completedToday = transfers.filter(t =>
      t.status === 'COMPLETED' &&
      t.decidedAt && new Date(t.decidedAt).getTime() >= since24h
    ).length;

    const approvalRate = (completed + rejected) > 0
      ? Math.round((completed / (completed + rejected)) * 100)
      : 100;

    return {
      available: true,
      total, pending, completed, rejected, completedToday,
      approvalRate: `${approvalRate}%`
    };
  }

  // ================================================================
  // SECTION: MOVEMENT ORDERS
  // ================================================================

  async _movementSection(scopeIds) {
    if (!this.movement) return { available: false, reason: 'Movement service not available' };

    const { orders } = this.movement.getOrdersInScope(scopeIds, { limit: 500 });

    const ACTIVE = new Set(['PLANNED', 'DISPATCHED', 'IN_TRANSIT']);
    const active     = orders.filter(o => ACTIVE.has(o.state));
    const inTransit  = orders.filter(o => o.state === 'IN_TRANSIT').length;
    const dispatched = orders.filter(o => o.state === 'DISPATCHED').length;
    const planned    = orders.filter(o => o.state === 'PLANNED').length;
    const emergency  = active.filter(o => o.priority === 'EMERGENCY').length;
    const delivered  = orders.filter(o => o.state === 'DELIVERED').length;

    return {
      available: true,
      activeOrders: active.length,
      planned, dispatched, inTransit, delivered,
      emergencyCount: emergency
    };
  }

  // ================================================================
  // SECTION: BLOCKCHAIN
  // ================================================================

  async _blockchainSection() {
    if (!this.supply) return { available: false, reason: 'Supply service not available' };

    const result = this.supply.verifyChain();
    return {
      available: true,
      verified:    result.verified,
      blockCount:  result.blockCount,
      tamperCount: result.tampered.length
    };
  }

  // ================================================================
  // SECTION: STOCK-TAKE
  // ================================================================

  async _stocktakeSection(scopeIds) {
    if (!this.inventory) return { available: false, reason: 'Inventory service not available' };

    let activeSessions = 0;
    let openDiscrepancies = 0;

    for (const unitId of scopeIds) {
      const active = this.inventory.getActiveSession(unitId);
      if (active) activeSessions++;

      const { sessions } = this.inventory.getSessionsForUnit(unitId, { state: 'PENDING_APPROVAL' });
      for (const s of sessions) {
        openDiscrepancies += (s.discrepancies || []).length;
      }
    }

    return { available: true, activeSessions, openDiscrepancies };
  }

  // ================================================================
  // SECTION: RECENT ACTIVITY
  // ================================================================

  /**
   * Day 31: Alert summary for the dashboard ALT widget.
   * Reads the shared AlertEscalationService singleton directly — same
   * pattern as all other sections reading their respective services.
   */
  async _alertsSection(scopeIds) {
    if (!this.alerts) return { available: false };

    const active = this.alerts.getActiveAlerts(scopeIds);
    const stats  = this.alerts.getStats();

    const critical  = active.filter(a => a.severity === 'CRITICAL').length;
    const escalated = active.filter(a => a.status   === 'ESCALATED').length;

    const byType = active.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + 1;
      return acc;
    }, {});

    return {
      available:   true,
      totalActive: active.length,
      critical,
      escalated,
      byType,
      totalRaised:  stats.totalRaised  || 0,
      totalResolved: stats.totalResolved || 0
    };
  }

  /**
   * Pull the N most recent audit entries relevant to this scope.
   * Reads AuditLogService's in-memory buffers directly (same pattern
   * as ComplianceService).
   */
  _recentActivity(scopeIds, limit = 10) {
    if (!this.auditLog) return [];

    const queue  = this.auditLog._writeQueue     || [];
    const buffer = this.auditLog._inMemoryBuffer || [];

    const seen    = new Set();
    const entries = [];
    for (const e of [...queue, ...buffer]) {
      const key = e.logHash || `${e.action}-${e.timestamp}`;
      if (!seen.has(key)) { seen.add(key); entries.push(e); }
    }

    entries.sort((a, b) =>
      new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));

    return entries.slice(0, limit).map(e => ({
      timestamp: e.timestamp || e.createdAt,
      action:    e.action,
      resource:  e.resource,
      userId:    e.userId,
      success:   e.success,
      severity:  e.severity || 'INFO'
    }));
  }
}

module.exports = DashboardService;
