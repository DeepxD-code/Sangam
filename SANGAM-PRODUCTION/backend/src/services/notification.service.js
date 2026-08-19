'use strict';

const EventEmitter = require('events');
const RBACService  = require('./rbac.service');

/**
 * SANGAM Notification & Alert Service
 *
 * Answers, for every system event: "Who needs to know, and how urgently?"
 *
 * Two delivery models:
 *   1. PERSONAL  (targetUserId set)      — direct to one user, bypasses rank/scope
 *   2. SCOPED    (sourceUnitId + minRankLevel) — visible to users whose rank
 *                  meets the threshold AND whose unit commands (or is) sourceUnitId
 *                  (reuses RBACService.isInCommandScope — "escalation visibility")
 *
 * Notifications are never deleted, only marked read/acknowledged per-user —
 * mirroring the immutability philosophy of the Day 13 audit log.
 */
class NotificationService extends EventEmitter {

  // ============================================================
  // NOTIFICATION TYPES
  // ============================================================
  static TYPES = {
    LOW_STOCK:           'LOW_STOCK',
    TRANSFER_PENDING:    'TRANSFER_PENDING',
    TRANSFER_APPROVED:   'TRANSFER_APPROVED',
    TRANSFER_REJECTED:   'TRANSFER_REJECTED',
    MESH_PEER_OFFLINE:   'MESH_PEER_OFFLINE',
    MESH_PEER_ONLINE:    'MESH_PEER_ONLINE',
    SYNC_CONFLICT:       'SYNC_CONFLICT',
    SECURITY_ALERT:      'SECURITY_ALERT',
    BLOCKCHAIN_TAMPER:   'BLOCKCHAIN_TAMPER',
    SYSTEM_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT',
    DELEGATION_GRANTED:  'DELEGATION_GRANTED'
  };

  // ============================================================
  // SEVERITY
  // ============================================================
  static SEVERITY = {
    LOW:      'LOW',
    MEDIUM:   'MEDIUM',
    HIGH:     'HIGH',
    CRITICAL: 'CRITICAL'
  };

  static SEVERITY_WEIGHT = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

  // ============================================================
  // DEFAULTS — severity & minimum rank level per type
  // (rank levels match RBACService.ROLES.*.rankLevel)
  // ============================================================
  static DEFAULT_SEVERITY = {
    LOW_STOCK:           'MEDIUM',
    TRANSFER_PENDING:    'MEDIUM',
    TRANSFER_APPROVED:   'LOW',
    TRANSFER_REJECTED:   'MEDIUM',
    MESH_PEER_OFFLINE:   'HIGH',
    MESH_PEER_ONLINE:    'LOW',
    SYNC_CONFLICT:       'HIGH',
    SECURITY_ALERT:      'HIGH',
    BLOCKCHAIN_TAMPER:   'CRITICAL',
    SYSTEM_ANNOUNCEMENT: 'LOW',
    DELEGATION_GRANTED:  'LOW'
  };

  static MIN_RANK_DEFAULTS = {
    LOW_STOCK:           5,  // JCO+            (company-level decision)
    TRANSFER_PENDING:    6,  // LOGISTICS_OFFICER+ (matches supply:approve)
    TRANSFER_APPROVED:   1,  // personal — rank irrelevant
    TRANSFER_REJECTED:   1,  // personal — rank irrelevant
    MESH_PEER_OFFLINE:   6,  // LOGISTICS_OFFICER+
    MESH_PEER_ONLINE:    6,
    SYNC_CONFLICT:       6,
    SECURITY_ALERT:      8,  // SENIOR_OFFICER+ (matches audit:read)
    BLOCKCHAIN_TAMPER:   8,
    SYSTEM_ANNOUNCEMENT: 1,  // everyone
    DELEGATION_GRANTED:  1   // personal — rank irrelevant
  };

  // Cap on in-memory store to avoid unbounded growth in long demos
  static MAX_STORE = 50_000;

