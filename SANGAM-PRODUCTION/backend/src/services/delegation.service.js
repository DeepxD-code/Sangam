'use strict';

const RBACService = require('./rbac.service');

/**
 * SANGAM Delegation & Override Service
 *
 * Two narrow, fully-audited escape valves on top of Day 13's static RBAC:
 *
 *   DELEGATION — planned, scoped, time-boxed handoff of a permission
 *                the delegator already holds, to a specific delegate,
 *                for one unit's command tree, for a bounded duration.
 *
 *   OVERRIDE   — emergency, single-use exception: requires a written
 *                justification, is audited as SECURITY *at issuance*
 *                (before use), and sits in a review queue until a
 *                Senior Officer signs off.
 *
 * Neither mechanism lets a role exceed its own ceiling:
 *   - createDelegation() checks the delegator already HAS the permission
 *     (RBACService.hasPermission) before granting it to someone else.
 *   - createOverride() is self-issued but pre-logged (SECURITY severity,
 *     which Day 11 turns into a requiresAck notification immediately)
 *     and post-reviewed.
 *
 * Storage is in-memory (Map) with optional DB persistence, following the
 * same pattern as NotificationService — fully testable without a DB.
 */
class DelegationService {

  static MAX_DELEGATION_HOURS   = 168; // 7 days
  static MIN_REASON_LENGTH      = 5;

  static DEFAULT_OVERRIDE_MINUTES = 30;
  static MAX_OVERRIDE_MINUTES     = 120;
  static MIN_JUSTIFICATION_LENGTH = 10;

  static OVERRIDE_REVIEW_ESCALATION_HOURS = 24;

  /**
   * @param {object} db             - pg Pool (optional — works fully in-memory)
   * @param {RBACService} [rbac]    - reuse an existing instance if available
   * @param {object} [notifications]- NotificationService instance (optional)
   * @param {object} [auditLog]     - AuditLogService instance (optional)
   */
  constructor(db, rbac = null, notifications = null, auditLog = null) {
    this.db            = db;
    this.rbac          = rbac || new RBACService(db);
    this.notifications = notifications;
    this.auditLog      = auditLog;

    this._delegations = new Map(); // id -> delegation
    this._overrides   = new Map(); // id -> override
    this._nextDelegationId = 1;
    this._nextOverrideId   = 1;
  }

  // ============================================================
  // DELEGATIONS
  // ============================================================

  /**
   * Create a time-boxed delegation of one permission to one delegate,
   * scoped to one unit's command tree.
   *
   * @param {object} params
   *   delegatorUserId, delegatorRole, delegateUserId, permission,
   *   unitId, durationHours, reason
   * @returns {object} { success, delegation } or { success:false, error, message }
   */
  async createDelegation({ delegatorUserId, delegatorRole, delegateUserId, permission, unitId, durationHours, reason }) {
    if (!Object.values(RBACService.PERMISSIONS).includes(permission)) {
      return { success: false, error: 'UNKNOWN_PERMISSION', message: `Not a recognised permission: ${permission}` };
    }
    if (!this.rbac.hasPermission(delegatorRole, permission)) {
      return {
        success: false, error: 'DELEGATOR_LACKS_PERMISSION',
        message: `${delegatorRole} does not hold ${permission} — cannot delegate what you don't have`
      };
    }
    if (!durationHours || durationHours <= 0 || durationHours > DelegationService.MAX_DELEGATION_HOURS) {
      return {
        success: false, error: 'INVALID_DURATION',
        message: `durationHours must be between 1 and ${DelegationService.MAX_DELEGATION_HOURS}`
      };
    }
    if (!reason || reason.trim().length < DelegationService.MIN_REASON_LENGTH) {
      return {
        success: false, error: 'REASON_REQUIRED',
        message: `A reason of at least ${DelegationService.MIN_REASON_LENGTH} characters is required`
      };
    }
    if (delegatorUserId === delegateUserId) {
      return { success: false, error: 'CANNOT_DELEGATE_TO_SELF' };
    }

    const now = new Date();
    const delegation = {
      id: this._nextDelegationId++,
      delegatorUserId, delegateUserId, permission, unitId,
      reason: reason.trim(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + durationHours * 3_600_000).toISOString(),
      revokedAt: null,
      revokedBy: null,
      revocationReason: null
    };

    this._delegations.set(delegation.id, delegation);
    if (this.db) this._persistDelegation(delegation).catch(err => console.error('[delegation] persist error:', err.message));

    await this._audit({
      userId: delegatorUserId, action: 'DELEGATION_CREATED', resource: 'delegations',
      resourceId: String(delegation.id),
      details: { delegateUserId, permission, unitId, durationHours, reason: delegation.reason },
      success: true
    });

    if (this.notifications) {
      await this.notifications.create({
        type: 'DELEGATION_GRANTED',
        title: `Delegated authority: ${permission}`,
        message: `You have been granted "${permission}" for unit ${unitId} until ${delegation.expiresAt}. Reason: ${delegation.reason}`,
        targetUserId: delegateUserId,
        resourceType: 'delegation',
        resourceId: delegation.id
      }).catch(err => console.error('[delegation] notify error:', err.message));
    }

    return { success: true, delegation };
  }

