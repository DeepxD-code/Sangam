'use strict';

const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const RBACService = require('../services/rbac.service');

const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';
const JWT_EXPIRY  = process.env.JWT_EXPIRY  || '8h';   // One operational shift
const REF_EXPIRY  = process.env.REF_EXPIRY  || '30d';  // One month rotation

/**
 * SANGAM Auth Middleware
 *
 * Provides composable Express middleware for:
 *   authenticate()         → JWT validation, attaches req.user
 *   requirePermission()    → RBAC permission check
 *   requireAnyPermission() → RBAC any-permission check
 *   requireRankLevel()     → Minimum Army rank enforcement
 *   requireCommandScope()  → Command hierarchy data scope
 *   auditRequest()         → Tamper-evident access logging
 *
 * Typical route setup:
 *   router.post('/transfer/approve/:id',
 *     auth.authenticate(),
 *     auth.requirePermission('supply:approve'),
 *     auth.requireCommandScope('unitId'),
 *     auth.auditRequest('SUPPLY_APPROVE', 'transfers'),
 *     handler
 *   );
 */
class AuthMiddleware {
  /**
   * @param {object} db             - pg Pool instance
   * @param {object} [auditLog]     - AuditLogService instance (optional)
   */
  /**
   * @param {object} db                 - pg Pool instance
   * @param {object} [auditLog]         - AuditLogService instance (optional)
   * @param {object} [delegationService]- DelegationService instance (Day 15, optional).
   *                                       Enables requirePermissionOrDelegation().
   */
  constructor(db, auditLog = null, delegationService = null) {
    this.db       = db;
    this.rbac     = new RBACService(db);
    this.auditLog = auditLog;
    this.delegationService = delegationService;
  }

  // ============================================================
  // TOKEN EXTRACTION
  // ============================================================

  _extractToken(req) {
    const auth = req.headers && req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
    // WebSocket / EventSource fallback
    if (req.query && req.query.token) return req.query.token;
    return null;
  }

  // ============================================================
  // MIDDLEWARE FACTORY: authenticate()
  // ============================================================