  /**
   * @param {object}      db        - pg Pool (optional — works fully in-memory)
   * @param {RBACService} [rbac]    - reuse an existing instance if available
   * @param {object}      [auditLog] - AuditLogService instance; auto-wires
   *                                    security-alert → notification
   */
  constructor(db, rbac = null, auditLog = null) {
    super();
    this.db   = db;
    this.rbac = rbac || new RBACService(db);

    this._store   = new Map();  // id -> notification
    this._reads   = new Map();  // `${notifId}:${userId}` -> { readAt, acknowledgedAt }
    this._prefs   = new Map();  // `${userId}:${type}` -> boolean (enabled)
    this._streams = new Map();  // userId -> Set<{ userContext, callback }>
    this._nextId  = 1;

    if (auditLog) {
      auditLog.on('security-alert', (entry) => {
        this._onSecurityAlert(entry).catch(err => console.error('[notification] securityAlert error:', err.message));
      });
    }
  }

  // ============================================================
  // CORE: CREATE
  // ============================================================

  /**
   * Create a notification. Applies severity/rank defaults for the type
   * unless explicitly overridden.
   *
   * @param {object} input
   * @returns {object} the stored notification
   */
  async create(input) {
    if (!input || !input.type) {
      throw new Error('INVALID_NOTIFICATION: type is required');
    }
    if (!Object.values(NotificationService.TYPES).includes(input.type)) {
      throw new Error(`INVALID_NOTIFICATION_TYPE: ${input.type}`);
    }
    if (!input.title || !input.message) {
      throw new Error('INVALID_NOTIFICATION: title and message are required');
    }

    const severity = input.severity
      || NotificationService.DEFAULT_SEVERITY[input.type]
      || NotificationService.SEVERITY.MEDIUM;

    if (!Object.values(NotificationService.SEVERITY).includes(severity)) {
      throw new Error(`INVALID_SEVERITY: ${severity}`);
    }

    const minRankLevel = input.minRankLevel !== undefined
      ? input.minRankLevel
      : (NotificationService.MIN_RANK_DEFAULTS[input.type] ?? 1);

    const notification = {
      id:           this._nextId++,
      type:         input.type,
      severity,
      title:        input.title,
      message:      input.message,
      sourceUnitId: input.sourceUnitId ?? null,
      minRankLevel,
      targetUserId: input.targetUserId ?? null,
      targetRole:   input.targetRole   ?? null,
      resourceType: input.resourceType ?? null,
      resourceId:   input.resourceId   ?? null,
      requiresAck:  input.requiresAck !== undefined
        ? Boolean(input.requiresAck)
        : severity === NotificationService.SEVERITY.CRITICAL,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? null
    };

    // Bound memory growth — drop oldest if at capacity
    if (this._store.size >= NotificationService.MAX_STORE) {
      const oldestId = this._store.keys().next().value;
      this._store.delete(oldestId);
    }

    this._store.set(notification.id, notification);

    if (this.db) {
      this._persist(notification).catch(err => console.error('[notification] persist error:', err.message));
    }

    this.emit('notification', notification);
    await this._pushToStreams(notification);

    return notification;
  }

  // ============================================================
  // VISIBILITY
  // ============================================================

  /**
   * Determine whether a notification is visible to the given user.
   *
   * Resolution order:
   *   1. Personal target (targetUserId) — exact match only, all other
   *      checks bypassed.
   *   2. Rank gate — userContext rank must be >= minRankLevel.
   *   3. Role filter (if targetRole set) — exact role match required.
   *   4. Scope — if sourceUnitId set, user's unit must command (or equal)
   *      the source unit (RBACService.isInCommandScope). If sourceUnitId
   *      is null, the notification is Army-wide (subject to rank/role).
   *
   * @param {object} notification
   * @param {object} userContext - from RBACService.buildUserContext()
   * @returns {Promise<boolean>}
   */
  async isVisibleTo(notification, userContext) {
    if (notification.targetUserId !== null) {
      return notification.targetUserId === userContext.userId;
    }

    const userRank = (userContext.roleInfo && userContext.roleInfo.rankLevel) || 0;
    if (userRank < notification.minRankLevel) return false;

    if (notification.targetRole && userContext.role !== notification.targetRole) {
      return false;
    }

    if (notification.sourceUnitId !== null) {
      if (notification.sourceUnitId === userContext.unitId) return true;
      return this.rbac.isInCommandScope(
        userContext.unitId,
        notification.sourceUnitId,
        this.db
      );
    }

    return true; // global notification, rank/role already satisfied
  }

