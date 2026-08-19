'use strict';

const express               = require('express');
const UnitManagementService = require('../services/unit-management.service');
const AuditLogService       = require('../services/audit-log.service');
const AuthMiddleware        = require('../middleware/auth.middleware');

/**
 * SANGAM Unit Management Routes  (Day 22)
 *
 *   POST   /units                    → createUnit            [units:write]
 *   GET    /units                    → getUnitsInScope       [units:read]
 *   GET    /units/types              → list valid unit types [units:read]
 *   GET    /units/hierarchy          → full tree             [units:read]
 *   GET    /units/:id                → getUnitById           [units:read]
 *   GET    /units/:id/hierarchy      → subtree from unit     [units:read]
 *   GET    /units/:id/stats          → unit statistics       [units:read]
 *   PUT    /units/:id                → updateUnit            [units:write]
 *   POST   /units/:id/deactivate     → deactivateUnit        [units:admin]
 *   POST   /units/:id/reactivate     → reactivateUnit        [units:admin]
 *   POST   /units/:id/reassign       → reassignUnit          [units:admin]
 */
function createUnitRoutes(
  db,
  sharedAudit       = null,
  sharedUnitService = null    // injection for tests
) {
  const router  = express.Router();
  const audit   = sharedAudit || new AuditLogService(db);
  const auth    = new AuthMiddleware(db, audit);
  const unitSvc = sharedUnitService
    || new UnitManagementService(db, audit, auth.rbac);

  // Helper: resolve caller's command scope
  async function scopeFor(user) {
    // RBACService.getCommandScope returns { ids: number[], codes: string[] }
    // Routes need the plain ids array for .includes() checks.
    const scope = await auth.rbac.getCommandScope(user.unitId, db);
    return scope.ids;
  }

  // Helper: scope check — a unit must be in caller's scope
  async function assertInScope(user, id, res) {
    const scope = await scopeFor(user);
    if (!scope.includes(parseInt(id, 10))) {
      res.status(403).json({ success: false, error: 'UNIT_OUT_OF_SCOPE' });
      return false;
    }
    return true;
  }

  // ================================================================
  // GET /units/types
  // ================================================================
  router.get('/types',
    auth.authenticate(),
    auth.requirePermission('units:read'),
    (req, res) => {
      res.json({
        success: true,
        unitTypes: UnitManagementService.UNIT_TYPES
      });
    }
  );

  // ================================================================
  // GET /units/hierarchy  — full tree (scoped)
  // ================================================================
  router.get('/hierarchy',
    auth.authenticate(),
    auth.requirePermission('units:read'),
    async (req, res) => {
      try {
        const scope  = await scopeFor(req.user);
        // Find the topmost unit in scope (root of caller's view)
        const result = unitSvc.getUnitHierarchy(null);
        if (!result.success) return res.status(500).json(result);

        // Filter tree to only include nodes in scope
        const filterTree = (nodes) =>
          nodes
            .filter(n => scope.includes(n.id))
            .map(n => ({ ...n, children: filterTree(n.children || []) }));

        res.json({ success: true, tree: filterTree(result.tree) });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /units
  // ================================================================
  router.post('/',
    auth.authenticate(),
    auth.requirePermission('units:write'),
    auth.auditRequest('UNIT_CREATE', 'command_units'),
    async (req, res) => {
      try {
        const { unitName, unitType, unitCode,
                parentUnitId, commanderId, location } = req.body;

        if (!unitName || !unitType || !unitCode) {
          return res.status(400).json({
            success: false, error: 'MISSING_FIELDS',
            message: 'unitName, unitType, unitCode are required'
          });
        }

        // If parentUnitId provided, caller must have scope over it
        if (parentUnitId) {
          const scope = await scopeFor(req.user);
          if (!scope.includes(parseInt(parentUnitId, 10))) {
            return res.status(403).json({
              success: false, error: 'UNIT_OUT_OF_SCOPE',
              message: 'Parent unit is outside your command scope'
            });
          }
        }

        const result = await unitSvc.createUnit({
          unitName, unitType, unitCode, parentUnitId,
          commanderId, location,
          createdByUserId: req.user.userId
        });

        if (!result.success) {
          const statusMap = {
            UNIT_CODE_EXISTS:  409,
            INVALID_UNIT_TYPE: 400,
            PARENT_NOT_FOUND:  404,
            PARENT_INACTIVE:   409,
            INVALID_HIERARCHY: 400
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
  // GET /units
  // ================================================================
  router.get('/',
    auth.authenticate(),
    auth.requirePermission('units:read'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        const filters = {};
        if (req.query.unitType)   filters.unitType   = req.query.unitType;
        if (req.query.search)     filters.search     = req.query.search;
        if (req.query.activeOnly) filters.activeOnly = req.query.activeOnly !== 'false';

        const { units, total } = unitSvc.getUnitsInScope(scope, filters);
        res.json({ success: true, units, total });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /units/:id
  // ================================================================
  router.get('/:id',
    auth.authenticate(),
    auth.requirePermission('units:read'),
    async (req, res) => {
      try {
        if (!(await assertInScope(req.user, req.params.id, res))) return;
        const unit = unitSvc.getUnitById(req.params.id);
        if (!unit) return res.status(404).json({ success: false, error: 'UNIT_NOT_FOUND' });
        res.json({ success: true, unit });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /units/:id/hierarchy
  // ================================================================
  router.get('/:id/hierarchy',
    auth.authenticate(),
    auth.requirePermission('units:read'),
    async (req, res) => {
      try {
        if (!(await assertInScope(req.user, req.params.id, res))) return;
        const result = unitSvc.getUnitHierarchy(req.params.id);
        if (!result.success) {
          return res.status(404).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /units/:id/stats
  // ================================================================
  router.get('/:id/stats',
    auth.authenticate(),
    auth.requirePermission('units:read'),
    async (req, res) => {
      try {
        if (!(await assertInScope(req.user, req.params.id, res))) return;
        const stats = unitSvc.getUnitStats(req.params.id);
        if (!stats) return res.status(404).json({ success: false, error: 'UNIT_NOT_FOUND' });
        res.json({ success: true, stats });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // PUT /units/:id
  // ================================================================
  router.put('/:id',
    auth.authenticate(),
    auth.requirePermission('units:write'),
    auth.auditRequest('UNIT_UPDATE', 'command_units'),
    async (req, res) => {
      try {
        if (!(await assertInScope(req.user, req.params.id, res))) return;

        const { unitName, location, commanderId } = req.body;
        const result = await unitSvc.updateUnit(
          req.params.id,
          { unitName, location, commanderId },
          req.user.userId
        );

        if (!result.success) {
          const statusMap = { UNIT_NOT_FOUND: 404, UNIT_INACTIVE: 409 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /units/:id/deactivate
  // ================================================================
  router.post('/:id/deactivate',
    auth.authenticate(),
    auth.requirePermission('units:admin'),
    auth.auditRequest('UNIT_DEACTIVATE', 'command_units'),
    async (req, res) => {
      try {
        if (!(await assertInScope(req.user, req.params.id, res))) return;
        const result = await unitSvc.deactivateUnit(req.params.id, req.user.userId);
        if (!result.success) {
          const statusMap = {
            UNIT_NOT_FOUND:      404,
            ALREADY_INACTIVE:    409,
            HAS_ACTIVE_CHILDREN: 409
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
  // POST /units/:id/reactivate
  // ================================================================
  router.post('/:id/reactivate',
    auth.authenticate(),
    auth.requirePermission('units:admin'),
    auth.auditRequest('UNIT_REACTIVATE', 'command_units'),
    async (req, res) => {
      try {
        if (!(await assertInScope(req.user, req.params.id, res))) return;
        const result = await unitSvc.reactivateUnit(req.params.id, req.user.userId);
        if (!result.success) {
          const statusMap = { UNIT_NOT_FOUND: 404, ALREADY_ACTIVE: 409 };
          return res.status(statusMap[result.error] || 400).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // POST /units/:id/reassign
  // Body: { newParentId }
  // ================================================================
  router.post('/:id/reassign',
    auth.authenticate(),
    auth.requirePermission('units:admin'),
    auth.auditRequest('UNIT_REASSIGN', 'command_units'),
    async (req, res) => {
      try {
        if (!(await assertInScope(req.user, req.params.id, res))) return;

        const { newParentId = null } = req.body;

        // If new parent given, must be in scope
        if (newParentId !== null) {
          const scope = await scopeFor(req.user);
          if (!scope.includes(parseInt(newParentId, 10))) {
            return res.status(403).json({
              success: false, error: 'UNIT_OUT_OF_SCOPE',
              message: 'New parent unit is outside your command scope'
            });
          }
        }

        const result = await unitSvc.reassignUnit(
          req.params.id, newParentId, req.user.userId);

        if (!result.success) {
          const statusMap = {
            UNIT_NOT_FOUND:    404,
            PARENT_NOT_FOUND:  404,
            PARENT_INACTIVE:   409,
            INVALID_HIERARCHY: 400,
            CYCLE_DETECTED:    409
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

module.exports = createUnitRoutes;