  /**
   * Revoke a delegation early.
   * @param {number} delegationId
   * @param {number} revokedByUserId
   * @param {string} [reason]
   */
  async revokeDelegation(delegationId, revokedByUserId, reason = null) {
    const d = this._delegations.get(delegationId);
    if (!d) return { success: false, error: 'DELEGATION_NOT_FOUND' };
    if (d.revokedAt) return { success: false, error: 'ALREADY_REVOKED' };

    d.revokedAt = new Date().toISOString();
    d.revokedBy = revokedByUserId;
    d.revocationReason = reason || null;

    await this._audit({
      userId: revokedByUserId, action: 'DELEGATION_REVOKED', resource: 'delegations',
      resourceId: String(delegationId),
      details: { delegateUserId: d.delegateUserId, permission: d.permission, reason },
      success: true
    });

    if (this.notifications) {
      await this.notifications.create({
        type: 'DELEGATION_GRANTED',
        title: `Delegation revoked: ${d.permission}`,
        message: `Your delegated authority for "${d.permission}" (unit ${d.unitId}) has been revoked.`,
        targetUserId: d.delegateUserId,
        resourceType: 'delegation',
        resourceId: d.id
      }).catch(err => console.error('[delegation] notify error:', err.message));
    }

    return { success: true, delegation: d };
  }

  /**
   * Revoke every still-active delegation GRANTED BY userId.
   * Called automatically by AuthService when an account is locked
   * (Day 14 integration) — a compromised account should not remain a
   * trusted source of delegated authority.
   *
   * @param {number} userId
   * @param {number|null} revokedBy
   * @param {string} reason
   * @returns {{ success: true, revokedCount: number }}
   */
  async revokeAllForUser(userId, revokedBy = null, reason = 'Bulk revocation') {
    let count = 0;
    const now = new Date().toISOString();

    for (const d of this._delegations.values()) {
      if (d.delegatorUserId === userId && !d.revokedAt) {
        d.revokedAt = now;
        d.revokedBy = revokedBy;
        d.revocationReason = reason;
        count++;
      }
    }

    if (count > 0) {
      await this._audit({
        userId: revokedBy, action: 'DELEGATION_REVOKED', resource: 'delegations',
        details: { bulkRevoke: true, delegatorUserId: userId, count, reason },
        success: true
      });
    }

    return { success: true, revokedCount: count };
  }

  /** True if a delegation is currently usable (not revoked, not expired). */
  isDelegationActive(d) {
    return !d.revokedAt && new Date(d.expiresAt).getTime() > Date.now();
  }

  /**
   * Find an active delegation that grants `permission` to `userId` for
   * `unitId`. A delegation scoped to unit U covers U and every
   * descendant of U (Day 13 command scope) — mirroring how the
   * delegator's own authority would have applied.
   *
   * @param {number} userId          - the delegate
   * @param {string} permission
   * @param {number|null} unitId     - target unit; null = permission-only check
   * @returns {Promise<object|null>}
   */
  async findActiveDelegation(userId, permission, unitId) {
    for (const d of this._delegations.values()) {
      if (d.delegateUserId !== userId) continue;
      if (d.permission !== permission) continue;
      if (!this.isDelegationActive(d)) continue;

      if (unitId == null) return d;
      if (d.unitId === unitId) return d;

      const scope = await this.rbac.getCommandScope(d.unitId, this.db);
      if (scope.ids.includes(unitId)) return d;
    }
    return null;
  }