  /**
   * Check whether userId has muted this notification's type.
   * requiresAck notifications IGNORE preferences — cannot be muted.
   */
  _isSuppressedByPreference(notification, userId) {
    if (notification.requiresAck) return false;
    const key = `${userId}:${notification.type}`;
    return this._prefs.get(key) === false;
  }

  // ============================================================
  // QUERYING — PER-USER VIEW
  // ============================================================

  /**
   * Return notifications visible to a user, with per-user read/ack status.
   *
   * @param {object} userContext
   * @param {object} [filters] - { unreadOnly, type, severity, limit, offset }
   * @returns {{ notifications, total, unreadTotal, limit, offset }}
   */
  async getForUser(userContext, filters = {}) {
    const now = Date.now();

    const candidates = Array.from(this._store.values())
      .filter(n => !n.expiresAt || new Date(n.expiresAt).getTime() > now);

    const visible = [];
    for (const n of candidates) {
      if (this._isSuppressedByPreference(n, userContext.userId)) continue;
      if (await this.isVisibleTo(n, userContext)) visible.push(n);
    }

    visible.sort((a, b) => {
      const diff = new Date(b.createdAt) - new Date(a.createdAt);
      return diff !== 0 ? diff : b.id - a.id; // tie-break: higher id = more recent
    });

    const unreadTotal = visible.filter(
      n => !this._isRead(n.id, userContext.userId)
    ).length;

    let result = visible;
    if (filters.unreadOnly) {
      result = result.filter(n => !this._isRead(n.id, userContext.userId));
    }
    if (filters.type) {
      result = result.filter(n => n.type === filters.type);
    }
    if (filters.severity) {
      result = result.filter(n => n.severity === filters.severity);
    }

    const limit  = Math.min(filters.limit || 50, 500);
    const offset = filters.offset || 0;
    const page   = result.slice(offset, offset + limit);

    return {
      notifications: page.map(n => ({
        ...n,
        read:         this._isRead(n.id, userContext.userId),
        acknowledged: this._isAcknowledged(n.id, userContext.userId)
      })),
      total: result.length,
      unreadTotal,
      limit,
      offset
    };
  }

  /** Convenience: just the unread count for a user. */
  async getUnreadCount(userContext) {
    const { unreadTotal } = await this.getForUser(userContext, { limit: 1 });
    return unreadTotal;
  }

  /** Fetch a single notification by ID (no visibility check). */
  getById(id) {
    return this._store.get(id) || null;
  }

  // ============================================================
  // READ / ACKNOWLEDGE
  // ============================================================

  _isRead(notificationId, userId) {
    const r = this._reads.get(`${notificationId}:${userId}`);
    return Boolean(r && r.readAt);
  }

  _isAcknowledged(notificationId, userId) {
    const r = this._reads.get(`${notificationId}:${userId}`);
    return Boolean(r && r.acknowledgedAt);
  }

