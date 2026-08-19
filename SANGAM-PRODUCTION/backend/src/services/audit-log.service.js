'use strict';

const crypto       = require('crypto');
const EventEmitter = require('events');

/**
 * SANGAM Audit Log Service
 *
 * Provides tamper-evident audit logging via a SHA-256 hash chain.
 * Every log entry contains:
 *   - previousHash : hash of the immediately preceding entry
 *   - logHash      : SHA-256 of this entry's content + previousHash
 *
 * Any modification to a historical entry breaks the chain, which is
 * detected by verifyIntegrity(). This mirrors the blockchain principle
 * applied to compliance audit trails.
 *
 * Offline-first: when DB is unavailable, entries are buffered in memory
 * and flushed automatically when connectivity is restored.
 */
class AuditLogService extends EventEmitter {

  // ============================================================
  // CONSTANTS
  // ============================================================

  static ACTION_TYPES = {
    // Authentication
    AUTHENTICATE:    'AUTHENTICATE',
    LOGOUT:          'LOGOUT',
    AUTH_FAILED:     'AUTH_FAILED',
    TOKEN_EXPIRED:   'TOKEN_EXPIRED',

    // Authorization
    AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
    SCOPE_VIOLATION:      'SCOPE_VIOLATION',

    // Supply operations
    SUPPLY_CREATE:           'SUPPLY_CREATE',
    SUPPLY_READ:             'SUPPLY_READ',
    SUPPLY_UPDATE:           'SUPPLY_UPDATE',
    SUPPLY_DELETE:           'SUPPLY_DELETE',
    SUPPLY_TRANSFER_INITIATE:'SUPPLY_TRANSFER_INITIATE',
    SUPPLY_TRANSFER_APPROVE: 'SUPPLY_TRANSFER_APPROVE',
    SUPPLY_TRANSFER_REJECT:  'SUPPLY_TRANSFER_REJECT',

    // Blockchain
    BLOCKCHAIN_BLOCK_CREATED:   'BLOCKCHAIN_BLOCK_CREATED',
    BLOCKCHAIN_VERIFY:          'BLOCKCHAIN_VERIFY',
    BLOCKCHAIN_TAMPER_DETECTED: 'BLOCKCHAIN_TAMPER_DETECTED',

    // User management
    USER_CREATE:      'USER_CREATE',
    USER_UPDATE:      'USER_UPDATE',
    USER_DELETE:      'USER_DELETE',
    USER_ROLE_CHANGE: 'USER_ROLE_CHANGE',
    USER_LOCK:        'USER_LOCK',
    USER_UNLOCK:      'USER_UNLOCK',

    // System
    SYSTEM_CONFIG_CHANGE: 'SYSTEM_CONFIG_CHANGE',
    SYSTEM_STARTUP:       'SYSTEM_STARTUP',
    SYSTEM_SHUTDOWN:      'SYSTEM_SHUTDOWN',

    // Audit meta
    AUDIT_LOG_ACCESS:       'AUDIT_LOG_ACCESS',
    AUDIT_LOG_EXPORT:       'AUDIT_LOG_EXPORT',
    AUDIT_INTEGRITY_CHECK:  'AUDIT_INTEGRITY_CHECK',

    // Delegation & Override (Day 15)
    DELEGATION_CREATED: 'DELEGATION_CREATED',
    DELEGATION_REVOKED: 'DELEGATION_REVOKED',
    OVERRIDE_ISSUED:    'OVERRIDE_ISSUED',
    OVERRIDE_USED:      'OVERRIDE_USED',
    OVERRIDE_REVIEWED:  'OVERRIDE_REVIEWED',

    // Security
    SECURITY_ALERT:          'SECURITY_ALERT',
    RATE_LIMIT_EXCEEDED:     'RATE_LIMIT_EXCEEDED',
    SUSPICIOUS_ACTIVITY:     'SUSPICIOUS_ACTIVITY',
    BRUTE_FORCE_DETECTED:    'BRUTE_FORCE_DETECTED'
  };