  /** Active delegations where userId is the delegate. */
  getActiveDelegationsFor(userId) {
    return Array.from(this._delegations.values())
      .filter(d => d.delegateUserId === userId && this.isDelegationActive(d));
  }

  /** All delegations (active or not) granted BY userId. */
  getDelegationsGrantedBy(userId) {
    return Array.from(this._delegations.values())
      .filter(d => d.delegatorUserId === userId);
  }

  // ============================================================
  // OVERRIDES
  // ============================================================

  /**
   * Issue a single-use emergency override. Audited as SECURITY severity
   * IMMEDIATELY (before any use) — Day 11's audit hook turns this into
   * a requiresAck SECURITY_ALERT notification right away.
   *
   * @param {object} params - { userId, permission, attemptedUnitId, justification, durationMinutes }
   */
  async createOverride({ userId, permission, attemptedUnitId, justification, durationMinutes }) {
    if (!Object.values(RBACService.PERMISSIONS).includes(permission)) {
      return { success: false, error: 'UNKNOWN_PERMISSION', message: `Not a recognised permission: ${permission}` };
    }

    const trimmed = (justification || '').trim();
    if (trimmed.length < DelegationService.MIN_JUSTIFICATION_LENGTH) {
      return {
        success: false, error: 'JUSTIFICATION_REQUIRED',
        message: `Justification must be at least ${DelegationService.MIN_JUSTIFICATION_LENGTH} characters`
      };
    }

    const minutes = durationMinutes || DelegationService.DEFAULT_OVERRIDE_MINUTES;
    if (minutes <= 0 || minutes > DelegationService.MAX_OVERRIDE_MINUTES) {
      return {
        success: false, error: 'INVALID_DURATION',
        message: `durationMinutes must be between 1 and ${DelegationService.MAX_OVERRIDE_MINUTES}`
      };
    }

    const now = new Date();
    const override = {
      id: this._nextOverrideId++,
      userId, permission, attemptedUnitId,
      justification: trimmed,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
      usedAt: null,
      reviewedAt: null,
      reviewedBy: null
    };

    this._overrides.set(override.id, override);
    if (this.db) this._persistOverride(override).catch(err => console.error('[delegation] persistOverride error:', err.message));

    // Issued BEFORE use — the request itself is the security-relevant event.
    await this._audit({
      userId, action: 'OVERRIDE_ISSUED', resource: 'permission_overrides',
      resourceId: String(override.id),
      details: { permission, attemptedUnitId, justification: trimmed, durationMinutes: minutes },
      success: true,
      severity: 'SECURITY'
    });

    return { success: true, override };
  }

  /** True if an override is still usable (not used, not expired). */
  isOverrideActive(o) {
    return !o.usedAt && new Date(o.expiresAt).getTime() > Date.now();
  }

  /**
   * Find an active override for the exact (userId, permission,
   * attemptedUnitId) triple. Unlike delegations, overrides do NOT
   * extend to descendant units — they are issued for one specific
   * attempted action.
   *
   * @returns {Promise<object|null>}
   */
  async findActiveOverride(userId, permission, unitId) {
    for (const o of this._overrides.values()) {
      if (o.userId !== userId) continue;
      if (o.permission !== permission) continue;
      if (!this.isOverrideActive(o)) continue;
      if (unitId != null && o.attemptedUnitId !== unitId) continue;
      return o;
    }
    return null;
  }

  /**
   * Mark an override as used (single-use enforcement). Audited as
   * OVERRIDE_USED.
   */
  async consumeOverride(overrideId) {
    const o = this._overrides.get(overrideId);
    if (!o) return { success: false, error: 'OVERRIDE_NOT_FOUND' };
    if (o.usedAt) return { success: false, error: 'ALREADY_USED' };

    o.usedAt = new Date().toISOString();

    await this._audit({
      userId: o.userId, action: 'OVERRIDE_USED', resource: 'permission_overrides',
      resourceId: String(overrideId),
      details: { permission: o.permission, attemptedUnitId: o.attemptedUnitId },
      success: true
    });

    return { success: true, override: o };
  }

