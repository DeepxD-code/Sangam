'use strict';

const express              = require('express');
const MovementOrderService = require('../services/movement-order.service');
const AuditLogService      = require('../services/audit-log.service');
const AuthMiddleware       = require('../middleware/auth.middleware');

/**
 * SANGAM Movement Orders Routes  (Day 25)
 *
 *   POST  /movement/orders                    → createOrder         [supply:transfer]
 *   GET   /movement/orders                    → getOrdersInScope    [supply:read]
 *   GET   /movement/orders/priorities         → list priority levels [supply:read]
 *   GET   /movement/orders/states             → list order states   [supply:read]
 *   GET   /movement/orders/:id                → getOrder            [supply:read]
 *   POST  /movement/orders/:id/assign-vehicle → assignVehicle       [supply:write]
 *   POST  /movement/orders/:id/dispatch       → dispatch            [supply:approve]
 *   POST  /movement/orders/:id/checkpoint     → recordCheckpoint    [supply:write]
 *   POST  /movement/orders/:id/deliver        → recordDelivery      [supply:write]
 *   POST  /movement/orders/:id/cancel         → cancelOrder         [supply:write]
 *   GET   /movement/orders/unit/:unitId/active → getActiveOrders    [supply:read]
 */
function createMovementRoutes(
  db,
  sharedAudit  = null,
  sharedMovement = null  // injection for tests
) {
  const router  = express.Router();
  const audit   = sharedAudit || new AuditLogService(db);
  const auth    = new AuthMiddleware(db, audit);
  const movSvc  = sharedMovement || new MovementOrderService(db, audit);

  async function scopeFor(user) {
    // RBACService.getCommandScope returns { ids: number[], codes: string[] }
    // Routes need the plain ids array for .includes() checks.
    const scope = await auth.rbac.getCommandScope(user.unitId, db);
    return scope.ids;
  }

  // ================================================================
  // GET /movement/orders/priorities
  // ================================================================
  router.get('/orders/priorities',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    (req, res) => res.json({
      success: true,
      priorities: MovementOrderService.PRIORITY_LEVELS
    })
  );

  // ================================================================
  // GET /movement/orders/states
  // ================================================================
  router.get('/orders/states',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    (req, res) => res.json({
      success: true,
      states: Object.values(MovementOrderService.ORDER_STATES)
    })
  );

  // ================================================================
  // GET /movement/orders/unit/:unitId/active
  // Must be before /:id to avoid param capture
  // ================================================================
  router.get('/orders/unit/:unitId/active',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        if (!scope.includes(parseInt(req.params.unitId, 10))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }
        const orders = movSvc.getActiveOrdersForUnit(req.params.unitId);
        res.json({ success: true, orders, count: orders.length });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /movement/orders
  // ================================================================
  router.post('/orders',
    auth.authenticate(),
    auth.requirePermission('supply:transfer'),
    auth.auditRequest('MOVEMENT_ORDER_CREATE', 'movement_orders'),
    async (req, res) => {
      try {
        const { fromUnitId, toUnitId, items, priority,
                transferId, vehicleReg, driverId, escortStrength,
                plannedDeparture, plannedArrival, route, notes } = req.body;

        if (!fromUnitId || !toUnitId || !items) {
          return res.status(400).json({
            success: false, error: 'MISSING_FIELDS',
            message: 'fromUnitId, toUnitId, items are required'
          });
        }

        // Caller must have scope over fromUnit
        const scope = await scopeFor(req.user);
        if (!scope.includes(parseInt(fromUnitId, 10))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        const result = await movSvc.createOrder({
          fromUnitId, toUnitId, items, priority,
          transferId, vehicleReg, driverId, escortStrength,
          plannedDeparture, plannedArrival, route, notes,
          createdByUserId: req.user.userId
        });

        if (!result.success) {
          const statusMap = {
            MISSING_UNIT_IDS:    400,
            SAME_UNIT:           400,
            MISSING_ITEMS:       400,
            INVALID_PRIORITY:    400,
            INVALID_ITEM_QUANTITY: 400
          };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.status(201).json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /movement/orders
  // ================================================================
  router.get('/orders',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        const filters = {};
        if (req.query.state)      filters.state      = req.query.state;
        if (req.query.priority)   filters.priority   = req.query.priority;
        if (req.query.fromUnitId) filters.fromUnitId = req.query.fromUnitId;
        if (req.query.toUnitId)   filters.toUnitId   = req.query.toUnitId;
        if (req.query.limit)      filters.limit      = parseInt(req.query.limit, 10);
        if (req.query.offset)     filters.offset     = parseInt(req.query.offset, 10);

        const data = movSvc.getOrdersInScope(scope, filters);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /movement/orders/:id
  // ================================================================
  router.get('/orders/:id',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const order = movSvc.getOrder(req.params.id);
        if (!order) return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND' });

        const scope = await scopeFor(req.user);
        if (!scope.includes(order.fromUnitId) && !scope.includes(order.toUnitId)) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }
        res.json({ success: true, order });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /movement/orders/:id/assign-vehicle
  // ================================================================
  router.post('/orders/:id/assign-vehicle',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('MOVEMENT_ORDER_VEHICLE_ASSIGN', 'movement_orders'),
    async (req, res) => {
      try {
        const { vehicleReg, driverId, escortStrength, route } = req.body;
        const result = await movSvc.assignVehicle(
          req.params.id, { vehicleReg, driverId, escortStrength, route }, req.user.userId);

        if (!result.success) {
          const statusMap = { ORDER_NOT_FOUND: 404, ORDER_TERMINAL: 409 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /movement/orders/:id/dispatch
  // ================================================================
  router.post('/orders/:id/dispatch',
    auth.authenticate(),
    auth.requirePermission('supply:approve'),
    auth.auditRequest('MOVEMENT_ORDER_DISPATCH', 'movement_orders'),
    async (req, res) => {
      try {
        const result = await movSvc.dispatch(req.params.id, req.user.userId);
        if (!result.success) {
          const statusMap = { ORDER_NOT_FOUND: 404, INVALID_STATE: 409 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /movement/orders/:id/checkpoint
  // Body: { location, notes }
  // ================================================================
  router.post('/orders/:id/checkpoint',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    async (req, res) => {
      try {
        const { location, notes } = req.body;
        if (!location) {
          return res.status(400).json({ success: false, error: 'MISSING_LOCATION' });
        }
        const result = await movSvc.recordCheckpoint(
          req.params.id, { location, notes }, req.user.userId);

        if (!result.success) {
          const statusMap = { ORDER_NOT_FOUND: 404, INVALID_STATE: 409 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /movement/orders/:id/deliver
  // Body: { receivedQty, notes }
  // ================================================================
  router.post('/orders/:id/deliver',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('MOVEMENT_ORDER_DELIVERED', 'movement_orders'),
    async (req, res) => {
      try {
        const { receivedQty = null, notes = '' } = req.body;
        const result = await movSvc.recordDelivery(
          req.params.id, receivedQty, req.user.userId, notes);

        if (!result.success) {
          const statusMap = {
            ORDER_NOT_FOUND:  404,
            INVALID_STATE:    409,
            INVALID_QUANTITY: 400
          };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /movement/orders/:id/cancel
  // Body: { reason }
  // ================================================================
  router.post('/orders/:id/cancel',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('MOVEMENT_ORDER_CANCEL', 'movement_orders'),
    async (req, res) => {
      try {
        const { reason = '' } = req.body;
        const result = await movSvc.cancelOrder(req.params.id, reason, req.user.userId);
        if (!result.success) {
          const statusMap = { ORDER_NOT_FOUND: 404, ORDER_TERMINAL: 409 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  return router;
}

module.exports = createMovementRoutes;
