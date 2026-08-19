'use strict';

const express           = require('express');
const DelegationService = require('../services/delegation.service');
const NotificationService = require('../services/notification.service');
const AuditLogService   = require('../services/audit-log.service');
const AuthMiddleware    = require('../middleware/auth.middleware');
const RateLimiter       = require('../services/rate-limiter.service');

/**
 * SANGAM Delegation & Override Routes
 *
 *   POST /delegation                       → create delegation (caller must hold the permission)
 *   GET  /delegation/mine                  → active delegations where I'm the delegate
 *   GET  /delegation/granted               → delegations I've granted (any status)
 *   POST /delegation/:id/revoke            → revoke (delegator or users:write)
 *
 *   POST /delegation/overrides             → issue emergency override (any authenticated user)
 *   GET  /delegation/overrides/pending-review → [audit:read]
 *   POST /delegation/overrides/:id/review  → [audit:read]
 *
 *   GET  /delegation/stats                 → [reports:read]
 */
function createDelegationRoutes(db, sharedAudit = null, sharedNotifications = null) {
  const router = express.Router();
  const audit  = sharedAudit || new AuditLogService(db);
  const auth   = new AuthMiddleware(db, audit);
  const notifications = sharedNotifications || new NotificationService(db, auth.rbac, audit);
  const delegation = new DelegationService(db, auth.rbac, notifications, audit);
  const limiter = new RateLimiter();

  // Emergency overrides are meant to be rare — a genuine "break glass"
  // path, not routine. 5 per hour per user is generous for any real
  // emergency while making scripted abuse or probing impractical (each
  // attempt is also logged as a SECURITY audit event regardless, but
  // rate limiting stops the noise before it's created, not just after).
  const overrideLimit = () => limiter.middleware(5, 60 * 60 * 1000, req => req.user?.userId ? `user:${req.user.userId}` : req.ip);

  // Wire the delegation service into auth middleware for
  // requirePermissionOrDelegation() on other route files that share
  // this AuthMiddleware instance is out of scope here (each route file
  // builds its own AuthMiddleware) — but this router's OWN auth instance
  // gets it, demonstrating the pattern.
  auth.delegationService = delegation;

  // ----------------------------------------------------------------
  // Create delegation
  // ----------------------------------------------------------------
  router.post('/',
    auth.authenticate(),
    async (req, res) => {
      const { delegateUserId, permission, unitId, durationHours, reason } = req.body || {};

      if (!delegateUserId || !permission || !unitId || !durationHours || !reason) {
        return res.status(400).json({
          success: false, error: 'INVALID_REQUEST',
          message: 'delegateUserId, permission, unitId, durationHours, and reason are required'
        });
      }

      try {
        const result = await delegation.createDelegation({
          delegatorUserId: req.user.userId,
          delegatorRole:   req.user.role,
          delegateUserId:  parseInt(delegateUserId, 10),
          permission,
          unitId: parseInt(unitId, 10),
          durationHours: Number(durationHours),
          reason
        });

        if (!result.success) {
          return res.status(400).json(result);
        }
        res.status(201).json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // My active delegations (as delegate)
  // ----------------------------------------------------------------
  router.get('/mine',
    auth.authenticate(),
    (req, res) => {
      const active = delegation.getActiveDelegationsFor(req.user.userId);
      res.json({ success: true, count: active.length, delegations: active });
    }
  );

  // ----------------------------------------------------------------
  // Delegations I've granted
  // ----------------------------------------------------------------
  router.get('/granted',
    auth.authenticate(),
    (req, res) => {
      const granted = delegation.getDelegationsGrantedBy(req.user.userId);
      res.json({ success: true, count: granted.length, delegations: granted });
    }
  );

  // ----------------------------------------------------------------
  // Revoke a delegation
  // ----------------------------------------------------------------
  router.post('/:id/revoke',
    auth.authenticate(),
    auth.auditRequest('DELEGATION_REVOKE_REQUEST', 'delegations'),
    async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'INVALID_ID' });

      const existing = delegation._delegations.get(id);
      if (!existing) return res.status(404).json({ success: false, error: 'DELEGATION_NOT_FOUND' });

      const isOwner = existing.delegatorUserId === req.user.userId;
      if (!isOwner && !req.user.can('users:write')) {
        return res.status(403).json({
          success: false, error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Only the delegator or a user with users:write may revoke this delegation'
        });
      }

      const result = await delegation.revokeDelegation(id, req.user.userId, req.body && req.body.reason);
      if (!result.success) return res.status(400).json(result);
      res.json(result);
    }
  );

  // ----------------------------------------------------------------
  // Create emergency override (any authenticated user)
  // ----------------------------------------------------------------
  router.post('/overrides',
    auth.authenticate(),
    overrideLimit(),
    async (req, res) => {
      const { permission, attemptedUnitId, justification, durationMinutes } = req.body || {};

      if (!permission || !justification) {
        return res.status(400).json({
          success: false, error: 'INVALID_REQUEST',
          message: 'permission and justification are required'
        });
      }

      try {
        const result = await delegation.createOverride({
          userId: req.user.userId,
          permission,
          attemptedUnitId: attemptedUnitId !== undefined ? parseInt(attemptedUnitId, 10) : null,
          justification,
          durationMinutes: durationMinutes ? Number(durationMinutes) : undefined
        });

        if (!result.success) return res.status(400).json(result);
        res.status(201).json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Pending review queue
  // ----------------------------------------------------------------
  router.get('/overrides/pending-review',
    auth.authenticate(),
    auth.requirePermission('audit:read'),
    (req, res) => {
      const pending = delegation.getPendingReviewOverrides();
      const overdue = delegation.getOverdueReviews();
      res.json({
        success: true,
        count: pending.length,
        overdueCount: overdue.length,
        overrides: pending
      });
    }
  );

  // ----------------------------------------------------------------
  // Review an override
  // ----------------------------------------------------------------
  router.post('/overrides/:id/review',
    auth.authenticate(),
    auth.requirePermission('audit:read'),
    auth.auditRequest('OVERRIDE_REVIEW_REQUEST', 'permission_overrides'),
    async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'INVALID_ID' });

      const result = await delegation.reviewOverride(id, req.user.userId);
      if (!result.success) return res.status(400).json(result);
      res.json(result);
    }
  );

  // ----------------------------------------------------------------
  // Stats
  // ----------------------------------------------------------------
  router.get('/stats',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    (req, res) => {
      res.json({ success: true, ...delegation.getStats() });
    }
  );

  return router;
}

module.exports = createDelegationRoutes;
