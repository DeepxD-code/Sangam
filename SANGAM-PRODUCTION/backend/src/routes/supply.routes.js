'use strict';

const express              = require('express');
const SupplyChainService   = require('../services/supply-chain.service');
const AuditLogService      = require('../services/audit-log.service');
const NotificationService  = require('../services/notification.service');
const AuthMiddleware        = require('../middleware/auth.middleware');

/**
 * SANGAM Supply Chain Routes  (Day 19)
 *
 * Items:
 *   POST   /supply/items                       → createItem           [supply:write]
 *   GET    /supply/items                       → getItemsInScope      [supply:read]
 *   GET    /supply/items/:id                   → getItemById          [supply:read]
 *   PUT    /supply/items/:id                   → updateItem           [supply:write]
 *   DELETE /supply/items/:id                   → deleteItem           [supply:delete]
 *   GET    /supply/categories                  → list valid categories [supply:read]
 *
 * Transfers:
 *   POST   /supply/transfers                   → initiateTransfer     [supply:transfer]
 *   GET    /supply/transfers                   → getTransfersInScope  [supply:read]
 *   GET    /supply/transfers/:id               → getTransferById      [supply:read]
 *   POST   /supply/transfers/:id/approve       → approveTransfer      [supply:approve]
 *   POST   /supply/transfers/:id/reject        → rejectTransfer       [supply:approve]
 *
 * Blockchain ledger:
 *   GET    /supply/blockchain                  → getBlocks            [blockchain:read]
 *   GET    /supply/blockchain/:blockIndex      → getBlockByIndex      [blockchain:read]
 *   POST   /supply/blockchain/verify           → verifyChain          [blockchain:verify]
 *
 * Meta:
 *   GET    /supply/stats                       → getStats             [reports:read]
 */
