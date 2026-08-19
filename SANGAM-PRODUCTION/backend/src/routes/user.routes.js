'use strict';

const express               = require('express');
const UserManagementService = require('../services/user-management.service');
const RBACService           = require('../services/rbac.service');
const AuditLogService       = require('../services/audit-log.service');
const AuthMiddleware        = require('../middleware/auth.middleware');

/**
 * SANGAM User Management Routes  (Day 23)
 *
 *   POST   /users                     → createUser            [users:write]
 *   GET    /users                     → getUsersInScope       [users:read]
 *   GET    /users/roles               → list valid roles      [users:read]
 *   GET    /users/stats               → user stats            [users:read]
 *   GET    /users/:id                 → getUserById           [users:read]
 *   PUT    /users/:id                 → updateUser profile    [users:write]
 *   POST   /users/:id/assign-role     → assignRole            [users:write + rank guard]
 *   POST   /users/:id/assign-unit     → assignUnit            [users:write]
 *   POST   /users/:id/deactivate      → deactivateUser        [users:delete]
 *   POST   /users/:id/reactivate      → reactivateUser        [users:write]
 *   POST   /users/:id/unlock          → unlockUser (lockout)  [users:write]
 *   POST   /users/:id/reset-password  → resetPasswordHash     [users:write]
 */