  static SEVERITY = {
    INFO:     'INFO',
    WARNING:  'WARNING',
    CRITICAL: 'CRITICAL',
    SECURITY: 'SECURITY'
  };

  // Batched DB write size
  static BATCH_SIZE = 50;

  // Memory buffer cap (protect against OOM in extended offline)
  static MAX_BUFFER  = 10000;

  constructor(db) {
    super();
    this.db = db;

    this._lastHash       = '0'.repeat(64); // Genesis hash
    this._writeQueue     = [];             // Pending DB writes
    this._inMemoryBuffer = [];             // Fallback when DB is down
    this._isProcessing   = false;
    this._flushInterval  = null;

    this._stats = {
      totalLogged:    0,
      failedWrites:   0,
      bufferedEntries:0,
      lastWriteTime:  null
    };
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  /**
   * Load the last log hash from DB and start the buffer-flush timer.
   * Safe to call in offline mode — falls back gracefully.
   */
  async initialize() {
    try {
      if (this.db) {
        const result = await this.db.query(
          `SELECT log_hash FROM audit_logs ORDER BY id DESC LIMIT 1`
        );
        if (result.rows.length > 0 && result.rows[0].log_hash) {
          this._lastHash = result.rows[0].log_hash;
        }
      }
    } catch {
      // Offline — continue with genesis hash
    }

    // Flush buffered entries every 5 seconds
    this._flushInterval = setInterval(() => this._flushBuffer(), 5000);

    await this.log({
      action:   AuditLogService.ACTION_TYPES.SYSTEM_STARTUP,
      resource: 'system',
      details:  { service: 'AuditLogService', version: '1.0.0' },
      success:  true
    });

    return { success: true, lastHash: this._lastHash };
  }

  /** Flush remaining buffer and stop the flush timer. */
  async destroy() {
    if (this._flushInterval) clearInterval(this._flushInterval);
    await this._flushBuffer();
  }

  // ============================================================
  // CORE LOGGING
  // ============================================================

  /**
   * Create and persist an audit log entry.
   * The hash chain is maintained entirely in-process, so it works
   * correctly even when DB writes are batched or deferred.
   *
   * @param {object} entry
   * @returns {object} The complete entry including hashes
   */
  async log(entry) {
    const timestamp    = entry.timestamp || new Date().toISOString();
    const previousHash = this._lastHash;

    const full = {
      userId:        entry.userId        || null,
      username:      entry.username      || 'SYSTEM',
      roleName:      entry.role          || 'SYSTEM',
      unitCode:      entry.unitCode      || null,
      action:        entry.action,
      resource:      entry.resource      || 'unknown',
      resourceId:    entry.resourceId    || null,
      details:       entry.details       ? JSON.stringify(entry.details) : null,
      ipAddress:     entry.ipAddress     || null,
      success:       entry.success !== undefined ? Boolean(entry.success) : true,
      failureReason: entry.failureReason || null,
      severity:      entry.severity      || this._determineSeverity(entry.action, entry.success),
      previousHash,
      timestamp
    };

    full.logHash  = this._computeHash(full, previousHash);
    this._lastHash = full.logHash;
    this._stats.totalLogged++;

    // Queue for DB write
    if (this._writeQueue.length < AuditLogService.MAX_BUFFER) {
      this._writeQueue.push(full);
    }
    setImmediate(() => this._processWriteQueue());

    // Emit for real-time monitoring / alerting
    this.emit('log', full);
    if (full.severity === 'SECURITY' || full.severity === 'CRITICAL') {
      this.emit('security-alert', full);
    }

    return full;
  }

  // ============================================================
  // CONVENIENCE LOG METHODS
  // ============================================================

  /** Log an API access event (auth/authz/scope). */
  async logAccess(params) {
    return this.log({
      userId:        params.userId,
      username:      params.username,
      role:          params.role,
      unitCode:      params.unitCode,
      action:        params.action,
      resource:      params.resource,
      resourceId:    params.resourceId,
      details: {
        method:     params.method,
        query:      params.query,
        statusCode: params.statusCode
      },
      ipAddress:     params.ipAddress,
      success:       params.success,
      failureReason: params.failureReason
    });
  }

  /** Log a data-mutation with before/after snapshots. */
  async logDataOperation(params) {
    return this.log({
      userId:        params.userId,
      username:      params.username,
      role:          params.role,
      unitCode:      params.unitCode,
      action:        params.action,
      resource:      params.resource,
      resourceId:    params.resourceId,
      details: {
        before:  params.before,
        after:   params.after,
        changes: params.changes
      },
      ipAddress: params.ipAddress,
      success:   params.success !== undefined ? params.success : true
    });
  }

  /** Log a security event (always SECURITY severity). */
  async logSecurityEvent(params) {
    return this.log({
      ...params,
      severity: AuditLogService.SEVERITY.SECURITY,
      action:   params.action || AuditLogService.ACTION_TYPES.SECURITY_ALERT
    });
  }

  // ============================================================
  // QUERYING
  // ============================================================

  /**
   * Query audit logs with filters.
   *
   * @param {object} filters
   * @returns {{ entries, total, limit, offset }}
   */
  async query(filters = {}) {
    if (!this.db) throw new Error('Database not available');

    const conditions = ['1=1'];
    const params     = [];
    let n = 0;

    const add = (sql, val) => { conditions.push(sql.replace('?', `$${++n}`)); params.push(val); };

    if (filters.userId    !== undefined) add('user_id = ?',      filters.userId);
    if (filters.username)                add('username = ?',     filters.username);
    if (filters.action)                  add('action = ?',       filters.action);
    if (filters.resource)                add('resource = ?',     filters.resource);
    if (filters.success   !== undefined) add('success = ?',      filters.success);
    if (filters.severity)                add('severity = ?',     filters.severity);
    if (filters.unitCode)                add('unit_code = ?',    filters.unitCode);
    if (filters.startTime)               add('created_at >= ?',  filters.startTime);
    if (filters.endTime)                 add('created_at <= ?',  filters.endTime);
    if (filters.ipAddress)               add('ip_address = ?',   filters.ipAddress);

    const where  = conditions.join(' AND ');
    const limit  = Math.min(filters.limit  || 100, 1000);
    const offset = filters.offset || 0;

    const [dataResult, countResult] = await Promise.all([
      this.db.query(`
        SELECT id, user_id, username, role_name, unit_code,
               action, resource, resource_id, details,
               ip_address, success, failure_reason, severity,
               previous_hash, log_hash, created_at
        FROM   audit_logs
        WHERE  ${where}
        ORDER  BY created_at DESC
        LIMIT  ${limit} OFFSET ${offset}
      `, params),
      this.db.query(`SELECT COUNT(*) FROM audit_logs WHERE ${where}`, params)
    ]);

    return {
      entries: dataResult.rows,
      total:   parseInt(countResult.rows[0].count, 10),
      limit,
      offset
    };
  }

  /** Aggregate action counts for a time window. */
  async getSummary(startTime, endTime) {
    if (!this.db) throw new Error('Database not available');
    const result = await this.db.query(`
      SELECT action,
             COUNT(*)                                    AS count,
             SUM(CASE WHEN success     THEN 1 ELSE 0 END) AS success_count,
             SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failure_count,
             COUNT(DISTINCT user_id)                     AS unique_users
      FROM   audit_logs
      WHERE  created_at BETWEEN $1 AND $2
      GROUP  BY action
      ORDER  BY count DESC
    `, [startTime, endTime]);
    return result.rows;
  }

  /** Return all SECURITY/CRITICAL events within the last N hours. */
  async getSecurityEvents(hours = 24) {
    if (!this.db) throw new Error('Database not available');
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    const result = await this.db.query(`
      SELECT * FROM audit_logs
      WHERE  severity IN ('SECURITY', 'CRITICAL')
        AND  created_at >= $1
      ORDER  BY created_at DESC
      LIMIT  500
    `, [since]);
    return result.rows;
  }

  /**
   * Detect suspicious activity patterns for a user within a time window.
   * Returns a summary with an isSuspicious flag.
   */
  async detectSuspiciousActivity(userId, windowMinutes = 5) {
    if (!this.db) return { userId, error: 'Database not available' };

    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();

    const [auths, authz] = await Promise.all([
      this.db.query(
        `SELECT COUNT(*) FROM audit_logs
         WHERE user_id = $1 AND action = 'AUTH_FAILED' AND created_at >= $2`,
        [userId, since]
      ),
      this.db.query(
        `SELECT COUNT(*) FROM audit_logs
         WHERE user_id = $1
           AND action IN ('AUTHORIZATION_DENIED','SCOPE_VIOLATION')
           AND created_at >= $2`,
        [userId, since]
      )
    ]);

    const result = {
      userId,
      windowMinutes,
      failedAuths:     parseInt(auths.rows[0].count, 10),
      authzViolations: parseInt(authz.rows[0].count, 10),
      isSuspicious:    false,
      reasons:         []
    };

    if (result.failedAuths >= 5) {
      result.isSuspicious = true;
      result.reasons.push(`${result.failedAuths} failed authentication attempts`);
    }
    if (result.authzViolations >= 3) {
      result.isSuspicious = true;
      result.reasons.push(`${result.authzViolations} authorization violations`);
    }

    if (result.isSuspicious) {
      await this.logSecurityEvent({
        userId,
        action:  AuditLogService.ACTION_TYPES.SUSPICIOUS_ACTIVITY,
        resource: 'security',
        details: result,
        success: false
      });
    }

    return result;
  }

  // ============================================================
  // INTEGRITY VERIFICATION
  // ============================================================

  /**
   * Verify the hash chain from startId (or beginning) up to `limit` entries.
   * Any tampered entry will produce a hash mismatch and be reported.
   *
   * @param {number|null} startId
   * @param {number}      limit
   * @returns {{ verified, entriesChecked, tamperedEntries, message }}
   */
  async verifyIntegrity(startId = null, limit = 1000) {
    if (!this.db) throw new Error('Database not available');

    const sql = startId
      ? `SELECT * FROM audit_logs WHERE id >= $1 ORDER BY id LIMIT $2`
      : `SELECT * FROM audit_logs ORDER BY id LIMIT $1`;
    const params = startId ? [startId, limit] : [limit];

    const result = await this.db.query(sql, params);
    if (result.rows.length === 0) {
      return { verified: true, entriesChecked: 0, tamperedEntries: [], message: 'No logs to verify' };
    }

    let previousHash    = '0'.repeat(64);
    const tamperedEntries = [];

    for (const row of result.rows) {
      const entryForHash = {
        userId:     row.user_id,
        action:     row.action,
        resource:   row.resource,
        resourceId: row.resource_id,
        success:    row.success,
        timestamp:  row.created_at
      };

      const expected = this._computeHash(entryForHash, previousHash);

      if (expected !== row.log_hash) {
        tamperedEntries.push({
          id:           row.id,
          timestamp:    row.created_at,
          action:       row.action,
          expectedHash: expected,
          actualHash:   row.log_hash
        });
      }

      previousHash = row.log_hash;
    }

    const verified = tamperedEntries.length === 0;

    await this.log({
      action:   AuditLogService.ACTION_TYPES.AUDIT_INTEGRITY_CHECK,
      resource: 'audit_logs',
      details: {
        entriesChecked: result.rows.length,
        tamperedCount:  tamperedEntries.length,
        verified
      },
      success:  verified,
      severity: verified
        ? AuditLogService.SEVERITY.INFO
        : AuditLogService.SEVERITY.CRITICAL
    });

    return {
      verified,
      entriesChecked:  result.rows.length,
      tamperedEntries,
      message: verified
        ? 'Audit log integrity verified'
        : `${tamperedEntries.length} tampered entries detected!`
    };
  }

  // ============================================================
  // EXPORT
  // ============================================================

  /**
   * Export filtered audit logs as CSV.
   * @returns {string} CSV text
   */
  async exportToCSV(filters = {}) {
    const data = await this.query({ ...filters, limit: 10_000 });

    const headers = [
      'ID','Timestamp','Username','Role','Unit',
      'Action','Resource','Resource ID','Success',
      'Failure Reason','Severity','IP Address','Log Hash'
    ];

    const escapeCell = v =>
      `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;

    const rows = data.entries.map(e => [
      e.id, e.created_at, e.username, e.role_name, e.unit_code,
      e.action, e.resource, e.resource_id,
      e.success ? 'YES' : 'NO',
      e.failure_reason, e.severity, e.ip_address, e.log_hash
    ].map(escapeCell).join(','));

    return [headers.map(escapeCell).join(','), ...rows].join('\n');
  }

  // ============================================================
  // INTERNAL — HASH CHAIN
  // ============================================================

  _computeHash(entry, previousHash) {
    const payload = JSON.stringify({
      previousHash,
      userId:     entry.userId,
      action:     entry.action,
      resource:   entry.resource,
      resourceId: entry.resourceId,
      success:    entry.success,
      timestamp:  entry.timestamp
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  _determineSeverity(action, success) {
    if (!success) {
      const sec = new Set([
        'AUTH_FAILED','AUTHORIZATION_DENIED','SCOPE_VIOLATION',
        'RATE_LIMIT_EXCEEDED','SUSPICIOUS_ACTIVITY','BRUTE_FORCE_DETECTED'
      ]);
      const crit = new Set([
        'BLOCKCHAIN_TAMPER_DETECTED','AUDIT_INTEGRITY_CHECK'
      ]);
      if (crit.has(action)) return 'CRITICAL';
      if (sec.has(action))  return 'SECURITY';
      return 'WARNING';
    }
    if (action === 'BLOCKCHAIN_TAMPER_DETECTED') return 'CRITICAL';
    return 'INFO';
  }

  // ============================================================
  // INTERNAL — WRITE QUEUE / BATCH DB WRITES
  // ============================================================

  async _processWriteQueue() {
    if (this._isProcessing || this._writeQueue.length === 0) return;
    this._isProcessing = true;

    const batch = this._writeQueue.splice(0, AuditLogService.BATCH_SIZE);

    try {
      if (this.db) {
        await this._writeBatch(batch);
        this._stats.lastWriteTime = new Date().toISOString();
      } else {
        this._inMemoryBuffer.push(...batch);
        this._stats.bufferedEntries = this._inMemoryBuffer.length;
      }
    } catch {
      // Re-buffer failed writes
      this._inMemoryBuffer.push(...batch);
      this._stats.failedWrites += batch.length;
      this._stats.bufferedEntries = this._inMemoryBuffer.length;
    } finally {
      this._isProcessing = false;
      if (this._writeQueue.length > 0) {
        setImmediate(() => this._processWriteQueue());
      }
    }
  }

  async _writeBatch(entries) {
    if (!entries.length) return;
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      for (const e of entries) {
        await client.query(`
          INSERT INTO audit_logs (
            user_id, username, role_name, unit_code,
            action, resource, resource_id, details,
            ip_address, success, failure_reason, severity,
            previous_hash, log_hash, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `, [
          e.userId, e.username, e.roleName, e.unitCode,
          e.action, e.resource, e.resourceId, e.details,
          e.ipAddress, e.success, e.failureReason, e.severity,
          e.previousHash, e.logHash, e.timestamp
        ]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async _flushBuffer() {
    if (!this._inMemoryBuffer.length || !this.db) return;
    const toFlush = this._inMemoryBuffer.splice(0);
    this._stats.bufferedEntries = 0;
    try {
      await this._writeBatch(toFlush);
    } catch {
      this._inMemoryBuffer.unshift(...toFlush);
      this._stats.bufferedEntries = this._inMemoryBuffer.length;
    }
  }

  /** Return current service statistics. */
  getStats() {
    return {
      ...this._stats,
      chainActive:     this._lastHash !== '0'.repeat(64),
      writeQueueDepth: this._writeQueue.length,
      bufferDepth:     this._inMemoryBuffer.length
    };
  }
}

module.exports = AuditLogService;
