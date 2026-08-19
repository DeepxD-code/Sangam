'use strict';

const express        = require('express');
const AuthService    = require('../services/auth.service');
const AuditLogService = require('../services/audit-log.service');
const AuthMiddleware = require('../middleware/auth.middleware');
const RateLimiter    = require('../services/rate-limiter.service');

/**
 * SANGAM Auth Routes
 *
 *   POST /auth/login           → rate-limited 10/5min per IP
 *   POST /auth/refresh         → rotates refresh token
 *   POST /auth/logout          → revoke one session
 *   POST /auth/logout-all      → revoke all sessions  [authenticated]
 *   POST /auth/change-password → [authenticated]
 *   POST /auth/unlock/:userId  → [users:write]
 *   GET  /auth/me              → current identity [authenticated]
 */
function createAuthRoutes(db, sharedAudit = null) {
  const router  = express.Router();
  const audit   = sharedAudit || new AuditLogService(db);
  const auth    = new AuthMiddleware(db, audit);
  const service = new AuthService(db, audit);
  const limiter = new RateLimiter();

  // ----------------------------------------------------------------
  // Login — rate limited per IP before credentials are checked
  // ----------------------------------------------------------------
  router.post('/login',
    limiter.middleware(10, 5 * 60 * 1000, req => req.ip || 'unknown'),
    async (req, res) => {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({
          success: false, error: 'INVALID_REQUEST',
          message: 'username and password are required'
        });
      }

      try {
        const result = await service.login({ username, password, ipAddress: req.ip });

        if (!result.success) {
          const status = result.error === 'ACCOUNT_LOCKED' ? 423 : 401;
          return res.status(status).json(result);
        }

        res.json(result);
      } catch (err) {
        if (err.message === 'DATABASE_REQUIRED') {
          return res.status(503).json({ success: false, error: 'DATABASE_UNAVAILABLE' });
        }
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Refresh
  // ----------------------------------------------------------------
  router.post('/refresh',
    async (req, res) => {
      const { refreshToken } = req.body || {};
      if (!refreshToken) {
        return res.status(400).json({ success: false, error: 'INVALID_REQUEST', message: 'refreshToken is required' });
      }

      try {
        const result = await service.refresh(refreshToken, req.ip);
        if (!result.success) {
          return res.status(401).json(result);
        }
        res.json(result);
      } catch (err) {
        if (err.message === 'DATABASE_REQUIRED') {
          return res.status(503).json({ success: false, error: 'DATABASE_UNAVAILABLE' });
        }
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Logout (single session)
  // ----------------------------------------------------------------
  router.post('/logout',
    async (req, res) => {
      const { refreshToken } = req.body || {};
      if (!refreshToken) {
        return res.status(400).json({ success: false, error: 'INVALID_REQUEST', message: 'refreshToken is required' });
      }
      try {
        const result = await service.logout(refreshToken);
        res.json(result);
      } catch (err) {
        if (err.message === 'DATABASE_REQUIRED') {
          return res.status(503).json({ success: false, error: 'DATABASE_UNAVAILABLE' });
        }
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Logout (all sessions for current user)
  // ----------------------------------------------------------------
  router.post('/logout-all',
    auth.authenticate(),
    async (req, res) => {
      try {
        const result = await service.logoutAll(req.user.userId);

        await audit.log({
          userId: req.user.userId, username: req.user.username, role: req.user.role,
          unitCode: req.user.unitCode, action: 'LOGOUT', resource: 'auth/logout-all',
          ipAddress: req.ip, success: true
        }).catch(err => console.error('[auth-routes] logout audit error:', err.message));

        res.json(result);
      } catch (err) {
        if (err.message === 'DATABASE_REQUIRED') {
          return res.status(503).json({ success: false, error: 'DATABASE_UNAVAILABLE' });
        }
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Change password
  // ----------------------------------------------------------------
  router.post('/change-password',
    auth.authenticate(),
    async (req, res) => {
      const { oldPassword, newPassword } = req.body || {};
      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          success: false, error: 'INVALID_REQUEST',
          message: 'oldPassword and newPassword are required'
        });
      }

      try {
        const result = await service.changePassword(req.user.userId, oldPassword, newPassword);
        if (!result.success) {
          const status = result.error === 'WEAK_PASSWORD' ? 400 : 401;
          return res.status(status).json(result);
        }
        res.json(result);
      } catch (err) {
        if (err.message === 'DATABASE_REQUIRED') {
          return res.status(503).json({ success: false, error: 'DATABASE_UNAVAILABLE' });
        }
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Admin unlock
  // ----------------------------------------------------------------
  router.post('/unlock/:userId',
    auth.authenticate(),
    auth.requirePermission('users:write'),
    auth.auditRequest('USER_UNLOCK_REQUEST', 'users'),
    async (req, res) => {
      const userId = parseInt(req.params.userId, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ success: false, error: 'INVALID_USER_ID' });
      }
      try {
        const result = await service.unlockAccount(userId, req.user.userId);
        res.json(result);
      } catch (err) {
        if (err.message === 'DATABASE_REQUIRED') {
          return res.status(503).json({ success: false, error: 'DATABASE_UNAVAILABLE' });
        }
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Current identity
  // ----------------------------------------------------------------
  router.get('/me',
    auth.authenticate(),
    (req, res) => {
      res.json({
        success: true,
        user: {
          id: req.user.userId,
          username: req.user.username,
          displayName: req.user.displayName,
          role: req.user.role,
          rankLevel: req.user.roleInfo ? req.user.roleInfo.rankLevel : null,
          unitId: req.user.unitId,
          unitCode: req.user.unitCode
        }
      });
    }
  );

  return router;
}

module.exports = createAuthRoutes;
