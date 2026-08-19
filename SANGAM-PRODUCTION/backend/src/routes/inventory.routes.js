'use strict';

const express                = require('express');
const InventoryLedgerService = require('../services/inventory-ledger.service');
const AuditLogService        = require('../services/audit-log.service');
const AuthMiddleware         = require('../middleware/auth.middleware');

/**
 * SANGAM Inventory Stock-Take Routes  (Day 24)
 *
 *   POST  /inventory/sessions             → createSession         [supply:write]
 *   GET   /inventory/sessions             → getSessionsForUnit    [supply:read]
 *   GET   /inventory/sessions/active      → getActiveSession      [supply:read]
 *   GET   /inventory/sessions/:id         → getSession            [supply:read]
 *   POST  /inventory/sessions/:id/count   → recordCount           [supply:write]
 *   POST  /inventory/sessions/:id/finalize → finalizeSession      [supply:write]
 *   POST  /inventory/sessions/:id/approve → approveReconciliation [supply:approve]
 *   POST  /inventory/sessions/:id/cancel  → cancelSession         [supply:write]
 *   GET   /inventory/states               → SESSION_STATES        [supply:read]
 */
function createInventoryRoutes(
  db,
  sharedAudit  = null,
  sharedSupply = null,
  sharedLedger = null   // injection for tests
) {
  const router = express.Router();
  const audit  = sharedAudit || new AuditLogService(db);
  const auth   = new AuthMiddleware(db, audit);
  const ledger = sharedLedger
    || new InventoryLedgerService(db, sharedSupply, audit);

  async function scopeFor(user) {
    // RBACService.getCommandScope returns { ids: number[], codes: string[] }
    // Routes need the plain ids array for .includes() checks.
    const scope = await auth.rbac.getCommandScope(user.unitId, db);
    return scope.ids;
  }

  // ================================================================
  // GET /inventory/states
  // ================================================================
  router.get('/states',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    (req, res) => res.json({
      success: true,
      states: Object.values(InventoryLedgerService.SESSION_STATES)
    })
  );

  // ================================================================
  // POST /inventory/sessions
  // Body: { unitId, notes }
  // ================================================================
  router.post('/sessions',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('STOCKTAKE_SESSION_CREATE', 'stocktake_sessions'),
    async (req, res) => {
      try {
        const { unitId, notes } = req.body;
        if (!unitId) return res.status(400).json({ success: false, error: 'MISSING_UNIT_ID' });

        const scope = await scopeFor(req.user);
        if (!scope.includes(parseInt(unitId, 10))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        const result = await ledger.createSession({ unitId, actorUserId: req.user.userId, notes });
        if (!result.success) {
          return res.status(result.error === 'ACTIVE_SESSION_EXISTS' ? 409 : 400).json(result);
        }
        res.status(201).json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /inventory/sessions/active?unitId=...
  // ================================================================
  router.get('/sessions/active',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const { unitId } = req.query;
        if (!unitId) return res.status(400).json({ success: false, error: 'MISSING_UNIT_ID' });

        const scope = await scopeFor(req.user);
        if (!scope.includes(parseInt(unitId, 10))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        const session = ledger.getActiveSession(unitId);
        res.json({ success: true, session: session || null });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /inventory/sessions?unitId=...
  // ================================================================
  router.get('/sessions',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const { unitId, state, limit, offset } = req.query;
        if (!unitId) return res.status(400).json({ success: false, error: 'MISSING_UNIT_ID' });

        const scope = await scopeFor(req.user);
        if (!scope.includes(parseInt(unitId, 10))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        const result = ledger.getSessionsForUnit(unitId, {
          state,
          limit:  limit  ? parseInt(limit, 10)  : 20,
          offset: offset ? parseInt(offset, 10) : 0
        });
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /inventory/sessions/:id
  // ================================================================
  router.get('/sessions/:id',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const session = ledger.getSession(req.params.id);
        if (!session) return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND' });

        const scope = await scopeFor(req.user);
        if (!scope.includes(session.unitId)) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }
        res.json({ success: true, session });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /inventory/sessions/:id/count
  // Body: { itemId, physicalCount, notes }
  // ================================================================
  router.post('/sessions/:id/count',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    async (req, res) => {
      try {
        const { itemId, physicalCount, notes } = req.body;
        if (itemId === undefined || physicalCount === undefined) {
          return res.status(400).json({
            success: false, error: 'MISSING_FIELDS',
            message: 'itemId and physicalCount are required'
          });
        }

        const result = await ledger.recordCount(
          req.params.id, itemId, physicalCount, req.user.userId, notes);

        if (!result.success) {
          const statusMap = {
            SESSION_NOT_FOUND:  404,
            ITEM_NOT_FOUND:     404,
            SESSION_NOT_ACTIVE: 409,
            ITEM_UNIT_MISMATCH: 400,
            INVALID_COUNT:      400
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
  // POST /inventory/sessions/:id/finalize
  // ================================================================
  router.post('/sessions/:id/finalize',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('STOCKTAKE_SESSION_FINALIZE', 'stocktake_sessions'),
    async (req, res) => {
      try {
        const result = await ledger.finalizeSession(req.params.id, req.user.userId);
        if (!result.success) {
          return res.status(result.error === 'SESSION_NOT_FOUND' ? 404 : 409).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /inventory/sessions/:id/approve
  // ================================================================
  router.post('/sessions/:id/approve',
    auth.authenticate(),
    auth.requirePermission('supply:approve'),
    auth.auditRequest('STOCKTAKE_RECONCILE', 'stocktake_sessions'),
    async (req, res) => {
      try {
        const session = ledger.getSession(req.params.id);
        if (!session) return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND' });

        const scope = await scopeFor(req.user);
        if (!scope.includes(session.unitId)) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        const result = await ledger.approveReconciliation(req.params.id, req.user.userId);
        if (!result.success) {
          return res.status(result.error === 'SESSION_NOT_FOUND' ? 404 : 409).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /inventory/sessions/:id/cancel
  // Body: { reason }
  // ================================================================
  router.post('/sessions/:id/cancel',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('STOCKTAKE_SESSION_CANCEL', 'stocktake_sessions'),
    async (req, res) => {
      try {
        const { reason = '' } = req.body;
        const result = await ledger.cancelSession(req.params.id, req.user.userId, reason);
        if (!result.success) {
          const statusMap = {
            SESSION_NOT_FOUND:  404,
            ALREADY_RECONCILED: 409,
            ALREADY_CANCELLED:  409
          };
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

module.exports = createInventoryRoutes;
