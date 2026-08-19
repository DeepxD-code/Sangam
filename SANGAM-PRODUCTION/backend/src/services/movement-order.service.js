'use strict';

/**
 * SANGAM Movement Orders Service  (Day 25)
 *
 * Coordinates the physical movement of supplies between Army units.
 * A Transfer (Day 19) is a LEDGER entry — Movement Orders track the
 * LOGISTICS: vehicle assignment, route, checkpoints, delivery confirmation.
 *
 * A Movement Order may be linked to a supply Transfer, or standalone
 * (e.g. emergency resupply not yet reflected in ledger).
 *
 * Status lifecycle:
 *   PLANNED → DISPATCHED → IN_TRANSIT → DELIVERED
 *                        ↘ CANCELLED  (from any pre-delivered state)
 *
 * Methods:
 *   createOrder(params)                       → create PLANNED order
 *   assignVehicle(orderId, details, actorId)  → attach vehicle/driver
 *   dispatch(orderId, actorId)                → PLANNED → DISPATCHED
 *   recordCheckpoint(orderId, cp, actorId)    → IN_TRANSIT update
 *   recordDelivery(orderId, qty, actorId)     → DISPATCHED/IN_TRANSIT → DELIVERED
 *   cancelOrder(orderId, reason, actorId)     → cancel
 *   getOrder(orderId)                         → full order detail
 *   getOrdersInScope(scopeUnitIds, filters)   → paginated list
 *   getActiveOrdersForUnit(unitId)            → non-terminal orders for unit
 */

const ORDER_STATES = {
  PLANNED:    'PLANNED',
  DISPATCHED: 'DISPATCHED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED:  'DELIVERED',
  CANCELLED:  'CANCELLED'
};

const ACTIVE_STATES = new Set(['PLANNED', 'DISPATCHED', 'IN_TRANSIT']);
const TERMINAL_STATES = new Set(['DELIVERED', 'CANCELLED']);

const PRIORITY_LEVELS = ['ROUTINE', 'PRIORITY', 'IMMEDIATE', 'EMERGENCY'];

class MovementOrderService {

  /**
   * @param {object} db           - pg Pool (null = offline)
   * @param {object} auditLog     - AuditLogService instance
   * @param {object} notifications - NotificationService instance
   */
  constructor(db, auditLog = null, notifications = null) {
    this.db            = db;
    this.auditLog      = auditLog;
    this.notifications = notifications;

    this._orders  = new Map();    // orderId → order
    this._nextId  = 1;

    this._stats = {
      ordersCreated:    0,
      ordersDispatched: 0,
      ordersDelivered:  0,
      ordersCancelled:  0
    };
  }

  // ================================================================
  // 1. CREATE ORDER
  // ================================================================