  /**
   * Validate Bearer JWT and attach req.user (UserContext).
   * Must run before any other auth middleware on a route.
   */
  authenticate() {
    return async (req, res, next) => {
      const token = this._extractToken(req);

      if (!token) {
        return res.status(401).json({
          success: false,
          error:   'AUTHENTICATION_REQUIRED',
          message: 'No authentication token provided'
        });
      }

      try {
        const decoded = jwt.verify(token, JWT_SECRET);

        req.user = this.rbac.buildUserContext({
          id:           decoded.userId,
          username:     decoded.username,
          display_name: decoded.displayName,
          role:         decoded.role,
          unit_id:      decoded.unitId,
          unit_code:    decoded.unitCode
        });
        req.token = token;

        // Fire-and-forget auth audit (suppress errors — must not break request)
        if (this.auditLog) {
          this.auditLog.logAccess({
            userId:    decoded.userId,
            username:  decoded.username,
            role:      decoded.role,
            unitCode:  decoded.unitCode,
            action:    'AUTHENTICATE',
            resource:  req.path,
            method:    req.method,
            ipAddress: req.ip || (req.connection && req.connection.remoteAddress),
            success:   true
          }).catch(err => console.error('[auth-middleware] access audit error:', err.message));
        }

        return next();
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            error:   'TOKEN_EXPIRED',
            message: 'Authentication token has expired — please refresh'
          });
        }
        if (err.name === 'JsonWebTokenError') {
          return res.status(401).json({
            success: false,
            error:   'INVALID_TOKEN',
            message: 'Invalid authentication token'
          });
        }
        return res.status(401).json({
          success: false,
          error:   'AUTH_FAILED',
          message: 'Authentication failed'
        });
      }
    };
  }

  // ============================================================
  // MIDDLEWARE FACTORY: requirePermission()
  // ============================================================

  /**
   * Require ALL listed permissions. Call after authenticate().
   *
   * @param {...string} permissions  e.g. 'supply:approve', 'supply:write'
   */
  requirePermission(...permissions) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'AUTHENTICATION_REQUIRED' });
      }

      const missing = permissions.filter(p => !req.user.can(p));

      if (missing.length > 0) {
        this._auditDenial(req, 'AUTHORIZATION_DENIED',
          `Missing permissions: ${missing.join(', ')}`);

        return res.status(403).json({
          success:              false,
          error:                'INSUFFICIENT_PERMISSIONS',
          message:              `This action requires: ${missing.join(', ')}`,
          requiredPermissions:  permissions,
          userRole:             req.user.role
        });
      }

      return next();
    };
  }

  // ============================================================
  // MIDDLEWARE FACTORY: requireAnyPermission()
  // ============================================================

  /**
   * Require AT LEAST ONE of the listed permissions.
   *
   * @param {...string} permissions
   */
  requireAnyPermission(...permissions) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'AUTHENTICATION_REQUIRED' });
      }

      const hasAny = permissions.some(p => req.user.can(p));

      if (!hasAny) {
        this._auditDenial(req, 'AUTHORIZATION_DENIED',
          `Need one of: ${permissions.join(', ')}`);

        return res.status(403).json({
          success:  false,
          error:    'INSUFFICIENT_PERMISSIONS',
          message:  `Requires at least one of: ${permissions.join(', ')}`,
          userRole: req.user.role
        });
      }

      return next();
    };
  }

  // ============================================================
  // MIDDLEWARE FACTORY: requireRankLevel()
  // ============================================================

  /**
   * Enforce a minimum Army rank level (1–10).
   * Useful for operations where a specific rank is required
   * regardless of role-based permissions.
   *
   * @param {number} minLevel
   */
  requireRankLevel(minLevel) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'AUTHENTICATION_REQUIRED' });
      }

      const roleInfo = this.rbac.getRoleInfo(req.user.role);
      const userLevel = roleInfo ? roleInfo.rankLevel : 0;

      if (userLevel < minLevel) {
        return res.status(403).json({
          success:       false,
          error:         'INSUFFICIENT_RANK',
          message:       `This operation requires rank level ${minLevel} or above`,
          userRankLevel: userLevel,
          minRankLevel:  minLevel
        });
      }

      return next();
    };
  }

  // ============================================================
  // MIDDLEWARE FACTORY: requireCommandScope()
  // ============================================================

  /**
   * Enforce command hierarchy scope.
   * Checks that the resource's unit is within the requesting user's
   * command scope (i.e., user's unit or a subordinate unit).
   *
   * SYSTEM_ADMIN and COMMANDER bypass scope checks automatically.
   *
   * @param {string} [unitIdParam='unitId']
   *   The parameter name to extract the target unit ID from.
   *   Checked in req.params, req.body, then req.query — in that order.
   */
  requireCommandScope(unitIdParam = 'unitId') {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'AUTHENTICATION_REQUIRED' });
      }

      // Super-users bypass scope enforcement
      if (req.user.isSuperUser()) return next();

      const rawId = (req.params  && req.params[unitIdParam])
                 || (req.body    && req.body[unitIdParam])
                 || (req.query   && req.query[unitIdParam]);

      const targetUnitId = rawId ? parseInt(rawId, 10) : null;
      if (!targetUnitId || isNaN(targetUnitId)) return next(); // No scope to check

      const inScope = await this.rbac.isInCommandScope(
        req.user.unitId,
        targetUnitId,
        this.db
      );

      if (!inScope) {
        this._auditDenial(req, 'SCOPE_VIOLATION',
          `Unit ${req.user.unitId} has no authority over unit ${targetUnitId}`);

        return res.status(403).json({
          success: false,
          error:   'OUTSIDE_COMMAND_SCOPE',
          message: 'Access denied: resource is outside your command scope'
        });
      }

      return next();
    };
  }

  // ============================================================
  // MIDDLEWARE FACTORY: requirePermissionOrDelegation()  [Day 15]
  // ============================================================

  /**
   * Like requirePermission(), but if the user's static role permission
   * check fails, also checks Day 15's DelegationService for an active
   * delegation or single-use override granting `permission` for the
   * target unit before denying.
   *
   * On success via delegation: req.delegation is set (audit-friendly).
   * On success via override: req.override is set AND the override is
   * immediately consumed (single-use).
   *
   * If no DelegationService was provided to this middleware instance,
   * behaves identically to requirePermission(permission).
   *
   * @param {string} permission
   * @param {string} [unitIdParam='unitId']
   */
  requirePermissionOrDelegation(permission, unitIdParam = 'unitId') {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'AUTHENTICATION_REQUIRED' });
      }

      if (req.user.can(permission)) return next();

      if (this.delegationService) {
        const rawId = (req.params && req.params[unitIdParam])
                   || (req.body   && req.body[unitIdParam])
                   || (req.query  && req.query[unitIdParam]);
        const unitId = rawId ? parseInt(rawId, 10) : req.user.unitId;

        const delegation = await this.delegationService.findActiveDelegation(
          req.user.userId, permission, unitId
        );
        if (delegation) {
          req.delegation = delegation;
          return next();
        }

        const override = await this.delegationService.findActiveOverride(
          req.user.userId, permission, unitId
        );
        if (override) {
          await this.delegationService.consumeOverride(override.id);
          req.override = override;
          return next();
        }
      }

      this._auditDenial(req, 'AUTHORIZATION_DENIED',
        `Missing permission: ${permission} (no active delegation/override)`);

      return res.status(403).json({
        success: false,
        error:   'INSUFFICIENT_PERMISSIONS',
        message: `This action requires: ${permission}`,
        requiredPermissions: [permission],
        userRole: req.user.role
      });
    };
  }

  // ============================================================
  // MIDDLEWARE FACTORY: auditRequest()
  // ============================================================

  /**
   * Wrap a route to write a tamper-evident audit entry for every response.
   * Captures both successful and failed responses.
   *
   * @param {string} action    - Audit action type (e.g. 'SUPPLY_APPROVE')
   * @param {string} resource  - Resource name (e.g. 'transfers')
   */
  auditRequest(action, resource) {
    return (req, res, next) => {
      if (!this.auditLog) return next();

      // Intercept res.end to capture status code after handler runs
      const originalEnd = res.end.bind(res);

      res.end = (...args) => {
        const success = res.statusCode < 400;

        this.auditLog.logAccess({
          userId:     req.user && req.user.userId,
          username:   req.user && req.user.username,
          role:       req.user && req.user.role,
          unitCode:   req.user && req.user.unitCode,
          action:     action || `${req.method}_${resource}`,
          resource:   resource || req.path,
          resourceId: req.params && req.params.id,
          details:    {
            method:     req.method,
            statusCode: res.statusCode,
            query:      req.query
          },
          ipAddress:     req.ip,
          success,
          failureReason: success ? null : `HTTP ${res.statusCode}`
        }).catch(err => console.error('[auth-middleware] response audit error:', err.message));

        originalEnd(...args);
      };

      return next();
    };
  }

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  _auditDenial(req, action, reason) {
    if (!this.auditLog) return;
    this.auditLog.logAccess({
      userId:        req.user && req.user.userId,
      username:      req.user && req.user.username,
      role:          req.user && req.user.role,
      unitCode:      req.user && req.user.unitCode,
      action,
      resource:      req.path,
      method:        req.method,
      ipAddress:     req.ip,
      success:       false,
      failureReason: reason
    }).catch(err => console.error('[auth-middleware] denial audit error:', err.message));
  }

  // ============================================================
  // STATIC TOKEN UTILITIES
  // ============================================================

  /**
   * Generate a signed JWT for a user.
   *
   * @param {object} user
   * @param {string} [expiresIn]  - JWT expiry (default: JWT_EXPIRY env var or '8h')
   * @returns {string} JWT
   */
  static generateToken(user, expiresIn = JWT_EXPIRY) {
    const payload = {
      userId:      user.id,
      username:    user.username,
      displayName: user.display_name || user.displayName,
      role:        user.role,
      unitId:      user.unit_id   || user.unitId,
      unitCode:    user.unit_code || user.unitCode,
      iat:         Math.floor(Date.now() / 1000)
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  }

  /**
   * Generate a cryptographically random refresh token.
   * Store its SHA-256 hash in refresh_tokens table.
   *
   * @returns {string} 128-char hex string
   */
  static generateRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Hash a refresh token for safe DB storage.
   */
  static hashRefreshToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Verify and decode a JWT without middleware.
   * Returns null on any failure.
   *
   * @param {string} token
   * @returns {object|null}
   */
  static decodeToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch {
      return null;
    }
  }

  /**
   * Generate a short-lived, single-operation token.
   * Used to authorise sensitive one-off actions (e.g. bulk delete, approve transfer).
   *
   * @param {number} userId
   * @param {string} operation  - e.g. 'TRANSFER_APPROVE'
   * @param {string} expiresIn  - default 15 minutes
   * @returns {string} JWT
   */
  static generateOperationToken(userId, operation, expiresIn = '15m') {
    return jwt.sign(
      { userId, operation, type: 'OPERATION_TOKEN' },
      JWT_SECRET,
      { expiresIn }
    );
  }

  /**
   * Verify an operation token for a specific operation.
   * Returns false on any mismatch or expiry.
   *
   * @param {string} token
   * @param {string} expectedOperation
   * @returns {boolean}
   */
  static verifyOperationToken(token, expectedOperation) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return decoded.type === 'OPERATION_TOKEN'
          && decoded.operation === expectedOperation;
    } catch {
      return false;
    }
  }
}

module.exports = AuthMiddleware;
