'use strict';

/**
 * SANGAM Alert Escalation Engine  (Day 30)
 *
 * Monitors the live in-memory state of all operational services and
 * generates time-sensitive alerts when thresholds are breached.
 * Escalates unacknowledged alerts up the command chain automatically.
 *
 * Alert types:
 *   LOW_STOCK           — item quantity < threshold (informational)
 *   CRITICAL_STOCK      — item quantity < 20% of threshold (critical)
 *   STALE_TRANSFER      — PENDING transfer unresolved for > staleMins
 *   BLOCKCHAIN_TAMPER   — verifyChain() detects a tampered block
 *   STOCKTAKE_OVERDUE   — PENDING_APPROVAL session older than ttlMins
 *   MOVEMENT_DELAYED    — DISPATCHED/IN_TRANSIT order older than ttlMins
 *   EMERGENCY_ORDER     — any PLANNED/DISPATCHED movement order with
 *                         priority=EMERGENCY, unacknowledged
 *
 * Escalation lifecycle:
 *   OPEN → ESCALATED (if unacknowledged after escalationMins) → RESOLVED
 *                                                              → SUPPRESSED
 *
 * All thresholds are configurable via the constructor options object.
 * Offline-first: this service reads exclusively from the other
 * in-memory services (supply, inventory, movement) — no DB dependency.
 */

const ALERT_TYPES = {
  LOW_STOCK:          'LOW_STOCK',
  CRITICAL_STOCK:     'CRITICAL_STOCK',
  STALE_TRANSFER:     'STALE_TRANSFER',
  BLOCKCHAIN_TAMPER:  'BLOCKCHAIN_TAMPER',
  STOCKTAKE_OVERDUE:  'STOCKTAKE_OVERDUE',
  MOVEMENT_DELAYED:   'MOVEMENT_DELAYED',
  EMERGENCY_ORDER:    'EMERGENCY_ORDER'
};

const SEVERITY = {
  INFO:     'INFO',
  WARNING:  'WARNING',
  CRITICAL: 'CRITICAL'
};

const ALERT_SEVERITY = {
  LOW_STOCK:         SEVERITY.WARNING,
  CRITICAL_STOCK:    SEVERITY.CRITICAL,
  STALE_TRANSFER:    SEVERITY.WARNING,
  BLOCKCHAIN_TAMPER: SEVERITY.CRITICAL,
  STOCKTAKE_OVERDUE: SEVERITY.WARNING,
  MOVEMENT_DELAYED:  SEVERITY.WARNING,
  EMERGENCY_ORDER:   SEVERITY.CRITICAL
};

const STATUS = {
  OPEN:       'OPEN',
  ESCALATED:  'ESCALATED',
  RESOLVED:   'RESOLVED',
  SUPPRESSED: 'SUPPRESSED'
};

const DEFAULT_OPTIONS = {
  staleTransferMins:    30,   // PENDING transfer becomes stale after 30 min
  stocktakeOverdueMins: 60,   // PENDING_APPROVAL stocktake session after 60 min
  movementDelayedMins:  120,  // DISPATCHED order no checkpoint after 2 hrs
  escalationMins:       15,   // escalate unacknowledged OPEN alert after 15 min
  criticalStockPct:     0.2   // quantity < 20% of threshold → CRITICAL_STOCK
};

class AlertEscalationService {

  /**
   * @param {object} services  — { supply, inventory, movement, auditLog }
   * @param {object} options   — overrides for DEFAULT_OPTIONS thresholds
   * @param {object} notifications — NotificationService (optional)
   */
  constructor(services = {}, options = {}, notifications = null) {
    this.supply        = services.supply        || null;
    this.inventory     = services.inventory     || null;
    this.movement      = services.movement      || null;
    this.auditLog      = services.auditLog      || null;
    this.notifications = notifications;

    this.opts   = { ...DEFAULT_OPTIONS, ...options };
    this._alerts = new Map();   // alertId → alert object
    this._nextId = 1;

    this._stats = {
      alertsRaised:    0,
      alertsEscalated: 0,
      alertsResolved:  0,
      alertsSuppressed: 0
    };
  }

  // ================================================================
  // MAIN SCAN — call periodically to update alert state
  // ================================================================

