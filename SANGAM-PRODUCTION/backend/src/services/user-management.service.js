'use strict';

/**
 * SANGAM User Management Service  (Day 23)
 *
 * Manages Army personnel user accounts within the system.
 *
 * Offline-first: in-memory Map is primary store; DB writes best-effort.
 *
 * Methods:
 *   createUser(params)                    → register a new user account
 *   getUserById(id)                       → single user (no password_hash)
 *   getUserByUsername(username)           → lookup by username
 *   getUsersInScope(scopeUnitIds, filter) → list users in command scope
 *   updateUser(id, updates, actorId)      → change name / email / contact
 *   assignRole(id, role, actorId)         → change user's RBAC role
 *   assignUnit(id, unitId, unitCode, actorId) → move user to different unit
 *   deactivateUser(id, actorId)           → soft-delete / lock account
 *   reactivateUser(id, actorId)           → restore deactivated user
 *   unlockUser(id, actorId)               → clear failed-login lockout
 *   resetPasswordHash(id, hash, actorId)  → set a new bcrypt hash
 *   getUserStats(scopeUnitIds)            → counts by role and unit
 */

const crypto = require('crypto');

// Valid role names come from RBACService.ROLES — we import the keys directly
const VALID_ROLES = [
  'SOLDIER', 'NCO', 'JCO', 'LOGISTICS_OFFICER',
  'OFFICER', 'SENIOR_OFFICER', 'COMMANDER', 'AUDITOR', 'SYSTEM_ADMIN'
];

class UserManagementService {

  /**
   * @param {object} db       - pg Pool (null = offline)
   * @param {object} audit    - AuditLogService instance
   * @param {object} rbac     - RBACService instance
   * @param {object} bcrypt   - bcrypt module (optional; used for hashing in service layer)
   */
  constructor(db, audit = null, rbac = null, bcrypt = null) {
    this.db     = db;
    this.audit  = audit;
    this.rbac   = rbac;
    this.bcrypt = bcrypt;

    this._users  = new Map();   // id → user
    this._nextId = 1;

    this._stats = {
      usersCreated:      0,
      usersDeactivated:  0,
      roleAssignments:   0,
      unitReassignments: 0,
      passwordResets:    0
    };
  }

  // ================================================================
  // 1. CREATE USER
  // ================================================================

  /**
   * @param {object} params
   *   username        {string} required — unique login handle
   *   displayName     {string} required — full name / rank + name
   *   role            {string} required — one of VALID_ROLES
   *   unitId          {number|null}
   *   unitCode        {string|null}
   *   email           {string|null}
   *   passwordHash    {string|null} — pre-hashed password (from auth layer)
   *   serviceNumber   {string|null} — Army service number
   *   createdByUserId {number|null}
   */
  async createUser(params) {
    const {
      username, displayName, role, unitId = null, unitCode = null,
      email = null, passwordHash = null, serviceNumber = null,
      createdByUserId = null
    } = params || {};

    // Required fields
    if (!username || !displayName || !role) {
      return {
        success: false, error: 'MISSING_REQUIRED_FIELDS',
        message: 'username, displayName, role are required'
      };
    }

    // Validate role
    if (!VALID_ROLES.includes(role)) {
      return {
        success: false, error: 'INVALID_ROLE',
        message: `role must be one of: ${VALID_ROLES.join(', ')}`
      };
    }

    // Unique username check
    const existing = [...this._users.values()].find(u => u.username === username);
    if (existing) {
      return { success: false, error: 'USERNAME_EXISTS',
               message: `Username '${username}' is already taken` };
    }

    // Service number uniqueness (if provided)
    if (serviceNumber) {
      const dup = [...this._users.values()].find(u => u.serviceNumber === serviceNumber);
      if (dup) {
        return { success: false, error: 'SERVICE_NUMBER_EXISTS',
                 message: `Service number '${serviceNumber}' already registered` };
      }
    }

    const id  = this._nextId++;
    const now = new Date().toISOString();
    const user = {
      id,
      username,
      displayName,
      role,
      unitId:            unitId   ? parseInt(unitId, 10)   : null,
      unitCode:          unitCode || null,
      email:             email    || null,
      serviceNumber:     serviceNumber || null,
      passwordHash:      passwordHash  || null,
      active:            true,
      accountLocked:     false,
      failedLoginCount:  0,
      lockedUntil:       null,
      lastLogin:         null,
      createdAt:         now,
      updatedAt:         now
    };

    this._users.set(id, user);
    this._stats.usersCreated++;

    await this._audit({
      userId: createdByUserId,
      action: 'USER_CREATE',
      resource: 'users',
      resourceId: String(id),
      details: { username, role, unitId, unitCode },
      success: true
    });

    this._dbWrite(id, user);

    return { success: true, user: this._safeUser(user) };
  }

  // ================================================================
  // 2. GET USER BY ID / USERNAME
  // ================================================================

  getUserById(id) {
    const user = this._users.get(parseInt(id, 10));
    return user ? this._safeUser(user) : null;
  }