function createSupplyRoutes(
  db,
  sharedAudit         = null,
  sharedNotifications = null,
  sharedSupply        = null   // injection for tests
) {
  const router = express.Router();
  const audit  = sharedAudit || new AuditLogService(db);
  const auth   = new AuthMiddleware(db, audit);

  const notifications = sharedNotifications
    || new NotificationService(db, auth.rbac, audit);

  const supply = sharedSupply
    || new SupplyChainService(db, auth.rbac, notifications, audit);

  // Helper: resolve command scope for the requesting user
  async function scopeFor(user) {
    // RBACService.getCommandScope returns { ids: number[], codes: string[] }
    // Routes need the plain ids array for .includes() checks.
    const scope = await auth.rbac.getCommandScope(user.unitId, db);
    return scope.ids;
  }

  // Helper: verify the requesting user's scope contains the item's unit
  async function userCanAccessItem(user, item) {
    const scope = await scopeFor(user);
    return scope.includes(item.unitId);
  }

  // ================================================================
  // ITEMS
  // ================================================================

  /**
   * POST /supply/items
   * Create a new supply item for a unit.
   */
  router.post('/items',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('SUPPLY_ITEM_CREATE', 'supply_items'),
    async (req, res) => {
      try {
        const { itemCode, itemName, category, unitId,
                quantity, unitOfMeasure, lowStockThreshold } = req.body;

        if (!itemCode || !itemName || !category || !unitId) {
          return res.status(400).json({
            success: false, error: 'MISSING_FIELDS',
            message: 'itemCode, itemName, category, unitId are required'
          });
        }

        // Scope check: user must have authority over the target unit
        const scope = await scopeFor(req.user);
        if (!scope.includes(parseInt(unitId, 10))) {
          return res.status(403).json({
            success: false, error: 'UNIT_OUT_OF_SCOPE',
            message: 'You do not have authority over the specified unit'
          });
        }

        const result = await supply.createItem({
          itemCode, itemName, category,
          unitId: parseInt(unitId, 10),
          quantity, unitOfMeasure, lowStockThreshold,
          createdByUserId: req.user.userId
        });

        if (!result.success) {
          const statusMap = {
            ITEM_CODE_EXISTS: 409,
            INVALID_CATEGORY: 400
          };
          return res.status(statusMap[result.error] || 400).json(result);
        }

        res.status(201).json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /supply/items
   * List items within the user's command scope.
   * Query params: category, unitId, lowStockOnly=true, search, limit, offset
   */
  router.get('/items',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        const filters = {};
        if (req.query.category)     filters.category    = req.query.category;
        if (req.query.unitId)       filters.unitId      = req.query.unitId;
        if (req.query.lowStockOnly === 'true') filters.lowStockOnly = true;
        if (req.query.search)       filters.search      = req.query.search;
        // Day 62: HTTP callers always want pagination, even if they don't
        // specify it — default to 50/page here at the route layer. The
        // service layer itself stays opt-in (see getItemsInScope) since
        // several internal callers need the complete unbounded set.
        filters.limit  = req.query.limit  ? parseInt(req.query.limit, 10)  : 50;
        filters.offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

        // If caller specifies unitId, ensure it's in scope
        if (filters.unitId && !scope.includes(parseInt(filters.unitId, 10))) {
          return res.status(403).json({
            success: false, error: 'UNIT_OUT_OF_SCOPE'
          });
        }

        const data = supply.getItemsInScope(scope, filters);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /supply/items/:id
   */
  router.get('/items/:id',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const item = supply.getItemById(req.params.id);
        if (!item) {
          return res.status(404).json({ success: false, error: 'ITEM_NOT_FOUND' });
        }

        if (!(await userCanAccessItem(req.user, item))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        res.json({ success: true, item });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * PUT /supply/items/:id
   * Update item fields (quantity, name, threshold, unitOfMeasure).
   */
  router.put('/items/:id',
    auth.authenticate(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('SUPPLY_ITEM_UPDATE', 'supply_items'),
    async (req, res) => {
      try {
        const item = supply.getItemById(req.params.id);
        if (!item) {
          return res.status(404).json({ success: false, error: 'ITEM_NOT_FOUND' });
        }

        if (!(await userCanAccessItem(req.user, item))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        const updates = {};
        const allowed = ['quantity', 'itemName', 'lowStockThreshold', 'unitOfMeasure'];
        for (const key of allowed) {
          if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({
            success: false, error: 'NO_UPDATE_FIELDS',
            message: `Updatable fields: ${allowed.join(', ')}`
          });
        }

        const result = await supply.updateItem(req.params.id, updates, req.user.userId);
        if (!result.success) {
          return res.status(400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * DELETE /supply/items/:id  (soft delete)
   */
  router.delete('/items/:id',
    auth.authenticate(),
    auth.requirePermission('supply:delete'),
    auth.auditRequest('SUPPLY_ITEM_DELETE', 'supply_items'),
    async (req, res) => {
      try {
        const item = supply.getItemById(req.params.id);
        if (!item) {
          return res.status(404).json({ success: false, error: 'ITEM_NOT_FOUND' });
        }

        if (!(await userCanAccessItem(req.user, item))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        const result = await supply.deleteItem(req.params.id, req.user.userId);
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /supply/categories
   * Return the static list of valid item categories.
   */
  router.get('/categories',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    (req, res) => {
      res.json({
        success: true,
        categories: SupplyChainService.ITEM_CATEGORIES
      });
    }
  );

  // ================================================================
  // TRANSFERS
  // ================================================================

  /**
   * POST /supply/transfers
   * Initiate a transfer request.
   * Body: { itemId, fromUnitId, toUnitId, quantity, notes }
   */
  router.post('/transfers',
    auth.authenticate(),
    auth.requirePermission('supply:transfer'),
    auth.auditRequest('SUPPLY_TRANSFER_INITIATE', 'transfers'),
    async (req, res) => {
      try {
        const { itemId, fromUnitId, toUnitId, quantity, notes } = req.body;

        if (!itemId || !fromUnitId || !toUnitId || !quantity) {
          return res.status(400).json({
            success: false, error: 'MISSING_FIELDS',
            message: 'itemId, fromUnitId, toUnitId, quantity are required'
          });
        }

        // User must have authority over the fromUnit
        const scope = await scopeFor(req.user);
        if (!scope.includes(parseInt(fromUnitId, 10))) {
          return res.status(403).json({
            success: false, error: 'UNIT_OUT_OF_SCOPE',
            message: 'You do not have authority over the source unit'
          });
        }

        const result = await supply.initiateTransfer({
          itemId, fromUnitId, toUnitId, quantity,
          requestedByUserId: req.user.userId,
          notes
        });

        if (!result.success) {
          const statusMap = {
            ITEM_NOT_FOUND:      404,
            INSUFFICIENT_STOCK:  409,
            ITEM_NOT_IN_FROM_UNIT: 400
          };
          return res.status(statusMap[result.error] || 400).json(result);
        }

        res.status(201).json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /supply/transfers
   * List transfers in scope.
   * Query params: status, itemId, limit, offset
   */
  router.get('/transfers',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        const filters = {};
        if (req.query.status) filters.status = req.query.status;
        if (req.query.itemId) filters.itemId = req.query.itemId;
        if (req.query.limit)  filters.limit  = parseInt(req.query.limit, 10);
        if (req.query.offset) filters.offset = parseInt(req.query.offset, 10);

        const data = supply.getTransfersInScope(scope, filters);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /supply/transfers/:id
   */
  router.get('/transfers/:id',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    async (req, res) => {
      try {
        const transfer = supply.getTransferById(req.params.id);
        if (!transfer) {
          return res.status(404).json({ success: false, error: 'TRANSFER_NOT_FOUND' });
        }

        const scope = await scopeFor(req.user);
        const inScope = scope.includes(transfer.fromUnitId) ||
                        scope.includes(transfer.toUnitId);
        if (!inScope) {
          return res.status(403).json({ success: false, error: 'OUT_OF_SCOPE' });
        }

        res.json({ success: true, transfer });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /supply/transfers/:id/approve
   * Approve a pending transfer. Requires supply:approve.
   */
  router.post('/transfers/:id/approve',
    auth.authenticate(),
    auth.requirePermission('supply:approve'),
    auth.auditRequest('SUPPLY_TRANSFER_APPROVE', 'transfers'),
    async (req, res) => {
      try {
        const transfer = supply.getTransferById(req.params.id);
        if (!transfer) {
          return res.status(404).json({ success: false, error: 'TRANSFER_NOT_FOUND' });
        }

        // Approver must have authority over the source unit
        const scope = await scopeFor(req.user);
        if (!scope.includes(transfer.fromUnitId)) {
          return res.status(403).json({
            success: false, error: 'UNIT_OUT_OF_SCOPE',
            message: 'You do not have authority over the source unit'
          });
        }

        const result = await supply.approveTransfer(req.params.id, req.user.userId);
        if (!result.success) {
          const statusMap = {
            TRANSFER_NOT_FOUND: 404,
            INVALID_STATUS:     409,
            INSUFFICIENT_STOCK: 409
          };
          return res.status(statusMap[result.error] || 400).json(result);
        }

        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /supply/transfers/:id/reject
   * Reject a pending transfer. Requires supply:approve.
   * Body: { reason }
   */
  router.post('/transfers/:id/reject',
    auth.authenticate(),
    auth.requirePermission('supply:approve'),
    auth.auditRequest('SUPPLY_TRANSFER_REJECT', 'transfers'),
    async (req, res) => {
      try {
        const transfer = supply.getTransferById(req.params.id);
        if (!transfer) {
          return res.status(404).json({ success: false, error: 'TRANSFER_NOT_FOUND' });
        }

        const scope = await scopeFor(req.user);
        if (!scope.includes(transfer.fromUnitId)) {
          return res.status(403).json({
            success: false, error: 'UNIT_OUT_OF_SCOPE'
          });
        }

        const { reason = '' } = req.body;
        const result = await supply.rejectTransfer(req.params.id, req.user.userId, reason);
        if (!result.success) {
          return res.status(409).json(result);
        }

        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // BLOCKCHAIN LEDGER
  // ================================================================

  /**
   * GET /supply/blockchain
   * List recent blockchain blocks.
   * Query params: limit (default 20, max 100)
   */
  router.get('/blockchain',
    auth.authenticate(),
    auth.requirePermission('blockchain:read'),
    async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const data  = supply.getBlocks(limit);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /supply/blockchain/:blockIndex
   * Get a single block by its index.
   */
  router.get('/blockchain/:blockIndex',
    auth.authenticate(),
    auth.requirePermission('blockchain:read'),
    async (req, res) => {
      try {
        const idx   = parseInt(req.params.blockIndex, 10);
        const block = supply.getBlockByIndex(idx);
        if (!block) {
          return res.status(404).json({ success: false, error: 'BLOCK_NOT_FOUND' });
        }
        res.json({ success: true, block });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /supply/blockchain/verify
   * Verify the in-memory chain's hash integrity.
   * Requires blockchain:verify (JCO rank 5+).
   */
  router.post('/blockchain/verify',
    auth.authenticate(),
    auth.requirePermission('blockchain:verify'),
    auth.auditRequest('BLOCKCHAIN_VERIFY', 'blockchain_blocks'),
    async (req, res) => {
      try {
        const result = supply.verifyChain();
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // META
  // ================================================================

  /**
   * GET /supply/stats
   * Service-level statistics.
   */
  router.get('/stats',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        res.json({ success: true, stats: supply.getStats() });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  return router;
}

module.exports = createSupplyRoutes;