  /**
   * Senior-Officer sign-off on an issued override. Idempotent guard:
   * an already-reviewed override returns ALREADY_REVIEWED.
   */
  async reviewOverride(overrideId, reviewedByUserId) {
    const o = this._overrides.get(overrideId);
    if (!o) return { success: false, error: 'OVERRIDE_NOT_FOUND' };
    if (o.reviewedAt) return { success: false, error: 'ALREADY_REVIEWED' };

    o.reviewedAt = new Date().toISOString();
    o.reviewedBy = reviewedByUserId;

    await this._audit({
      userId: reviewedByUserId, action: 'OVERRIDE_REVIEWED', resource: 'permission_overrides',
      resourceId: String(overrideId),
      details: { originalUserId: o.userId, permission: o.permission },
      success: true
    });

    return { success: true, override: o };
  }

  /** Every override awaiting review, oldest first. */
  getPendingReviewOverrides() {
    return Array.from(this._overrides.values())
      .filter(o => !o.reviewedAt)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  /** Pending-review overrides older than the escalation window. */
  getOverdueReviews(hours = DelegationService.OVERRIDE_REVIEW_ESCALATION_HOURS) {
    const cutoff = Date.now() - hours * 3_600_000;
    return this.getPendingReviewOverrides()
      .filter(o => new Date(o.createdAt).getTime() < cutoff);
  }

  // ============================================================
  // COMBINED EFFECTIVE-PERMISSION CHECK
  // ============================================================

  /**
   * Determine whether userContext effectively has `permission` for
   * `unitId`, considering: (1) static RBAC role permissions, then
   * (2) active delegations, then (3) active single-use overrides
   * (which, if used to satisfy this check, should be consumed by the
   * caller via consumeOverride()).
   *
   * @param {object} userContext - from RBACService.buildUserContext()
   * @param {string} permission
   * @param {number|null} [unitId]
   * @returns {Promise<{granted:boolean, via?:string, delegation?:object, override?:object}>}
   */
  async hasEffectivePermission(userContext, permission, unitId = null) {
    if (this.rbac.hasPermission(userContext.role, permission)) {
      return { granted: true, via: 'role' };
    }

    const delegation = await this.findActiveDelegation(userContext.userId, permission, unitId);
    if (delegation) return { granted: true, via: 'delegation', delegation };

    const override = await this.findActiveOverride(userContext.userId, permission, unitId);
    if (override) return { granted: true, via: 'override', override };

    return { granted: false };
  }

  // ============================================================
  // STATS
  // ============================================================

  getStats() {
    const delegations = Array.from(this._delegations.values());
    const overrides   = Array.from(this._overrides.values());

    return {
      totalDelegations:  delegations.length,
      activeDelegations: delegations.filter(d => this.isDelegationActive(d)).length,
      totalOverrides:    overrides.length,
      activeOverrides:   overrides.filter(o => this.isOverrideActive(o)).length,
      pendingReview:     overrides.filter(o => !o.reviewedAt).length,
      overdueReview:     this.getOverdueReviews().length
    };
  }

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  async _audit(entry) {
    if (this.auditLog) await this.auditLog.log(entry).catch(err => console.error('[delegation] audit error:', err.message));
  }

  async _persistDelegation(d) {
    if (!this.db) return;
    await this.db.query(`
      INSERT INTO delegations (
        id, delegator_user_id, delegate_user_id, permission, unit_id,
        reason, created_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id) DO NOTHING
    `, [d.id, d.delegatorUserId, d.delegateUserId, d.permission, d.unitId, d.reason, d.createdAt, d.expiresAt]);
  }

  async _persistOverride(o) {
    if (!this.db) return;
    await this.db.query(`
      INSERT INTO permission_overrides (
        id, user_id, permission, attempted_unit_id, justification,
        created_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO NOTHING
    `, [o.id, o.userId, o.permission, o.attemptedUnitId, o.justification, o.createdAt, o.expiresAt]);
  }
}

module.exports = DelegationService;