  getUserByUsername(username) {
    const user = [...this._users.values()].find(u => u.username === username);
    return user ? this._safeUser(user) : null;
  }

  /** Internal lookup that includes passwordHash (for auth service use only) */
  _getUserRaw(id) {
    return this._users.get(parseInt(id, 10)) || null;
  }

  // ================================================================
  // 3. GET USERS IN SCOPE
  // ================================================================

  /**
   * @param {number[]} scopeUnitIds
   * @param {object}   filters - { role, activeOnly, search, limit, offset }
   */
  getUsersInScope(scopeUnitIds, filters = {}) {
    const { role, activeOnly = true, search, limit = 50, offset = 0, unitId } = filters;

    let users = [...this._users.values()].filter(u =>
      u.unitId !== null && scopeUnitIds.includes(u.unitId));

    if (unitId)     users = users.filter(u => u.unitId === parseInt(unitId, 10));
    if (activeOnly) users = users.filter(u => u.active);
    if (role)       users = users.filter(u => u.role === role);
    if (search) {
      const q = search.toLowerCase();
      users = users.filter(u =>
        u.username.toLowerCase().includes(q)     ||
        u.displayName.toLowerCase().includes(q)  ||
        (u.serviceNumber || '').toLowerCase().includes(q));
    }

    const total = users.length;
    const page  = users
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(offset, offset + limit);

    return {
      users:  page.map(u => this._safeUser(u)),
      total,
      limit,
      offset
    };
  }

  // ================================================================
  // 4. UPDATE USER PROFILE
  // ================================================================

