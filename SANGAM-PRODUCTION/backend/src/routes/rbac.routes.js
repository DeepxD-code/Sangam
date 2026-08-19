'use strict';

const express       = require('express');
const RBACService   = require('../services/rbac.service');
const AuthMiddleware= require('../middleware/auth.middleware');
const AuditLogService = require('../services/audit-log.service');

/**
 * SANGAM RBAC Routes
 *
 * Endpoints:
 *   GET  /rbac/roles                     → list all army roles
 *   GET  /rbac/roles/:roleName           → single role with permissions
 *   GET  /rbac/permissions               → all permission strings  (system:config)
 *   GET  /rbac/my-permissions            → current user's context
 *   GET  /rbac/check/:permission         → permission probe for current user
 *   GET  /rbac/command-scope/:unitId     → subordinate unit IDs
 *   GET  /rbac/audit-logs                → query audit trail  (audit:read)
 *   GET  /rbac/audit-logs/security       → security events only
 *   GET  /rbac/audit-logs/export         → CSV download  (audit:export)
 *   POST /rbac/audit-logs/verify-integrity → hash-chain integrity check
 *   POST /rbac/initialize                → seed DB tables  (system:admin)
 */
function createRBACRoutes(db) {
  const router  = express.Router();
  const rbac    = new RBACService(db);
  const audit   = new AuditLogService(db);
  const auth    = new AuthMiddleware(db, audit);

  // ----------------------------------------------------------------
  // Roles
  // ----------------------------------------------------------------

  router.get('/roles',
    auth.authenticate(),
    auth.requirePermission('users:read'),
    async (req, res) => {
      try {
        const roles = await rbac.getRoles();
        res.json({ success: true, count: roles.length, roles });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  router.get('/roles/:roleName',
    auth.authenticate(),
    auth.requirePermission('users:read'),
    async (req, res) => {
      const info = rbac.getRoleInfo(req.params.roleName.toUpperCase());
      if (!info) {
        return res.status(404).json({ success: false, error: 'Role not found' });
      }
      res.json({
        success: true,
        role:        info,
        permissions: rbac.getRolePermissions(info.name)
      });
    }
  );

  // ----------------------------------------------------------------
  // Permissions
  // ----------------------------------------------------------------

  router.get('/permissions',
    auth.authenticate(),
    auth.requirePermission('system:config'),
    async (req, res) => {
      const permissions = Object.values(RBACService.PERMISSIONS);
      res.json({ success: true, count: permissions.length, permissions });
    }
  );

  // ----------------------------------------------------------------
  // Current-user context
  // ----------------------------------------------------------------

  router.get('/my-permissions',
    auth.authenticate(),
    async (req, res) => {
      res.json({
        success:     true,
        userId:      req.user.userId,
        username:    req.user.username,
        displayName: req.user.displayName,
        role:        req.user.role,
        roleInfo:    req.user.roleInfo,
        unitId:      req.user.unitId,
        unitCode:    req.user.unitCode,
        permissions: req.user.permissions
      });
    }
  );

  // Permission probe — useful for UI to conditionally show controls
  router.get('/check/:permission',
    auth.authenticate(),
    async (req, res) => {
      const { permission } = req.params;
      res.json({
        success:   true,
        permission,
        granted:   req.user.can(permission),
        role:      req.user.role
      });
    }
  );

  // ----------------------------------------------------------------
  // Command scope
  // ----------------------------------------------------------------

  router.get('/command-scope/:unitId',
    auth.authenticate(),
    auth.requirePermission('users:read'),
    async (req, res) => {
      try {
        const unitId = parseInt(req.params.unitId, 10);
        if (isNaN(unitId)) {
          return res.status(400).json({ success: false, error: 'Invalid unitId' });
        }
        const scope = await rbac.getCommandScope(unitId, db);
        res.json({ success: true, unitId, scope });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Audit logs
  // ----------------------------------------------------------------

  router.get('/audit-logs',
    auth.authenticate(),
    auth.requirePermission('audit:read'),
    auth.auditRequest('AUDIT_LOG_ACCESS', 'audit_logs'),
    async (req, res) => {
      try {
        const filters = {
          userId:    req.query.userId    ? parseInt(req.query.userId, 10) : undefined,
          username:  req.query.username,
          action:    req.query.action,
          resource:  req.query.resource,
          success:   req.query.success  !== undefined ? req.query.success === 'true' : undefined,
          severity:  req.query.severity,
          unitCode:  req.query.unitCode,
          startTime: req.query.startTime,
          endTime:   req.query.endTime,
          limit:     req.query.limit  ? parseInt(req.query.limit,  10) : 100,
          offset:    req.query.offset ? parseInt(req.query.offset, 10) : 0
        };
        const result = await audit.query(filters);
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  router.get('/audit-logs/security',
    auth.authenticate(),
    auth.requirePermission('audit:read'),
    async (req, res) => {
      try {
        const hours  = parseInt(req.query.hours || '24', 10);
        const events = await audit.getSecurityEvents(hours);
        res.json({ success: true, hours, count: events.length, events });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  router.get('/audit-logs/export',
    auth.authenticate(),
    auth.requirePermission('audit:export'),
    auth.auditRequest('AUDIT_LOG_EXPORT', 'audit_logs'),
    async (req, res) => {
      try {
        const filters = {
          startTime: req.query.startTime,
          endTime:   req.query.endTime,
          action:    req.query.action,
          success:   req.query.success !== undefined ? req.query.success === 'true' : undefined
        };
        const csv = await audit.exportToCSV(filters);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition',
          `attachment; filename="sangam-audit-${Date.now()}.csv"`);
        res.send(csv);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  router.post('/audit-logs/verify-integrity',
    auth.authenticate(),
    auth.requirePermission('audit:read'),
    async (req, res) => {
      try {
        const result = await audit.verifyIntegrity(
          req.body.startId || null,
          req.body.limit   || 1000
        );
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Admin — seed DB
  // ----------------------------------------------------------------

  router.post('/initialize',
    auth.authenticate(),
    auth.requirePermission('system:admin'),
    async (req, res) => {
      try {
        const result = await rbac.initializeRolesAndPermissions(db);
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  return router;
}

module.exports = createRBACRoutes;
