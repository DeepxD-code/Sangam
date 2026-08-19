'use strict';

const bcrypt = require('bcrypt');
const AuthMiddleware = require('../middleware/auth.middleware');

const PEPPER = process.env.PASSWORD_PEPPER || 'sangam-pepper-dev-CHANGE-IN-PRODUCTION';

/**
 * SANGAM Auth Service
 *
 * Owns the credential lifecycle: login, refresh-token rotation (with
 * reuse/theft detection), logout, password change, and account lockout.
 *
 * Generates JWTs via AuthMiddleware (Day 13) and, when an AuditLogService
 * is supplied, writes SECURITY-severity entries that automatically surface
 * as Day 11 notifications and Day 12 security-posture counts — see
 * docs/day-14-auth-login.md §5 for the full loop.
 *
 * All methods are DB-required (login/refresh/etc need the users and
 * refresh_tokens tables) — they throw 'DATABASE_REQUIRED' if db is null,
 * matching the explicit-failure style used for write-paths elsewhere
 * (vs. the read-path graceful-degradation used in ReportingService).
 */
class AuthService {

  static BCRYPT_ROUNDS       = 12;
  static MAX_FAILED_ATTEMPTS = 5;
  static LOCKOUT_DURATION_MS = 15 * 60 * 1000;        // 15 minutes
  static REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  /**
   * @param {object} db          - pg Pool
   * @param {object} [auditLog]  - AuditLogService instance (optional but recommended)
   * @param {string} [pepper]    - override PASSWORD_PEPPER (mainly for tests)
   * @param {object} [delegationService] - DelegationService (Day 15, optional).
   *        If provided, locking an account auto-revokes any delegations
   *        that account had granted to others.
   */
  constructor(db, auditLog = null, pepper = PEPPER, delegationService = null) {
    this.db = db;
    this.auditLog = auditLog;
    this.pepper = pepper;
    this.delegationService = delegationService;
  }

  // ============================================================
  // PASSWORD HASHING
  // ============================================================

  /** Hash a plaintext password with bcrypt + server-side pepper. */
  async hashPassword(plaintext) {
    return bcrypt.hash(plaintext + this.pepper, AuthService.BCRYPT_ROUNDS);
  }

  /** Verify a plaintext password against a stored hash. */
  async verifyPassword(plaintext, hash) {
    if (!hash) return false;
    return bcrypt.compare(plaintext + this.pepper, hash);
  }

  /**
   * Check password strength. Returns { valid, issues[] }.
   * Rules: ≥8 chars, ≥1 uppercase, ≥1 lowercase, ≥1 digit.
   */
  validatePasswordStrength(password) {
    const issues = [];
    if (!password || password.length < 8) {
      issues.push('Password must be at least 8 characters');
    }
    if (!/[A-Z]/.test(password || '')) issues.push('Password must contain an uppercase letter');
    if (!/[a-z]/.test(password || '')) issues.push('Password must contain a lowercase letter');
    if (!/[0-9]/.test(password || '')) issues.push('Password must contain a digit');
    return { valid: issues.length === 0, issues };
  }

  // ============================================================
  // LOGIN
  // ============================================================

