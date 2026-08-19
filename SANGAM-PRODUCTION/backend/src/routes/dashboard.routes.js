'use strict';

const express          = require('express');
const DashboardService = require('../services/dashboard.service');
const AuditLogService  = require('../services/audit-log.service');
const AuthMiddleware   = require('../middleware/auth.middleware');

/**
 * SANGAM Live Dashboard Routes  (Day 26)
 *
 *   GET  /dashboard/summary           → full aggregated dashboard [reports:read]
 *   POST /dashboard/refresh           → force-clear cache + refetch [reports:read]
 */
function createDashboardRoutes(
  db,
  sharedAudit    = null,
  sharedServices = {}   // { supply, units, users, inventory, movement, dashboard? }
) {
  const router = express.Router();
  const audit  = sharedAudit || new AuditLogService(db);
  const auth   = new AuthMiddleware(db, audit);

  // sharedServices.dashboard allows injection of a pre-built DashboardService
  // (used by HTTP integration tests that need to inspect/seed its cache directly).
  // Production callers omit it and a fresh instance is constructed as before.
  const dashboard = sharedServices.dashboard || new DashboardService({
    supply:    sharedServices.supply,
    units:     sharedServices.units,
    users:     sharedServices.users,
    inventory: sharedServices.inventory,
    movement:  sharedServices.movement,
    alerts:    sharedServices.alerts,   // Day 31: alert singleton
    auditLog:  audit
  });

  async function scopeFor(user) {
    const scope = await auth.rbac.getCommandScope(user.unitId, db);
    return scope.ids;
  }

  // ================================================================
  // GET /dashboard/summary
  // ================================================================
  router.get('/summary',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        const forceRefresh = req.query.forceRefresh === 'true';

        const result = await dashboard.getSummary(req.user, scope, { forceRefresh });
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /dashboard/refresh
  // ================================================================
  router.post('/refresh',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        dashboard.clearCache(req.user.userId);
        const scope  = await scopeFor(req.user);
        const result = await dashboard.getSummary(req.user, scope, { forceRefresh: true });
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  return router;
}

module.exports = createDashboardRoutes;