  /**
   * Scan all monitored services and reconcile alerts.
   * New threshold violations → new OPEN alerts.
   * Cleared violations → existing alerts auto-resolved.
   * Old unacknowledged OPEN alerts → escalated.
   *
   * @param {number[]} scopeUnitIds — scope of units to monitor
   * @returns {{ raised, resolved, escalated, active }}
   */
  async scan(scopeUnitIds) {
    const now    = Date.now();
    const raised = [], resolved = [], escalated = [];

    // ── 1. Collect violations across all monitors ────────────────
    const violations = [];
    violations.push(...this._checkStock(scopeUnitIds));
    violations.push(...this._checkTransfers(scopeUnitIds));
    violations.push(...this._checkBlockchain());
    violations.push(...this._checkStocktake(scopeUnitIds));
    violations.push(...this._checkMovement(scopeUnitIds));

    // ── 2. Raise new alerts for uncovered violations ─────────────
    for (const v of violations) {
      const existing = this._findAlert(v.key);
      if (!existing || existing.status === STATUS.RESOLVED) {
        const alert = this._raise(v, now);
        raised.push(alert);
        await this._notifyRaised(alert);
      }
    }

    // ── 3. Auto-resolve alerts whose violation is now clear ──────
    const violationKeys = new Set(violations.map(v => v.key));
    for (const alert of this._alerts.values()) {
      if (alert.status === STATUS.OPEN || alert.status === STATUS.ESCALATED) {
        if (!violationKeys.has(alert.key)) {
          alert.status     = STATUS.RESOLVED;
          alert.resolvedAt = new Date(now).toISOString();
          resolved.push(alert);
          this._stats.alertsResolved++;
        }
      }
    }

    // ── 4. Escalate overdue OPEN alerts ──────────────────────────
    const escalationMs = this.opts.escalationMins * 60 * 1000;
    for (const alert of this._alerts.values()) {
      if (alert.status !== STATUS.OPEN) continue;
      const age = now - new Date(alert.raisedAt).getTime();
      if (age >= escalationMs) {
        alert.status      = STATUS.ESCALATED;
        alert.escalatedAt = new Date(now).toISOString();
        escalated.push(alert);
        this._stats.alertsEscalated++;
        await this._notifyEscalated(alert);
      }
    }

    return {
      raised:    raised.length,
      resolved:  resolved.length,
      escalated: escalated.length,
      active:    this.getActiveAlerts(scopeUnitIds).length
    };
  }

  // ================================================================
  // ALERT MANAGEMENT
  // ================================================================

  acknowledge(alertId, userId) {
    const alert = this._alerts.get(parseInt(alertId, 10));
    if (!alert) return { success: false, error: 'ALERT_NOT_FOUND' };
    if (alert.status === STATUS.RESOLVED) return { success: false, error: 'ALREADY_RESOLVED' };
    if (alert.status === STATUS.SUPPRESSED) return { success: false, error: 'ALREADY_SUPPRESSED' };

    alert.acknowledgedAt  = new Date().toISOString();
    alert.acknowledgedBy  = userId;
    return { success: true, alert: { ...alert } };
  }

  resolve(alertId, userId, note = '') {
    const alert = this._alerts.get(parseInt(alertId, 10));
    if (!alert) return { success: false, error: 'ALERT_NOT_FOUND' };
    if (alert.status === STATUS.RESOLVED) return { success: false, error: 'ALREADY_RESOLVED' };

    alert.status     = STATUS.RESOLVED;
    alert.resolvedAt = new Date().toISOString();
    alert.resolvedBy = userId;
    alert.resolution = note;
    this._stats.alertsResolved++;
    return { success: true, alert: { ...alert } };
  }

  suppress(alertId, userId, reason = '') {
    const alert = this._alerts.get(parseInt(alertId, 10));
    if (!alert) return { success: false, error: 'ALERT_NOT_FOUND' };
    if (alert.status === STATUS.RESOLVED) return { success: false, error: 'ALREADY_RESOLVED' };

    alert.status      = STATUS.SUPPRESSED;
    alert.suppressedAt = new Date().toISOString();
    alert.suppressedBy = userId;
    alert.suppression  = reason;
    this._stats.alertsSuppressed++;
    return { success: true, alert: { ...alert } };
  }

  getAlert(alertId) {
    const a = this._alerts.get(parseInt(alertId, 10));
    return a ? { ...a } : null;
  }

  getActiveAlerts(scopeUnitIds = null) {
    const active = [...this._alerts.values()]
      .filter(a => a.status === STATUS.OPEN || a.status === STATUS.ESCALATED);
    if (!scopeUnitIds) return active.map(a => ({ ...a }));
    return active
      .filter(a => !a.unitId || scopeUnitIds.includes(a.unitId))
      .map(a => ({ ...a }));
  }