  /**
   * Authenticate a user. Handles account lockout (with auto-unlock once
   * locked_until elapses) and increments/resets failed_login_count.
   *
   * @param {object} params - { username, password, ipAddress }
   * @returns {object} On success: { success:true, accessToken, refreshToken, user }
   *                    On failure: { success:false, error, message, ... }
   */
  async login({ username, password, ipAddress = null }) {
    this._requireDb();

    const result = await this.db.query(`
      SELECT id, username, password_hash, display_name, role, unit_id, unit_code,
             failed_login_count, account_locked, locked_until
      FROM users WHERE username = $1
    `, [username]);

    if (result.rows.length === 0) {
      await this._auditFailed(null, username, ipAddress, 'USER_NOT_FOUND');
      return this._invalidCredentials();
    }

    let user = result.rows[0];

    // ---- Lockout check (with auto-unlock) ----
    if (user.account_locked) {
      const stillLocked = user.locked_until && new Date(user.locked_until) > new Date();
      if (stillLocked) {
        await this._auditFailed(user.id, username, ipAddress, 'ACCOUNT_LOCKED', user.role, user.unit_code);
        return {
          success: false,
          error:   'ACCOUNT_LOCKED',
          message: 'Account is locked due to repeated failed login attempts',
          lockedUntil: user.locked_until
        };
      }
      // Lock window elapsed — auto-unlock and continue evaluating this attempt
      await this._clearLockout(user.id);
      user = { ...user, account_locked: false, locked_until: null, failed_login_count: 0 };
    }

    // ---- Password check ----
    const validPassword = await this.verifyPassword(password, user.password_hash);

    if (!validPassword) {
      const newCount = (user.failed_login_count || 0) + 1;
      await this.db.query(
        `UPDATE users SET failed_login_count = $1 WHERE id = $2`,
        [newCount, user.id]
      );

      if (newCount >= AuthService.MAX_FAILED_ATTEMPTS) {
        await this._lockAccount(user, ipAddress);
      }

      await this._auditFailed(user.id, username, ipAddress, 'INVALID_PASSWORD', user.role, user.unit_code);

      if (this.auditLog) {
        await this.auditLog.detectSuspiciousActivity(user.id, 5).catch(err => console.error('[auth] detectSuspiciousActivity error:', err.message));
      }

      return this._invalidCredentials();
    }

    // ---- Success ----
    await this.db.query(`
      UPDATE users
      SET failed_login_count = 0, account_locked = false, locked_until = NULL, last_login = NOW()
      WHERE id = $1
    `, [user.id]);

    const tokens = await this._issueTokens(user, ipAddress);

    await this._audit({
      userId: user.id, username: user.username, role: user.role, unitCode: user.unit_code,
      action: 'AUTHENTICATE', resource: 'auth/login', ipAddress, success: true
    });

    return {
      success: true,
      ...tokens,
      user: {
        id: user.id, username: user.username, displayName: user.display_name,
        role: user.role, unitId: user.unit_id, unitCode: user.unit_code
      }
    };
  }

  // ============================================================
  // REFRESH TOKEN ROTATION
  // ============================================================

  /**
   * Exchange a refresh token for a new access+refresh pair. The
   * presented token is revoked (single-use rotation). If a REVOKED
   * token is presented, this is treated as theft: a SECURITY audit
   * event is logged and ALL of the user's refresh tokens are revoked.
   *
   * @param {string} refreshToken
   * @param {string} [ipAddress]
   */
  async refresh(refreshToken, ipAddress = null) {
    this._requireDb();

    const tokenHash = AuthMiddleware.hashRefreshToken(refreshToken);

    const result = await this.db.query(`
      SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked,
             u.username, u.display_name, u.role, u.unit_id, u.unit_code
      FROM   refresh_tokens rt
      JOIN   users u ON u.id = rt.user_id
      WHERE  rt.token_hash = $1
    `, [tokenHash]);

    if (result.rows.length === 0) {
      return { success: false, error: 'INVALID_REFRESH_TOKEN' };
    }

    const row = result.rows[0];

    if (row.revoked) {
      await this._audit({
        userId: row.user_id, username: row.username, role: row.role, unitCode: row.unit_code,
        action: 'SECURITY_ALERT', resource: 'auth/refresh', ipAddress,
        details: { reason: 'Revoked refresh token reuse — possible theft' },
        success: false, severity: 'SECURITY'
      });

      await this.db.query(`UPDATE refresh_tokens SET revoked = true WHERE user_id = $1`, [row.user_id]);

      return {
        success: false,
        error:   'TOKEN_REUSE_DETECTED',
        message: 'This session has been invalidated for security. All sessions have been logged out — please log in again.'
      };
    }

    if (new Date(row.expires_at) <= new Date()) {
      return { success: false, error: 'REFRESH_TOKEN_EXPIRED' };
    }

    // Rotate: revoke the presented token, issue a fresh pair
    await this.db.query(
      `UPDATE refresh_tokens SET revoked = true, last_used_at = NOW() WHERE id = $1`,
      [row.id]
    );

    const tokens = await this._issueTokens({
      id: row.user_id, username: row.username, display_name: row.display_name,
      role: row.role, unit_id: row.unit_id, unit_code: row.unit_code
    }, ipAddress);

    await this._audit({
      userId: row.user_id, username: row.username, role: row.role, unitCode: row.unit_code,
      action: 'TOKEN_REFRESH', resource: 'auth/refresh', ipAddress, success: true
    });

    return { success: true, ...tokens };
  }

  // ============================================================
  // LOGOUT
  // ============================================================

  /** Revoke a single refresh token (one device/session). */
  async logout(refreshToken) {
    this._requireDb();
    const tokenHash = AuthMiddleware.hashRefreshToken(refreshToken);
    await this.db.query(`UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`, [tokenHash]);
    return { success: true };
  }