  /**
   * Mark a notification read for a user. Idempotent.
   */
  markRead(notificationId, userId) {
    if (!this._store.has(notificationId)) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }
    const key = `${notificationId}:${userId}`;
    const existing = this._reads.get(key) || {};
    if (!existing.readAt) {
      existing.readAt = new Date().toISOString();
      this._reads.set(key, existing);
    }
    return { success: true, notificationId, userId, readAt: existing.readAt };
  }

  /**
   * Acknowledge a notification (implies read). Idempotent.
   * Acknowledgement is itself an auditable action — callers should
   * also write an AUDIT_LOG entry (e.g. NOTIFICATION_ACK) for
   * requiresAck notifications.
   */
  acknowledge(notificationId, userId) {
    if (!this._store.has(notificationId)) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }
    const key = `${notificationId}:${userId}`;
    const existing = this._reads.get(key) || {};
    const now = new Date().toISOString();
    if (!existing.readAt) existing.readAt = now;
    existing.acknowledgedAt = now;
    this._reads.set(key, existing);
    return { success: true, notificationId, userId, acknowledgedAt: now };
  }

  /** Mark every currently-visible unread notification as read. */
  async markAllRead(userContext) {
    const { notifications } = await this.getForUser(
      userContext, { unreadOnly: true, limit: 500 }
    );
    notifications.forEach(n => this.markRead(n.id, userContext.userId));
    return { success: true, count: notifications.length };
  }

  // ============================================================
  // PREFERENCES
  // ============================================================

  /** Get all type → enabled mappings for a user (defaults to true). */
  getPreferences(userId) {
    const prefs = {};
    for (const type of Object.values(NotificationService.TYPES)) {
      const key = `${userId}:${type}`;
      prefs[type] = this._prefs.has(key) ? this._prefs.get(key) : true;
    }
    return prefs;
  }

  /** Enable/disable a notification type for a user. */
  setPreference(userId, type, enabled) {
    if (!Object.values(NotificationService.TYPES).includes(type)) {
      throw new Error(`INVALID_NOTIFICATION_TYPE: ${type}`);
    }
    this._prefs.set(`${userId}:${type}`, Boolean(enabled));
    return { userId, type, enabled: Boolean(enabled) };
  }

  // ============================================================
  // DIGEST
  // ============================================================

  /**
   * Summarize a user's visible notifications over a time window.
   *
   * @param {object} userContext
   * @param {number} [hours=24]
   */
  async getDailyDigest(userContext, hours = 24) {
    const since = Date.now() - hours * 3_600_000;
    const { notifications } = await this.getForUser(userContext, { limit: 500 });

    const recent = notifications.filter(n => new Date(n.createdAt).getTime() >= since);

    const bySeverity = {};
    const byType     = {};
    for (const n of recent) {
      bySeverity[n.severity] = (bySeverity[n.severity] || 0) + 1;
      byType[n.type]         = (byType[n.type]         || 0) + 1;
    }

    return {
      windowHours:  hours,
      total:        recent.length,
      unread:       recent.filter(n => !n.read).length,
      pendingAck:   recent.filter(n => n.requiresAck && !n.acknowledged).length,
      bySeverity,
      byType,
      items: recent.slice(0, 10)
    };
  }

  // ============================================================
  // REAL-TIME: SSE SUBSCRIPTIONS
  // ============================================================

  /**
   * Subscribe a connected client to real-time notifications.
   * Returns an unsubscribe function.
   *
   * @param {object}   userContext
   * @param {function} callback - invoked with the notification object
   * @returns {function} unsubscribe
   */
  subscribe(userContext, callback) {
    const userId = userContext.userId;
    if (!this._streams.has(userId)) this._streams.set(userId, new Set());

    const entry = { userContext, callback };
    this._streams.get(userId).add(entry);

    return () => {
      const set = this._streams.get(userId);
      if (set) {
        set.delete(entry);
        if (set.size === 0) this._streams.delete(userId);
      }
    };
  }

  async _pushToStreams(notification) {
    for (const [userId, entries] of this._streams) {
      for (const entry of entries) {
        if (this._isSuppressedByPreference(notification, userId)) continue;
        if (await this.isVisibleTo(notification, entry.userContext)) {
          try { entry.callback(notification); } catch { /* client gone */ }
        }
      }
    }
  }

  /** Current number of live SSE subscriptions. */
  getSubscriberCount() {
    let total = 0;
    for (const set of this._streams.values()) total += set.size;
    return total;
  }

  // ============================================================
  // DOMAIN TRIGGERS — called by other services
  // ============================================================

  /** Supply service: stock fell below threshold. */
  async notifyLowStock({ itemName, currentQty, threshold, unitId, itemId }) {
    return this.create({
      type:    NotificationService.TYPES.LOW_STOCK,
      title:   `Low stock: ${itemName}`,
      message: `${itemName} is at ${currentQty} units (threshold: ${threshold}).`,
      sourceUnitId: unitId,
      resourceType: 'supply_item',
      resourceId:   itemId
    });
  }

  /** Transfer service: a transfer awaits approval at fromUnitId. */
  async notifyTransferPending({ transferId, itemName, quantity, fromUnitId, toUnitId }) {
    return this.create({
      type:    NotificationService.TYPES.TRANSFER_PENDING,
      title:   `Transfer approval needed: ${itemName}`,
      message: `Request to transfer ${quantity}x ${itemName} to unit ${toUnitId} awaits your approval.`,
      sourceUnitId: fromUnitId,
      resourceType: 'transfer',
      resourceId:   transferId
    });
  }

  /** Transfer service: decision made — delivered PERSONALLY to the requester. */
  async notifyTransferDecision({ transferId, itemName, approved, requestedByUserId }) {
    return this.create({
      type: approved
        ? NotificationService.TYPES.TRANSFER_APPROVED
        : NotificationService.TYPES.TRANSFER_REJECTED,
      title:   `Transfer ${approved ? 'approved' : 'rejected'}: ${itemName}`,
      message: `Your transfer request for ${itemName} has been ${approved ? 'approved' : 'rejected'}.`,
      targetUserId: requestedByUserId,
      resourceType: 'transfer',
      resourceId:   transferId
    });
  }

  /** Mesh service (Day 10 integration): peer connectivity changed. */
  async notifyMeshPeerStatus({ peerId, peerName, unitId, online }) {
    return this.create({
      type: online
        ? NotificationService.TYPES.MESH_PEER_ONLINE
        : NotificationService.TYPES.MESH_PEER_OFFLINE,
      title:   `Mesh peer ${online ? 'online' : 'offline'}: ${peerName}`,
      message: `Peer node ${peerName} (${peerId}) is now ${online ? 'reachable' : 'unreachable'}.`,
      sourceUnitId: unitId,
      resourceType: 'mesh_peer',
      resourceId:   peerId
    });
  }

  /** Sync service (Day 10 integration): conflict needs manual review. */
  async notifySyncConflict({ conflictId, resourceType, resourceId, unitId }) {
    return this.create({
      type:    NotificationService.TYPES.SYNC_CONFLICT,
      title:   'Sync conflict detected',
      message: `A conflict was detected syncing ${resourceType} #${resourceId}. Manual review required.`,
      sourceUnitId: unitId,
      resourceType,
      resourceId: conflictId,
      requiresAck: true
    });
  }

  /** Army-wide announcement (defaults global — no unit scoping). */
  async notifySystemAnnouncement({ title, message, minRankLevel = 1, sourceUnitId = null }) {
    return this.create({
      type: NotificationService.TYPES.SYSTEM_ANNOUNCEMENT,
      title,
      message,
      sourceUnitId,
      minRankLevel
    });
  }

  // ============================================================
  // AUDIT LOG INTEGRATION (Day 13)
  // ============================================================

  /**
   * Handler for AuditLogService 'security-alert' events.
   * Auto-creates a SECURITY_ALERT (or BLOCKCHAIN_TAMPER for integrity
   * failures), targeted at Senior Officers / Auditors, always requiring
   * acknowledgement.
   */
  async _onSecurityAlert(entry) {
    const isTamper =
      entry.action === 'BLOCKCHAIN_TAMPER_DETECTED' ||
      (entry.action === 'AUDIT_INTEGRITY_CHECK' && entry.success === false);

    return this.create({
      type: isTamper
        ? NotificationService.TYPES.BLOCKCHAIN_TAMPER
        : NotificationService.TYPES.SECURITY_ALERT,
      severity: entry.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      title: isTamper
        ? 'Audit integrity violation detected'
        : `Security event: ${entry.action}`,
      message: entry.failureReason
        || `${entry.action} — user: ${entry.username || 'unknown'}, resource: ${entry.resource}`,
      sourceUnitId: null, // Army-wide visibility for security events
      resourceType: 'audit_log',
      resourceId:   entry.logHash,
      requiresAck:  true
    });
  }

  // ============================================================
  // MAINTENANCE
  // ============================================================

  /** Remove expired notifications. Returns count removed. */
  pruneExpired() {
    const now = Date.now();
    let removed = 0;
    for (const [id, n] of this._store) {
      if (n.expiresAt && new Date(n.expiresAt).getTime() < now) {
        this._store.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** Service statistics. */
  getStats() {
    return {
      totalCreated:     this._nextId - 1,
      activeCount:      this._store.size,
      streamSubscribers: this.getSubscriberCount()
    };
  }

  // ============================================================
  // PERSISTENCE (DB mode)
  // ============================================================

  async _persist(notification) {
    if (!this.db) return;
    await this.db.query(`
      INSERT INTO notifications (
        id, type, severity, title, message,
        source_unit_id, min_rank_level, target_user_id, target_role,
        resource_type, resource_id, requires_ack, created_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO NOTHING
    `, [
      notification.id, notification.type, notification.severity,
      notification.title, notification.message,
      notification.sourceUnitId, notification.minRankLevel,
      notification.targetUserId, notification.targetRole,
      notification.resourceType, notification.resourceId,
      notification.requiresAck, notification.createdAt, notification.expiresAt
    ]);
  }
}

module.exports = NotificationService;