  getAllAlerts(filters = {}) {
    let alerts = [...this._alerts.values()];
    if (filters.status)   alerts = alerts.filter(a => a.status === filters.status);
    if (filters.type)     alerts = alerts.filter(a => a.type   === filters.type);
    if (filters.severity) alerts = alerts.filter(a => a.severity === filters.severity);
    return alerts.map(a => ({ ...a })).sort((a,b) => new Date(b.raisedAt) - new Date(a.raisedAt));
  }

  // ================================================================
  // VIOLATION DETECTORS
  // ================================================================

  _checkStock(scopeUnitIds) {
    if (!this.supply) return [];
    const { items } = this.supply.getItemsInScope(scopeUnitIds);
    const violations = [];
    for (const item of items) {
      if (!item.lowStockThreshold || item.lowStockThreshold <= 0) continue;
      if (item.quantity >= item.lowStockThreshold) continue;

      const pct = item.quantity / item.lowStockThreshold;
      const isCritical = pct < this.opts.criticalStockPct;
      violations.push({
        key:      `stock:${item.id}`,
        type:     isCritical ? ALERT_TYPES.CRITICAL_STOCK : ALERT_TYPES.LOW_STOCK,
        severity: isCritical ? SEVERITY.CRITICAL : SEVERITY.WARNING,
        unitId:   item.unitId,
        title:    `${isCritical ? 'CRITICAL' : 'Low'} stock: ${item.itemName}`,
        detail:   `${item.itemCode} qty ${item.quantity} (threshold ${item.lowStockThreshold})`,
        meta:     { itemId: item.id, itemCode: item.itemCode, quantity: item.quantity, threshold: item.lowStockThreshold }
      });
    }
    return violations;
  }

  _checkTransfers(scopeUnitIds) {
    if (!this.supply) return [];
    const { transfers } = this.supply.getTransfersInScope(scopeUnitIds, { limit: 500 });
    const violations = [];
    const staleMs = this.opts.staleTransferMins * 60 * 1000;
    const now = Date.now();
    for (const t of transfers) {
      if (t.status !== 'PENDING') continue;
      const age = now - new Date(t.createdAt).getTime();
      if (age >= staleMs) {
        violations.push({
          key:      `transfer:${t.id}`,
          type:     ALERT_TYPES.STALE_TRANSFER,
          severity: SEVERITY.WARNING,
          unitId:   t.fromUnitId,
          title:    `Stale pending transfer: ${t.itemCode || t.itemId}`,
          detail:   `Transfer #${t.id} pending for ${Math.floor(age/60000)}m`,
          meta:     { transferId: t.id, fromUnitId: t.fromUnitId, toUnitId: t.toUnitId, ageMins: Math.floor(age/60000) }
        });
      }
    }
    return violations;
  }

  _checkBlockchain() {
    if (!this.supply) return [];
    const result = this.supply.verifyChain();
    if (result.verified) return [];
    // result.tampered may be an array of numbers or objects with blockIndex
    return result.tampered.map(entry => {
      const blockIndex = typeof entry === 'object' ? entry.blockIndex : entry;
      const reason     = typeof entry === 'object' ? entry.reason     : 'hash mismatch';
      return {
        key:      `blockchain:tamper:${blockIndex}`,
        type:     ALERT_TYPES.BLOCKCHAIN_TAMPER,
        severity: SEVERITY.CRITICAL,
        unitId:   null,
        title:    `BLOCKCHAIN TAMPER DETECTED — Block #${blockIndex}`,
        detail:   `Block at index ${blockIndex}: ${reason}`,
        meta:     { blockIndex, reason }
      };
    });
  }

  _checkStocktake(scopeUnitIds) {
    if (!this.inventory) return [];
    const violations = [];
    const ttlMs = this.opts.stocktakeOverdueMins * 60 * 1000;
    const now   = Date.now();
    for (const unitId of scopeUnitIds) {
      const { sessions } = this.inventory.getSessionsForUnit(unitId, { state: 'PENDING_APPROVAL' });
      for (const s of sessions) {
        const age = now - new Date(s.finalizedAt || s.createdAt).getTime();
        if (age >= ttlMs) {
          violations.push({
            key:      `stocktake:${s.id}`,
            type:     ALERT_TYPES.STOCKTAKE_OVERDUE,
            severity: SEVERITY.WARNING,
            unitId,
            title:    `Stocktake awaiting approval (Unit ${unitId})`,
            detail:   `Session #${s.id} pending approval for ${Math.floor(age/60000)}m (${s.discrepancies?.length ?? 0} discrepancies)`,
            meta:     { sessionId: s.id, ageMins: Math.floor(age/60000), discrepancies: s.discrepancies?.length ?? 0 }
          });
        }
      }
    }
    return violations;
  }

