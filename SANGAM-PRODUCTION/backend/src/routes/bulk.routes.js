'use strict';

const express               = require('express');
const BulkOperationsService = require('../services/bulk-operations.service');
const AuditLogService       = require('../services/audit-log.service');
const AuthMiddleware        = require('../middleware/auth.middleware');
const RateLimiter           = require('../services/rate-limiter.service');

/**
 * SANGAM Bulk Operations Routes  (Day 21; rate limiting added Day 61)
 *
 * Mounted at /api/bulk in app.js (this file's own paths below are
 * relative to that mount — corrected Day 61, previously read "/bulk/..."
 * which doesn't match the real, reachable URL).
 *
 *   POST  /api/bulk/import-items     → CSV item import            [supply:write]
 *   POST  /api/bulk/transfers        → bulk transfer initiate     [supply:transfer]
 *   POST  /api/bulk/approve          → bulk transfer approve      [supply:approve]
 *   POST  /api/bulk/update-quantity  → batch stock adjustment     [supply:write]
 *   GET   /api/bulk/export-items     → items CSV export           [supply:read + reports:export]
 *   GET   /api/bulk/limits           → advertise batch size caps  [supply:read]
 *
 * Before Day 61, RateLimiter (Day 22) was only ever applied to
 * /auth/login. These four mutating endpoints can each create or modify
 * many records in a single call — a much higher-impact abuse surface
 * than any single-record endpoint — and had no throttling at all.
 * Keyed by authenticated user (not IP, unlike login's pre-auth limiter)
 * since these routes already require a valid token, so per-account
 * throttling is more precise than per-IP and avoids false-positives
 * for multiple legitimate users behind a shared IP/NAT.
 */