  /**
   * Update mutable profile fields.
   * username, role, unitId, passwordHash require dedicated methods.
   *
   * @param {number|string} id
   * @param {object} updates  - { displayName, email, serviceNumber }
   * @param {number} actorId
   */
  async updateUser(id, updates, actorId = null) {
    const user = this._users.get(parseInt(id, 10));
    if (!user) return { success: false, error: 'USER_NOT_FOUND' };
    if (!user.active) return { success: false, error: 'USER_INACTIVE',
                               message: 'Cannot update a deactivated account' };

    const allowed = ['displayName', 'email', 'serviceNumber'];
    const changes = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) changes[key] = updates[key];
    }
    if (Object.keys(changes).length === 0) {
      return {
        success: false, error: 'NO_UPDATE_FIELDS',
        message: `Updatable fields: ${allowed.join(', ')}`
      };
    }

    // Uniqueness check for serviceNumber
    if (changes.serviceNumber && changes.serviceNumber !== user.serviceNumber) {
      const dup = [...this._users.values()].find(
        u => u.id !== user.id && u.serviceNumber === changes.serviceNumber);
      if (dup) return { success: false, error: 'SERVICE_NUMBER_EXISTS' };
    }

    Object.assign(user, changes, { updatedAt: new Date().toISOString() });
    await this._audit({
      userId: actorId, action: 'USER_UPDATE',
      resource: 'users', resourceId: String(id),
      details: changes, success: true
    });

    return { success: true, user: this._safeUser(user) };
  }

  // ================================================================
  // 5. ASSIGN ROLE
  // ================================================================

  /**
   * Change a user's RBAC role.
   * Requires `users:write` at route level.
   * Actor rank must be ≥ target role's rankLevel (enforced at route).
   */
  async assignRole(id, newRole, actorId = null) {
    if (!VALID_ROLES.includes(newRole)) {
      return { success: false, error: 'INVALID_ROLE',
               message: `role must be one of: ${VALID_ROLES.join(', ')}` };
    }

    const user = this._users.get(parseInt(id, 10));
    if (!user) return { success: false, error: 'USER_NOT_FOUND' };

    const oldRole   = user.role;
    user.role       = newRole;
    user.updatedAt  = new Date().toISOString();
    this._stats.roleAssignments++;

    await this._audit({
      userId: actorId, action: 'USER_ROLE_ASSIGN',
      resource: 'users', resourceId: String(id),
      details: { oldRole, newRole, username: user.username },
      success: true, severity: 'WARNING'
    });

    return { success: true, user: this._safeUser(user) };
  }

  // ================================================================
  // 6. ASSIGN UNIT
  // ================================================================

  async assignUnit(id, unitId, unitCode = null, actorId = null) {
    const user = this._users.get(parseInt(id, 10));
    if (!user) return { success: false, error: 'USER_NOT_FOUND' };

    const oldUnitId      = user.unitId;
    user.unitId          = unitId   ? parseInt(unitId, 10) : null;
    user.unitCode        = unitCode || null;
    user.updatedAt       = new Date().toISOString();
    this._stats.unitReassignments++;

    await this._audit({
      userId: actorId, action: 'USER_UNIT_ASSIGN',
      resource: 'users', resourceId: String(id),
      details: { oldUnitId, newUnitId: user.unitId, username: user.username },
      success: true
    });

    return { success: true, user: this._safeUser(user) };
  }

  // ================================================================
  // 7. DEACTIVATE / REACTIVATE
  // ================================================================

  async deactivateUser(id, actorId = null) {
    const user = this._users.get(parseInt(id, 10));
    if (!user)       return { success: false, error: 'USER_NOT_FOUND' };
    if (!user.active) return { success: false, error: 'ALREADY_INACTIVE' };

    user.active      = false;
    user.updatedAt   = new Date().toISOString();
    this._stats.usersDeactivated++;

    await this._audit({
      userId: actorId, action: 'USER_DEACTIVATE',
      resource: 'users', resourceId: String(id),
      details: { username: user.username, role: user.role },
      success: true, severity: 'WARNING'
    });

    return { success: true, user: this._safeUser(user) };
  }

  async reactivateUser(id, actorId = null) {
    const user = this._users.get(parseInt(id, 10));
    if (!user)       return { success: false, error: 'USER_NOT_FOUND' };
    if (user.active) return { success: false, error: 'ALREADY_ACTIVE' };

    user.active    = true;
    user.updatedAt = new Date().toISOString();

    await this._audit({
      userId: actorId, action: 'USER_REACTIVATE',
      resource: 'users', resourceId: String(id),
      details: { username: user.username }, success: true
    });

    return { success: true, user: this._safeUser(user) };
  }

  // ================================================================
  // 8. UNLOCK USER (clear failed-login lockout)
  // ================================================================

  async unlockUser(id, actorId = null) {
    const user = this._users.get(parseInt(id, 10));
    if (!user) return { success: false, error: 'USER_NOT_FOUND' };

    user.accountLocked    = false;
    user.failedLoginCount = 0;
    user.lockedUntil      = null;
    user.updatedAt        = new Date().toISOString();

    await this._audit({
      userId: actorId, action: 'USER_UNLOCK',
      resource: 'users', resourceId: String(id),
      details: { username: user.username }, success: true
    });

    return { success: true, user: this._safeUser(user) };
  }

  // ================================================================
  // 9. RESET PASSWORD HASH
  // ================================================================

  async resetPasswordHash(id, newHash, actorId = null) {
    if (!newHash || typeof newHash !== 'string') {
      return { success: false, error: 'INVALID_HASH', message: 'newHash is required' };
    }

    const user = this._users.get(parseInt(id, 10));
    if (!user) return { success: false, error: 'USER_NOT_FOUND' };

    user.passwordHash = newHash;
    user.updatedAt    = new Date().toISOString();
    this._stats.passwordResets++;

    await this._audit({
      userId: actorId, action: 'USER_PASSWORD_RESET',
      resource: 'users', resourceId: String(id),
      details: { username: user.username },
      success: true, severity: 'WARNING'
    });

    return { success: true };
  }

  // ================================================================
  // 10. USER STATS
  // ================================================================

  /**
   * Aggregate user counts by role and active state for a scope.
   */
  getUserStats(scopeUnitIds) {
    const users   = [...this._users.values()].filter(
      u => u.unitId !== null && scopeUnitIds.includes(u.unitId));

    const byRole  = {};
    const byUnit  = {};
    let   active  = 0, inactive = 0, locked = 0;

    for (const u of users) {
      byRole[u.role] = (byRole[u.role] || 0) + 1;
      byUnit[u.unitId] = (byUnit[u.unitId] || 0) + 1;
      if (u.active)        active++;
      else                 inactive++;
      if (u.accountLocked) locked++;
    }

    return {
      totalUsers: users.length,
      active, inactive, locked,
      byRole,
      byUnit,
      generatedAt: new Date().toISOString()
    };
  }

  // ================================================================
  // STATIC METADATA
  // ================================================================

  static get VALID_ROLES() { return VALID_ROLES; }

  getStats() {
    return { ...this._stats, totalUsers: this._users.size };
  }

  // ================================================================
  // INTERNALS
  // ================================================================

  /** Strip passwordHash before returning to callers. */
  _safeUser(u) {
    const { passwordHash, ...safe } = u;
    return { ...safe };
  }

  async _audit(entry) {
    if (this.audit) await this.audit.log(entry).catch(err => console.error('[user-management] audit error:', err.message));
  }

  _dbWrite(id, user) {
    if (!this.db) return;
    const q = `
      INSERT INTO users
        (id, username, display_name, email, password_hash, role,
         unit_id, unit_code, active, account_locked,
         failed_login_count, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE
        SET display_name=EXCLUDED.display_name, email=EXCLUDED.email,
            role=EXCLUDED.role, unit_id=EXCLUDED.unit_id,
            unit_code=EXCLUDED.unit_code, active=EXCLUDED.active,
            account_locked=EXCLUDED.account_locked,
            updated_at=EXCLUDED.updated_at
    `;
    this.db.query(q, [
      user.id, user.username, user.displayName, user.email,
      user.passwordHash, user.role, user.unitId, user.unitCode,
      user.active, user.accountLocked, user.failedLoginCount,
      user.createdAt, user.updatedAt
    ]).catch(err => console.error('[user-management] dbWrite error:', err.message));
  }
}

module.exports = UserManagementService;