  _checkMovement(scopeUnitIds) {
    if (!this.movement) return [];
    const { orders } = this.movement.getOrdersInScope(scopeUnitIds, { limit: 500 });
    const violations = [];
    const delayMs = this.opts.movementDelayedMins * 60 * 1000;
    const now     = Date.now();

    for (const o of orders) {
      // EMERGENCY orders with active status always alert
      if (o.priority === 'EMERGENCY' && ['PLANNED','DISPATCHED','IN_TRANSIT'].includes(o.state)) {
        violations.push({
          key:      `emergency:${o.id}`,
          type:     ALERT_TYPES.EMERGENCY_ORDER,
          severity: SEVERITY.CRITICAL,
          unitId:   o.fromUnitId,
          title:    `EMERGENCY movement order #${o.id}`,
          detail:   `${o.state} — ${o.items?.length ?? 0} item line(s)`,
          meta:     { orderId: o.id, state: o.state, fromUnitId: o.fromUnitId }
        });
      }

      // Delayed dispatched/in-transit orders
      if (!['DISPATCHED','IN_TRANSIT'].includes(o.state)) continue;
      const since = new Date(o.actualDeparture || o.createdAt).getTime();
      const age   = now - since;
      if (age >= delayMs) {
        violations.push({
          key:      `movement:delay:${o.id}`,
          type:     ALERT_TYPES.MOVEMENT_DELAYED,
          severity: SEVERITY.WARNING,
          unitId:   o.fromUnitId,
          title:    `Movement order #${o.id} delayed`,
          detail:   `${o.state} for ${Math.floor(age/60000)}m with no delivery`,
          meta:     { orderId: o.id, state: o.state, ageMins: Math.floor(age/60000) }
        });
      }
    }
    return violations;
  }

  // ================================================================
  // INTERNALS
  // ================================================================

  _raise(violation, now) {
    const id    = this._nextId++;
    const alert = {
      id,
      key:            violation.key,
      type:           violation.type,
      severity:       violation.severity || ALERT_SEVERITY[violation.type],
      status:         STATUS.OPEN,
      unitId:         violation.unitId,
      title:          violation.title,
      detail:         violation.detail,
      meta:           violation.meta || {},
      raisedAt:       new Date(now).toISOString(),
      escalatedAt:    null,
      resolvedAt:     null,
      suppressedAt:   null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedBy:     null,
      resolution:     null,
      suppression:    null
    };
    this._alerts.set(id, alert);
    this._stats.alertsRaised++;
    return { ...alert };
  }

  _findAlert(key) {
    return [...this._alerts.values()].find(a => a.key === key) || null;
  }

  async _notifyRaised(alert) {
    const isStock = alert.type === ALERT_TYPES.LOW_STOCK || alert.type === ALERT_TYPES.CRITICAL_STOCK;
    if (this.notifications?.notifyLowStock && isStock) {
      await this.notifications.notifyLowStock({
        itemName: alert.title, currentQty: alert.meta.quantity,
        threshold: alert.meta.threshold, unitId: alert.unitId, itemId: alert.meta.itemId
      }).catch(err => console.error('[alert-escalation] notifyLowStock error:', err.message));
    }
  }

  async _notifyEscalated(alert) {
    // Future hook: push escalation to unit commander via notification service
    if (this.auditLog) {
      await this.auditLog.log({
        action: 'ALERT_ESCALATED', resource: 'alerts', resourceId: String(alert.id),
        details: { type: alert.type, title: alert.title, severity: alert.severity },
        success: true, severity: alert.severity
      }).catch(err => console.error('[alert-escalation] audit error:', err.message));
    }
  }

  static get ALERT_TYPES() { return ALERT_TYPES; }
  static get STATUS()       { return STATUS; }
  static get SEVERITY()     { return SEVERITY; }

  getStats() {
    return {
      ...this._stats,
      totalAlerts: this._alerts.size,
      activeAlerts: this.getActiveAlerts().length
    };
  }
}

module.exports = AlertEscalationService;