function createUserRoutes(
  db,
  sharedAudit = null,
  sharedUsers = null   // injection for tests
) {
  const router  = express.Router();
  const audit   = sharedAudit || new AuditLogService(db);
  const auth    = new AuthMiddleware(db, audit);
  const userSvc = sharedUsers || new UserManagementService(db, audit, auth.rbac);

  async function scopeFor(user) {
    // RBACService.getCommandScope returns { ids: number[], codes: string[] }
    // Routes need the plain ids array for .includes() checks.
    const scope = await auth.rbac.getCommandScope(user.unitId, db);
    return scope.ids;
  }

  // ================================================================
  // GET /users/roles  (before /:id to avoid param capture)
  // ================================================================
  router.get('/roles',
    auth.authenticate(),
    auth.requirePermission('users:read'),
    (req, res) => {
      res.json({ success: true, roles: UserManagementService.VALID_ROLES });
    }
  );

  // ================================================================
  // GET /users/stats
  // ================================================================
  router.get('/stats',
    auth.authenticate(),
    auth.requirePermission('users:read'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        res.json({ success: true, stats: userSvc.getUserStats(scope) });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /users
  // ================================================================
  router.post('/',
    auth.authenticate(),
    auth.requirePermission('users:write'),
    auth.auditRequest('USER_CREATE', 'users'),
    async (req, res) => {
      try {
        const { username, displayName, role, unitId, unitCode,
                email, serviceNumber } = req.body;

        if (!username || !displayName || !role) {
          return res.status(400).json({
            success: false, error: 'MISSING_FIELDS',
            message: 'username, displayName, role are required'
          });
        }

        // Rank guard: actor cannot assign a role higher than their own
        const targetRank = RBACService.ROLES[role]?.rankLevel ?? 99;
        if (req.user.rankLevel < targetRank) {
          return res.status(403).json({
            success: false, error: 'RANK_INSUFFICIENT',
            message: `You cannot assign role ${role} (requires rank ≥ ${targetRank})`
          });
        }

        // Scope guard: target unit must be in scope
        if (unitId) {
          const scope = await scopeFor(req.user);
          if (!scope.includes(parseInt(unitId, 10))) {
            return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
          }
        }

        const result = await userSvc.createUser({
          username, displayName, role, unitId, unitCode,
          email, serviceNumber, createdByUserId: req.user.userId
        });

        if (!result.success) {
          const statusMap = {
            USERNAME_EXISTS:       409,
            SERVICE_NUMBER_EXISTS: 409,
            INVALID_ROLE:          400
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
  // GET /users
  // ================================================================
  router.get('/',
    auth.authenticate(),
    auth.requirePermission('users:read'),
    async (req, res) => {
      try {
        const scope   = await scopeFor(req.user);
        const filters = {};
        if (req.query.role)       filters.role       = req.query.role;
        if (req.query.search)     filters.search     = req.query.search;
        if (req.query.activeOnly) filters.activeOnly = req.query.activeOnly !== 'false';
        if (req.query.limit)      filters.limit      = parseInt(req.query.limit, 10);
        if (req.query.offset)     filters.offset     = parseInt(req.query.offset, 10);
        if (req.query.unitId)     filters.unitId     = req.query.unitId;

        // If caller specifies unitId, ensure it's in scope (same guard as supply items)
        if (filters.unitId && !scope.includes(parseInt(filters.unitId, 10))) {
          return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
        }

        const data = userSvc.getUsersInScope(scope, filters);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /users/:id
  // ================================================================
  router.get('/:id',
    auth.authenticate(),
    auth.requirePermission('users:read'),
    async (req, res) => {
      try {
        const user = userSvc.getUserById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });

        // Scope guard: user's unit must be in caller's scope (or self)
        if (user.id !== req.user.userId && user.unitId) {
          const scope = await scopeFor(req.user);
          if (!scope.includes(user.unitId)) {
            return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
          }
        }

        res.json({ success: true, user });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // PUT /users/:id
  // ================================================================
  router.put('/:id',
    auth.authenticate(),
    auth.requirePermission('users:write'),
    auth.auditRequest('USER_UPDATE', 'users'),
    async (req, res) => {
      try {
        const { displayName, email, serviceNumber } = req.body;
        const result = await userSvc.updateUser(
          req.params.id, { displayName, email, serviceNumber }, req.user.userId);

        if (!result.success) {
          const statusMap = { USER_NOT_FOUND: 404, USER_INACTIVE: 409 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /users/:id/assign-role
  // Body: { role }
  // ================================================================
  router.post('/:id/assign-role',
    auth.authenticate(),
    auth.requirePermission('users:write'),
    auth.auditRequest('USER_ROLE_ASSIGN', 'users'),
    async (req, res) => {
      try {
        const { role } = req.body;
        if (!role) {
          return res.status(400).json({ success: false, error: 'MISSING_ROLE' });
        }

        // Rank guard
        const targetRank = RBACService.ROLES[role]?.rankLevel ?? 99;
        if (req.user.rankLevel < targetRank) {
          return res.status(403).json({
            success: false, error: 'RANK_INSUFFICIENT',
            message: `You cannot assign role ${role}`
          });
        }

        const result = await userSvc.assignRole(req.params.id, role, req.user.userId);
        if (!result.success) {
          const statusMap = { USER_NOT_FOUND: 404, INVALID_ROLE: 400 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /users/:id/assign-unit
  // Body: { unitId, unitCode }
  // ================================================================
  router.post('/:id/assign-unit',
    auth.authenticate(),
    auth.requirePermission('users:write'),
    auth.auditRequest('USER_UNIT_ASSIGN', 'users'),
    async (req, res) => {
      try {
        const { unitId, unitCode } = req.body;

        // Scope guard: new unit must be in caller's scope
        if (unitId) {
          const scope = await scopeFor(req.user);
          if (!scope.includes(parseInt(unitId, 10))) {
            return res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
          }
        }

        const result = await userSvc.assignUnit(
          req.params.id, unitId, unitCode, req.user.userId);
        if (!result.success) {
          return res.status(result.error === 'USER_NOT_FOUND' ? 404 : 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /users/:id/deactivate
  // ================================================================
  router.post('/:id/deactivate',
    auth.authenticate(),
    auth.requirePermission('users:delete'),
    auth.auditRequest('USER_DEACTIVATE', 'users'),
    async (req, res) => {
      try {
        const result = await userSvc.deactivateUser(req.params.id, req.user.userId);
        if (!result.success) {
          const statusMap = { USER_NOT_FOUND: 404, ALREADY_INACTIVE: 409 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /users/:id/reactivate
  // ================================================================
  router.post('/:id/reactivate',
    auth.authenticate(),
    auth.requirePermission('users:write'),
    auth.auditRequest('USER_REACTIVATE', 'users'),
    async (req, res) => {
      try {
        const result = await userSvc.reactivateUser(req.params.id, req.user.userId);
        if (!result.success) {
          const statusMap = { USER_NOT_FOUND: 404, ALREADY_ACTIVE: 409 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /users/:id/unlock
  // ================================================================
  router.post('/:id/unlock',
    auth.authenticate(),
    auth.requirePermission('users:write'),
    auth.auditRequest('USER_UNLOCK', 'users'),
    async (req, res) => {
      try {
        const result = await userSvc.unlockUser(req.params.id, req.user.userId);
        if (!result.success) {
          return res.status(result.error === 'USER_NOT_FOUND' ? 404 : 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /users/:id/reset-password
  // Body: { passwordHash }
  // ================================================================
  router.post('/:id/reset-password',
    auth.authenticate(),
    auth.requirePermission('users:write'),
    auth.auditRequest('USER_PASSWORD_RESET', 'users'),
    async (req, res) => {
      try {
        const { passwordHash } = req.body;
        if (!passwordHash) {
          return res.status(400).json({
            success: false, error: 'MISSING_HASH',
            message: 'passwordHash (bcrypt) is required'
          });
        }

        const result = await userSvc.resetPasswordHash(
          req.params.id, passwordHash, req.user.userId);
        if (!result.success) {
          return res.status(result.error === 'USER_NOT_FOUND' ? 404 : 400).json(result);
        }
        res.json({ success: true, message: 'Password hash updated' });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  return router;
}

module.exports = createUserRoutes;