  /** Revoke every refresh token for a user (all devices/sessions). */
  async logoutAll(userId) {
    this._requireDb();
    await this.db.query(`UPDATE refresh_tokens SET revoked = true WHERE user_id = $1`, [userId]);
    return { success: true };
  }

  // ============================================================
  // PASSWORD MANAGEMENT
  // ============================================================

  /**
   * Change a user's password. Requires the current password.
   * On success, revokes all existing sessions (logoutAll) — a password
   * change should force re-authentication everywhere.
   */
  async changePassword(userId, oldPassword, newPassword) {
    this._requireDb();

    const strength = this.validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return { success: false, error: 'WEAK_PASSWORD', issues: strength.issues };
    }

    const result = await this.db.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    if (result.rows.length === 0) {
      return { success: false, error: 'USER_NOT_FOUND' };
    }

    const valid = await this.verifyPassword(oldPassword, result.rows[0].password_hash);
    if (!valid) {
      return { success: false, error: 'INVALID_CURRENT_PASSWORD' };
    }

    const newHash = await this.hashPassword(newPassword);
    await this.db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);

    await this.logoutAll(userId);

    await this._audit({
      userId, action: 'USER_UPDATE', resource: 'users', resourceId: String(userId),
      details: { change: 'password' }, success: true
    });

    return { success: true };
  }

  // ============================================================
  // ADMIN: UNLOCK ACCOUNT
  // ============================================================

  /**
   * Administratively clear a lockout (e.g. Senior Officer override).
   * @param {number} userId        - account to unlock
   * @param {number} [unlockedBy]  - acting admin's user id, for the audit trail
   */
  async unlockAccount(userId, unlockedBy = null) {
    this._requireDb();
    await this._clearLockout(userId);

    await this._audit({
      userId: unlockedBy, action: 'USER_UNLOCK', resource: 'users',
      resourceId: String(userId), details: { unlockedUserId: userId },
      success: true
    });

    return { success: true };
  }

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  _requireDb() {
    if (!this.db) throw new Error('DATABASE_REQUIRED');
  }

  _invalidCredentials() {
    return { success: false, error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' };
  }

  /** Issue a fresh access+refresh token pair and persist the refresh token hash. */
  async _issueTokens(user, ipAddress) {
    const accessToken  = AuthMiddleware.generateToken(user);
    const refreshToken = AuthMiddleware.generateRefreshToken();
    const tokenHash    = AuthMiddleware.hashRefreshToken(refreshToken);
    const expiresAt    = new Date(Date.now() + AuthService.REFRESH_TOKEN_TTL_MS).toISOString();

    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    return { accessToken, refreshToken, refreshExpiresAt: expiresAt };
  }

  /** Set account_locked=true with a 15-minute expiry, and audit it. */
  async _lockAccount(user, ipAddress) {
    const lockedUntil = new Date(Date.now() + AuthService.LOCKOUT_DURATION_MS).toISOString();

    await this.db.query(
      `UPDATE users SET account_locked = true, locked_until = $1 WHERE id = $2`,
      [lockedUntil, user.id]
    );

    await this._audit({
      userId: user.id, username: user.username, role: user.role, unitCode: user.unit_code,
      action: 'USER_LOCK', resource: 'users', resourceId: String(user.id),
      details: { reason: `${AuthService.MAX_FAILED_ATTEMPTS} consecutive failed login attempts`, lockedUntil },
      ipAddress, success: false, severity: 'SECURITY'
    });

    // Day 15: a locked account can no longer be a trusted source of
    // delegated authority — revoke anything it had granted to others.
    if (this.delegationService) {
      await this.delegationService.revokeAllForUser(
        user.id, null, 'Account locked (brute-force lockout)'
      ).catch(err => console.error('[auth] delegation revocation error:', err.message));
    }
  }

  /** Clear lockout fields and reset the failure counter. */
  async _clearLockout(userId) {
    await this.db.query(`
      UPDATE users
      SET account_locked = false, locked_until = NULL, failed_login_count = 0
      WHERE id = $1
    `, [userId]);
  }

  async _audit(entry) {
    if (this.auditLog) await this.auditLog.log(entry).catch(err => console.error('[auth] audit error:', err.message));
  }

  async _auditFailed(userId, username, ipAddress, reason, role = null, unitCode = null) {
    return this._audit({
      userId, username, role, unitCode,
      action: 'AUTH_FAILED', resource: 'auth/login',
      details: { reason }, ipAddress, success: false
    });
  }
}

module.exports = AuthService;