function createBulkRoutes(
  db,
  sharedAudit  = null,
  sharedSupply = null
) {
  const router  = express.Router();
  const audit   = sharedAudit || new AuditLogService(db);
  const auth    = new AuthMiddleware(db, audit);
  const bulk    = new BulkOperationsService(sharedSupply, audit, auth.rbac);
  const limiter = new RateLimiter();

  // 20 bulk mutations per 5 minutes per user — generous for legitimate
  // operational use, but a real ceiling against scripted abuse.
  const bulkLimit = () => limiter.middleware(20, 5 * 60 * 1000, req => req.user?.userId ? `user:${req.user.userId}` : req.ip);

  // Helper: resolve command scope
  async function scopeFor(user) {
    // RBACService.getCommandScope returns { ids: number[], codes: string[] }
    // Routes need the plain ids array for .includes() checks.
    const scope = await auth.rbac.getCommandScope(user.unitId, db);
    return scope.ids;
  }

  // ================================================================
  // POST /bulk/import-items
  // Body: { unitId, csv }  where csv is plain text
  // ================================================================
  router.post('/import-items',
    auth.authenticate(),
    bulkLimit(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('BULK_IMPORT', 'supply_items'),
    async (req, res) => {
      try {
        const { unitId, csv } = req.body;
        if (!csv) {
          return res.status(400).json({
            success: false, error: 'MISSING_CSV',
            message: 'Provide csv (string) and unitId in request body'
          });
        }
        if (!unitId) {
          return res.status(400).json({ success: false, error: 'MISSING_UNIT_ID' });
        }

        // Scope check — user must have authority over target unit
        const scope = await scopeFor(req.user);
        if (!scope.includes(parseInt(unitId, 10))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        const result = await bulk.importItemsFromCSV(csv, unitId, req.user.userId);
        if (!result.success) {
          return res.status(400).json(result);
        }
        res.status(207).json(result); // 207 Multi-Status (partial success possible)
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /bulk/transfers
  // Body: { transfers: [{ itemId, fromUnitId, toUnitId, quantity, notes }] }
  // ================================================================
  router.post('/transfers',
    auth.authenticate(),
    bulkLimit(),
    auth.requirePermission('supply:transfer'),
    auth.auditRequest('BULK_TRANSFER_INITIATE', 'transfers'),
    async (req, res) => {
      try {
        const { transfers } = req.body;
        if (!Array.isArray(transfers) || transfers.length === 0) {
          return res.status(400).json({
            success: false, error: 'MISSING_TRANSFERS',
            message: 'Provide transfers array in body'
          });
        }

        // Verify caller has scope over all fromUnitIds
        const scope = await scopeFor(req.user);
        const outOfScope = transfers.filter(
          t => t.fromUnitId && !scope.includes(parseInt(t.fromUnitId, 10))
        );
        if (outOfScope.length > 0) {
          return res.status(403).json({
            success: false, error: 'UNIT_OUT_OF_SCOPE',
            message: `${outOfScope.length} transfer(s) reference units outside your authority`
          });
        }

        const result = await bulk.bulkTransfer(transfers, req.user.userId);
        res.status(207).json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /bulk/approve
  // Body: { transferIds: [number] }
  // ================================================================
  router.post('/approve',
    auth.authenticate(),
    bulkLimit(),
    auth.requirePermission('supply:approve'),
    auth.auditRequest('BULK_TRANSFER_APPROVE', 'transfers'),
    async (req, res) => {
      try {
        const { transferIds } = req.body;
        if (!Array.isArray(transferIds) || transferIds.length === 0) {
          return res.status(400).json({
            success: false, error: 'MISSING_TRANSFER_IDS',
            message: 'Provide transferIds array in body'
          });
        }

        // Scope guard: verify caller has authority over fromUnit of each transfer
        const scope = await scopeFor(req.user);
        for (const id of transferIds) {
          const t = sharedSupply?.getTransferById(id);
          if (t && !scope.includes(t.fromUnitId)) {
            return res.status(403).json({
              success: false, error: 'UNIT_OUT_OF_SCOPE',
              message: `Transfer ${id}: source unit not in your command scope`
            });
          }
        }

        const result = await bulk.bulkApprove(transferIds, req.user.userId);
        res.status(207).json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /bulk/update-quantity
  // Body: { updates: [{ itemId, quantity }] }
  // ================================================================
  router.post('/update-quantity',
    auth.authenticate(),
    bulkLimit(),
    auth.requirePermission('supply:write'),
    auth.auditRequest('BULK_QUANTITY_UPDATE', 'supply_items'),
    async (req, res) => {
      try {
        const { updates } = req.body;
        if (!Array.isArray(updates) || updates.length === 0) {
          return res.status(400).json({
            success: false, error: 'MISSING_UPDATES',
            message: 'Provide updates array in body'
          });
        }

        // Scope guard: each item must belong to a unit in caller's scope
        const scope = await scopeFor(req.user);
        for (const u of updates) {
          const item = sharedSupply?.getItemById(u.itemId);
          if (item && !scope.includes(item.unitId)) {
            return res.status(403).json({
              success: false, error: 'UNIT_OUT_OF_SCOPE',
              message: `Item ${u.itemId} belongs to a unit outside your authority`
            });
          }
        }

        const result = await bulk.bulkUpdateQuantity(updates, req.user.userId);
        res.status(207).json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /bulk/export-items
  // Query: category, unitId, lowStockOnly, search
  // Returns CSV download
  // ================================================================
  router.get('/export-items',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    auth.requirePermission('reports:export'),
    auth.auditRequest('BULK_ITEM_EXPORT', 'supply_items'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        const filters = {};
        if (req.query.category)     filters.category    = req.query.category;
        if (req.query.unitId)       filters.unitId      = req.query.unitId;
        if (req.query.lowStockOnly === 'true') filters.lowStockOnly = true;
        if (req.query.search)       filters.search      = req.query.search;

        const { items } = sharedSupply?.getItemsInScope(scope, filters) || { items: [] };
        const csv       = bulk.exportItemsToCSV(items);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition',
          `attachment; filename="sangam-items-${Date.now()}.csv"`);
        res.send(csv);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /bulk/limits
  // Advertise batch size limits to clients
  // ================================================================
  router.get('/limits',
    auth.authenticate(),
    auth.requirePermission('supply:read'),
    (req, res) => {
      res.json({ success: true, limits: BulkOperationsService.LIMITS });
    }
  );

  return router;
}

module.exports = createBulkRoutes;
