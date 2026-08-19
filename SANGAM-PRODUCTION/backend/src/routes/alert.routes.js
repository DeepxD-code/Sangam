'use strict';

const express                = require('express');
const AlertEscalationService = require('../services/alert-escalation.service');
const AuditLogService        = require('../services/audit-log.service');
const AuthMiddleware         = require('../middleware/auth.middleware');

/**
 * SANGAM Alert Escalation Routes  (Day 30 / Day 31 singleton-wired)
 *
 *   POST  /alerts/scan              → run violation scan        [reports:read]
 *   GET   /alerts                   → list alerts in scope      [reports:read]
 *   GET   /alerts/active            → active alerts only        [reports:read]
 *   GET   /alerts/stats             → alert statistics          [reports:read]
 *   GET   /alerts/:id               → get single alert          [reports:read]
 *   POST  /alerts/:id/acknowledge   → acknowledge alert         [supply:write]
 *   POST  /alerts/:id/resolve       → manually resolve          [supply:approve]
 *   POST  /alerts/:id/suppress      → suppress (silence)        [supply:approve]
 *   GET   /alerts/types             → list alert types          [reports:read]
 *
 * Day 31: sharedServices.alertService is the singleton wired in app.js.
 * If not provided (standalone test), one is constructed from the other
 * shared services — same fallback pattern used by all other routes.
 */
function createAlertRoutes(db, sharedAudit = null, sharedServices = {}) {
  const router = express.Router();
  const audit  = sharedAudit || new AuditLogService(db);
  const auth   = new AuthMiddleware(db, audit);

  // Day 31: accept pre-wired singleton OR fall back to constructing one
  const alertSvc = sharedServices.alertService || new AlertEscalationService({
    supply:    sharedServices.supply,
    inventory: sharedServices.inventory,
    movement:  sharedServices.movement,
    auditLog:  audit
  }, {}, sharedServices.notifications || null);

  async function scopeFor(user) {
    const s = await auth.rbac.getCommandScope(user.unitId, db);
    return s.ids;
  }

  // GET /alerts/types — must be before /:id
  router.get('/types', auth.authenticate(), auth.requirePermission('reports:read'), (req, res) => {
    res.json({ success: true, types: Object.values(AlertEscalationService.ALERT_TYPES) });
  });

  // GET /alerts/stats
  router.get('/stats', auth.authenticate(), auth.requirePermission('reports:read'), (req, res) => {
    res.json({ success: true, stats: alertSvc.getStats() });
  });

  // GET /alerts/active
  router.get('/active',
    auth.authenticate(), auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        res.json({ success: true, alerts: alertSvc.getActiveAlerts(scope) });
      } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    }
  );

  // POST /alerts/scan
  router.post('/scan',
    auth.authenticate(), auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const scope  = await scopeFor(req.user);
        const result = await alertSvc.scan(scope);
        res.json({ success: true, ...result });
      } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    }
  );

  // GET /alerts
  router.get('/',
    auth.authenticate(), auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const filters = {};
        if (req.query.status)   filters.status   = req.query.status;
        if (req.query.type)     filters.type     = req.query.type;
        if (req.query.severity) filters.severity = req.query.severity;
        res.json({ success: true, alerts: alertSvc.getAllAlerts(filters) });
      } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    }
  );

  // GET /alerts/:id
  router.get('/:id', auth.authenticate(), auth.requirePermission('reports:read'), (req, res) => {
    const alert = alertSvc.getAlert(req.params.id);
    if (!alert) return res.status(404).json({ success: false, error: 'ALERT_NOT_FOUND' });
    res.json({ success: true, alert });
  });

  // POST /alerts/:id/acknowledge
  router.post('/:id/acknowledge',
    auth.authenticate(), auth.requirePermission('supply:write'),
    (req, res) => {
      const result = alertSvc.acknowledge(req.params.id, req.user.userId);
      if (!result.success) return res.status(result.error === 'ALERT_NOT_FOUND' ? 404 : 409).json(result);
      res.json(result);
    }
  );

  // POST /alerts/:id/resolve
  router.post('/:id/resolve',
    auth.authenticate(), auth.requirePermission('supply:approve'),
    auth.auditRequest('ALERT_RESOLVE', 'alerts'),
    (req, res) => {
      const result = alertSvc.resolve(req.params.id, req.user.userId, req.body.note || '');
      if (!result.success) return res.status(result.error === 'ALERT_NOT_FOUND' ? 404 : 409).json(result);
      res.json(result);
    }
  );

  // POST /alerts/:id/suppress
  router.post('/:id/suppress',
    auth.authenticate(), auth.requirePermission('supply:approve'),
    auth.auditRequest('ALERT_SUPPRESS', 'alerts'),
    (req, res) => {
      const result = alertSvc.suppress(req.params.id, req.user.userId, req.body.reason || '');
      if (!result.success) return res.status(result.error === 'ALERT_NOT_FOUND' ? 404 : 409).json(result);
      res.json(result);
    }
  );

  return router;
}

module.exports = createAlertRoutes;