  /**
   * @param {object} params
   *   fromUnitId    {number} required
   *   toUnitId      {number} required
   *   items         {Array<{itemId, itemCode, itemName, quantity}>} required
   *   priority      {string} ROUTINE|PRIORITY|IMMEDIATE|EMERGENCY
   *   transferId    {number|null}  linked supply transfer
   *   vehicleReg    {string|null}
   *   driverId      {number|null}
   *   escortStrength {number}
   *   plannedDeparture {string} ISO date
   *   plannedArrival   {string} ISO date
   *   route         {string}
   *   notes         {string}
   *   createdByUserId {number}
   */
  async createOrder(params) {
    const {
      fromUnitId, toUnitId, items,
      priority       = 'ROUTINE',
      transferId     = null,
      vehicleReg     = null,
      driverId       = null,
      escortStrength = 0,
      plannedDeparture = null,
      plannedArrival   = null,
      route            = '',
      notes            = '',
      createdByUserId  = null
    } = params || {};

    if (!fromUnitId || !toUnitId) {
      return { success: false, error: 'MISSING_UNIT_IDS',
               message: 'fromUnitId and toUnitId are required' };
    }
    if (fromUnitId === toUnitId) {
      return { success: false, error: 'SAME_UNIT',
               message: 'Source and destination units must differ' };
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { success: false, error: 'MISSING_ITEMS',
               message: 'At least one item is required' };
    }
    if (!PRIORITY_LEVELS.includes(priority)) {
      return { success: false, error: 'INVALID_PRIORITY',
               message: `priority must be one of: ${PRIORITY_LEVELS.join(', ')}` };
    }

    // Validate item rows
    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) {
        return { success: false, error: 'INVALID_ITEM_QUANTITY',
                 message: `Item quantity must be > 0 (got ${item.quantity})` };
      }
    }

    const id  = this._nextId++;
    const now = new Date().toISOString();

    const order = {
      id,
      fromUnitId:      parseInt(fromUnitId, 10),
      toUnitId:        parseInt(toUnitId, 10),
      items:           items.map(i => ({ ...i, receivedQty: null })),
      priority,
      state:           ORDER_STATES.PLANNED,
      transferId:      transferId || null,
      vehicleReg:      vehicleReg || null,
      driverId:        driverId   || null,
      escortStrength:  parseInt(escortStrength, 10) || 0,
      route,
      notes,
      checkpoints:     [],
      plannedDeparture: plannedDeparture || null,
      plannedArrival:   plannedArrival   || null,
      actualDeparture:  null,
      actualArrival:    null,
      deliveredQty:     null,
      cancelReason:     null,
      createdByUserId,
      createdAt:       now,
      updatedAt:       now
    };

    this._orders.set(id, order);
    this._stats.ordersCreated++;

    await this._audit({
      userId: createdByUserId, action: 'MOVEMENT_ORDER_CREATE',
      resource: 'movement_orders', resourceId: String(id),
      details: { fromUnitId, toUnitId, priority, itemCount: items.length },
      success: true,
      severity: priority === 'EMERGENCY' ? 'CRITICAL' : 'INFO'
    });

    return { success: true, order: { ...order } };
  }

  // ================================================================
  // 2. ASSIGN VEHICLE
  // ================================================================

  /**
   * Attach or update vehicle details on a PLANNED or DISPATCHED order.
   * @param {object} details - { vehicleReg, driverId, escortStrength, route }
   */
  async assignVehicle(orderId, details, actorId = null) {
    const order = this._orders.get(parseInt(orderId, 10));
    if (!order) return { success: false, error: 'ORDER_NOT_FOUND' };
    if (TERMINAL_STATES.has(order.state)) {
      return { success: false, error: 'ORDER_TERMINAL',
               message: `Cannot modify a ${order.state} order` };
    }

    const allowed = ['vehicleReg', 'driverId', 'escortStrength', 'route'];
    const changes = {};
    for (const k of allowed) {
      if (details[k] !== undefined) changes[k] = details[k];
    }
    if (Object.keys(changes).length === 0) {
      return { success: false, error: 'NO_UPDATE_FIELDS' };
    }

    Object.assign(order, changes, { updatedAt: new Date().toISOString() });

    await this._audit({
      userId: actorId, action: 'MOVEMENT_ORDER_VEHICLE_ASSIGN',
      resource: 'movement_orders', resourceId: String(orderId),
      details: changes, success: true
    });

    return { success: true, order: { ...order } };
  }

  // ================================================================
  // 3. DISPATCH
  // ================================================================

  async dispatch(orderId, actorId = null) {
    const order = this._orders.get(parseInt(orderId, 10));
    if (!order) return { success: false, error: 'ORDER_NOT_FOUND' };
    if (order.state !== ORDER_STATES.PLANNED) {
      return { success: false, error: 'INVALID_STATE',
               message: `Can only dispatch PLANNED orders (current: ${order.state})` };
    }

    order.state          = ORDER_STATES.DISPATCHED;
    order.actualDeparture = new Date().toISOString();
    order.updatedAt      = order.actualDeparture;
    this._stats.ordersDispatched++;

    await this._audit({
      userId: actorId, action: 'MOVEMENT_ORDER_DISPATCH',
      resource: 'movement_orders', resourceId: String(orderId),
      details: { fromUnitId: order.fromUnitId, toUnitId: order.toUnitId,
                 vehicleReg: order.vehicleReg },
      success: true
    });

    return { success: true, order: { ...order } };
  }

  // ================================================================
  // 4. RECORD CHECKPOINT (IN_TRANSIT UPDATE)
  // ================================================================

  /**
   * @param {object} checkpoint - { location, timestamp?, notes? }
   */
  async recordCheckpoint(orderId, checkpoint, actorId = null) {
    const order = this._orders.get(parseInt(orderId, 10));
    if (!order) return { success: false, error: 'ORDER_NOT_FOUND' };

    const dispatchableStates = new Set([ORDER_STATES.DISPATCHED, ORDER_STATES.IN_TRANSIT]);
    if (!dispatchableStates.has(order.state)) {
      return { success: false, error: 'INVALID_STATE',
               message: `Checkpoints require DISPATCHED or IN_TRANSIT order (current: ${order.state})` };
    }
    if (!checkpoint || !checkpoint.location) {
      return { success: false, error: 'MISSING_LOCATION' };
    }

    const cp = {
      location:  checkpoint.location,
      timestamp: checkpoint.timestamp || new Date().toISOString(),
      notes:     checkpoint.notes || '',
      recordedBy: actorId
    };

    order.checkpoints.push(cp);
    order.state     = ORDER_STATES.IN_TRANSIT;
    order.updatedAt = cp.timestamp;

    return { success: true, checkpoint: cp, order: { ...order } };
  }

  // ================================================================
  // 5. RECORD DELIVERY
  // ================================================================

  /**
   * Mark order as DELIVERED and record quantities actually received.
   * @param {number}       orderId
   * @param {number|null}  receivedQty  - total units received (null = all)
   * @param {number}       actorId
   * @param {string}       notes
   */
  async recordDelivery(orderId, receivedQty = null, actorId = null, notes = '') {
    const order = this._orders.get(parseInt(orderId, 10));
    if (!order) return { success: false, error: 'ORDER_NOT_FOUND' };

    const validStates = new Set([ORDER_STATES.DISPATCHED, ORDER_STATES.IN_TRANSIT]);
    if (!validStates.has(order.state)) {
      return { success: false, error: 'INVALID_STATE',
               message: `Can only deliver DISPATCHED or IN_TRANSIT orders (current: ${order.state})` };
    }

    const totalOrdered = order.items.reduce((sum, i) => sum + i.quantity, 0);
    const delivered    = receivedQty !== null ? parseInt(receivedQty, 10) : totalOrdered;

    if (isNaN(delivered) || delivered < 0) {
      return { success: false, error: 'INVALID_QUANTITY' };
    }

    order.state         = ORDER_STATES.DELIVERED;
    order.deliveredQty  = delivered;
    order.actualArrival = new Date().toISOString();
    order.updatedAt     = order.actualArrival;
    if (notes) order.notes = order.notes ? `${order.notes}\nDelivery: ${notes}` : `Delivery: ${notes}`;
    this._stats.ordersDelivered++;

    const shortage = totalOrdered - delivered;

    await this._audit({
      userId: actorId, action: 'MOVEMENT_ORDER_DELIVERED',
      resource: 'movement_orders', resourceId: String(orderId),
      details: { toUnitId: order.toUnitId, totalOrdered, delivered, shortage },
      success: true,
      severity: shortage > 0 ? 'WARNING' : 'INFO'
    });

    return {
      success: true,
      order:   { ...order },
      summary: { totalOrdered, delivered, shortage, shortageFlag: shortage > 0 }
    };
  }

  // ================================================================
  // 6. CANCEL ORDER
  // ================================================================

  async cancelOrder(orderId, reason = '', actorId = null) {
    const order = this._orders.get(parseInt(orderId, 10));
    if (!order) return { success: false, error: 'ORDER_NOT_FOUND' };
    if (TERMINAL_STATES.has(order.state)) {
      return { success: false, error: 'ORDER_TERMINAL',
               message: `Cannot cancel a ${order.state} order` };
    }

    order.state        = ORDER_STATES.CANCELLED;
    order.cancelReason = reason;
    order.updatedAt    = new Date().toISOString();
    this._stats.ordersCancelled++;

    await this._audit({
      userId: actorId, action: 'MOVEMENT_ORDER_CANCEL',
      resource: 'movement_orders', resourceId: String(orderId),
      details: { reason, fromUnitId: order.fromUnitId, toUnitId: order.toUnitId },
      success: true
    });

    return { success: true, order: { ...order } };
  }

  // ================================================================
  // 7. GET ORDER
  // ================================================================

  getOrder(orderId) {
    const order = this._orders.get(parseInt(orderId, 10));
    return order ? { ...order } : null;
  }

  // ================================================================
  // 8. GET ORDERS IN SCOPE
  // ================================================================

  /**
   * @param {number[]} scopeUnitIds
   * @param {object}   filters - { state, priority, fromUnitId, toUnitId, limit, offset }
   */
  getOrdersInScope(scopeUnitIds, filters = {}) {
    const { state, priority, fromUnitId, toUnitId,
            limit = 50, offset = 0 } = filters;

    let orders = [...this._orders.values()].filter(o =>
      scopeUnitIds.includes(o.fromUnitId) || scopeUnitIds.includes(o.toUnitId));

    if (state)      orders = orders.filter(o => o.state === state);
    if (priority)   orders = orders.filter(o => o.priority === priority);
    if (fromUnitId) orders = orders.filter(o => o.fromUnitId === parseInt(fromUnitId, 10));
    if (toUnitId)   orders = orders.filter(o => o.toUnitId   === parseInt(toUnitId, 10));

    // Sort: EMERGENCY first, then by createdAt desc
    const priorityRank = Object.fromEntries(PRIORITY_LEVELS.map((p, i) => [p, i]));
    orders.sort((a, b) =>
      priorityRank[b.priority] - priorityRank[a.priority] ||
      new Date(b.createdAt) - new Date(a.createdAt));

    const total = orders.length;
    return {
      orders: orders.slice(offset, offset + limit).map(o => ({ ...o })),
      total, limit, offset
    };
  }

  // ================================================================
  // 9. GET ACTIVE ORDERS FOR UNIT
  // ================================================================

  getActiveOrdersForUnit(unitId) {
    const uid = parseInt(unitId, 10);
    return [...this._orders.values()]
      .filter(o => ACTIVE_STATES.has(o.state) &&
                   (o.fromUnitId === uid || o.toUnitId === uid))
      .map(o => ({ ...o }));
  }

  // ================================================================
  // STATIC METADATA
  // ================================================================

  static get ORDER_STATES()    { return ORDER_STATES; }
  static get PRIORITY_LEVELS() { return PRIORITY_LEVELS; }

  getStats() {
    return { ...this._stats, totalOrders: this._orders.size };
  }

  // ================================================================
  // INTERNALS
  // ================================================================

  async _audit(entry) {
    if (this.auditLog) await this.auditLog.log(entry).catch(err => console.error('[movement-order] audit error:', err.message));
  }
}

module.exports = MovementOrderService;
