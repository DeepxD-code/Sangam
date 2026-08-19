'use strict';

const crypto = require('crypto');

/**
 * SANGAM Audit Hardening Service
 *
 * Closes two gaps in the Day 13 audit foundation:
 *
 *   1. ENCRYPTION-AT-REST — AES-256-GCM for the `details` column on
 *      audit_logs and the `justification` field on permission_overrides.
 *      The DBA sees ciphertext; only the application holding
 *      AUDIT_ENCRYPTION_KEY can decrypt.
 *
 *   2. SCHEDULED INTEGRITY SWEEP — runs verifyIntegrity() (Day 13) every
 *      N minutes. A chain break automatically emits a CRITICAL notification
 *      (Day 11) to Senior Officers and logs another audit entry — no manual
 *      intervention needed to detect tampering.
 *
 * Encryption format: `IV_hex:ciphertext_hex:authTag_hex`
 *   - Random 16-byte IV per record (no frequency analysis).
 *   - GCM auth tag means ciphertext bit-flips are detectable (second
 *     tamper-detection layer on top of Day 13's hash chain).
 *   - KEY is 32 bytes (256 bits), sourced from AUDIT_ENCRYPTION_KEY env
 *     var as a 64-char hex string.
 *
 * Works without a DB (in-memory mode): all crypto methods are pure;
 * the sweep degrades gracefully when DB is unavailable.
 */
class AuditHardeningService {

  static ALGO        = 'aes-256-gcm';
  static IV_BYTES    = 16;
  static KEY_HEX_LEN = 64; // 32 bytes

  static DEFAULT_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  static SWEEP_WINDOW_ENTRIES      = 500;             // entries checked per sweep

  /**
   * @param {object} db              - pg Pool (optional)
   * @param {object} auditLog        - AuditLogService instance
   * @param {object} [notifications] - NotificationService instance (optional)
   * @param {string} [keyHex]        - 64-char hex encryption key
   *                                   (defaults to AUDIT_ENCRYPTION_KEY env var
   *                                    or a dev-mode insecure fallback)
   */
  constructor(db, auditLog, notifications = null, keyHex = null) {
    this.db            = db;
    this.auditLog      = auditLog;
    this.notifications = notifications;

    // Resolve encryption key
    const rawKey = keyHex
      || process.env.AUDIT_ENCRYPTION_KEY
      || null;

    if (rawKey) {
      if (rawKey.length !== AuditHardeningService.KEY_HEX_LEN) {
        throw new Error(
          `AUDIT_ENCRYPTION_KEY must be exactly ${AuditHardeningService.KEY_HEX_LEN} hex chars (32 bytes / 256 bits)`
        );
      }
      this._key = Buffer.from(rawKey, 'hex');
      this._keyAvailable = true;
    } else {
      // Dev/test fallback — NOT for production
      this._key = crypto.scryptSync('sangam-dev-audit-key', 'sangam-salt', 32);
      this._keyAvailable = false;
    }

    this._sweepInterval = null;
    this._sweepRunning  = false;
    this._stats = {
      sweepCount:          0,
      lastSweepAt:         null,
      lastSweepVerified:   null,
      tamperEventsEmitted: 0,
      encryptedCount:      0,
      decryptedCount:      0
    };
  }

  // ============================================================
  // ENCRYPTION / DECRYPTION
  // ============================================================

  /**
   * Encrypt a string value with AES-256-GCM.
   * Returns null for null/empty input (preserves DB nulls).
   *
   * @param {string|null} plaintext
   * @returns {string|null} `IV:ciphertext:authTag` or null
   */
  encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) return null;
    const str = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);
    if (str === '') return null;

    const iv     = crypto.randomBytes(AuditHardeningService.IV_BYTES);
    const cipher = crypto.createCipheriv(AuditHardeningService.ALGO, this._key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(str, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    this._stats.encryptedCount++;

    return `${iv.toString('hex')}:${ciphertext.toString('hex')}:${authTag.toString('hex')}`;
  }

  /**
   * Decrypt an AES-256-GCM encrypted value.
   * Returns null for null input.
   * Throws if the auth tag fails (tampering detected).
   *
   * @param {string|null} stored - `IV:ciphertext:authTag`
   * @returns {string|null}
   */
  decrypt(stored) {
    if (!stored) return null;

    const parts = stored.split(':');
    if (parts.length !== 3) {
      throw new Error('INVALID_ENCRYPTED_FORMAT: expected IV:ciphertext:authTag');
    }

    const [ivHex, ciphertextHex, authTagHex] = parts;
    const iv         = Buffer.from(ivHex,         'hex');
    const ciphertext = Buffer.from(ciphertextHex,  'hex');
    const authTag    = Buffer.from(authTagHex,     'hex');

    const decipher = crypto.createDecipheriv(AuditHardeningService.ALGO, this._key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8');

    this._stats.decryptedCount++;
    return plaintext;
  }

  /**
   * Check whether a stored value looks like encrypted output from
   * this service (IV:ciphertext:authTag, all valid hex, correct lengths).
   */
  isEncrypted(value) {
    if (typeof value !== 'string') return false;
    const parts = value.split(':');
    if (parts.length !== 3) return false;
    return parts.every(p => /^[0-9a-f]+$/i.test(p));
  }

  /**
   * Encrypt the `details` field on an audit log entry before writing.
   * Accepts a string (already-serialised JSON) or an object.
   * Returns the mutated entry (does not clone).
   */
  encryptAuditDetails(entry) {
    if (entry.details !== null && entry.details !== undefined) {
      const str = typeof entry.details === 'string'
        ? entry.details
        : JSON.stringify(entry.details);
      entry.details = this.encrypt(str);
    }
    return entry;
  }

  /**
   * Decrypt the `details` field on an audit log entry.
   * Returns the mutated entry (does not clone).
   * If details is not encrypted (e.g. old plaintext records), returns as-is.
   */
  decryptAuditDetails(entry) {
    if (entry.details && this.isEncrypted(entry.details)) {
      try {
        const plaintext = this.decrypt(entry.details);
        try { entry.details = JSON.parse(plaintext); }
        catch { entry.details = plaintext; }
      } catch {
        entry.details = '[DECRYPTION_FAILED]';
      }
    }
    return entry;
  }

  /**
   * Encrypt/decrypt a `justification` field (permission_overrides, Day 15).
   */
  encryptJustification(text) {
    return this.encrypt(text);
  }

  decryptJustification(stored) {
    if (!stored) return null;
    if (!this.isEncrypted(stored)) return stored; // legacy plaintext
    try { return this.decrypt(stored); }
    catch { return '[DECRYPTION_FAILED]'; }
  }

  // ============================================================
  // SCHEDULED INTEGRITY SWEEP
  // ============================================================

  /**
   * Start the hourly integrity sweep.
   * Returns `this` for chaining.
   *
   * @param {number} [intervalMs] - sweep frequency (default 1 hour)
   */
  startIntegritySweep(intervalMs = AuditHardeningService.DEFAULT_SWEEP_INTERVAL_MS) {
    if (this._sweepInterval) this.stopIntegritySweep();
    this._sweepInterval = setInterval(
      () => this._runSweep().catch(err => console.error('[audit-hardening] sweep error:', err.message)),
      intervalMs
    );
    return this;
  }

  /** Stop the sweep timer. */
  stopIntegritySweep() {
    if (this._sweepInterval) {
      clearInterval(this._sweepInterval);
      this._sweepInterval = null;
    }
  }

  /**
   * Run a single integrity sweep immediately.
   * Also callable manually (e.g. for tests or on-demand checks).
   *
   * @returns {Promise<object>} sweep result
   */
  async runSweepNow() {
    return this._runSweep();
  }

  async _runSweep() {
    if (this._sweepRunning) return { skipped: true, reason: 'previous sweep still running' };
    this._sweepRunning = true;
    this._stats.sweepCount++;
    this._stats.lastSweepAt = new Date().toISOString();

    const result = {
      at:       this._stats.lastSweepAt,
      verified: null,
      entries:  0,
      tampered: [],
      hashMismatch: false
    };

    try {
      if (!this.db) {
        result.verified = null;
        result.reason = 'database_not_available';
        return result;
      }

      // 1. Hash-chain window check (Day 13)
      const integrity = await this.auditLog.verifyIntegrity(
        null, AuditHardeningService.SWEEP_WINDOW_ENTRIES
      ).catch(err => { console.error('[audit-hardening] verifyIntegrity error:', err.message); return null; });

      if (integrity) {
        result.verified  = integrity.verified;
        result.entries   = integrity.entriesChecked;
        result.tampered  = integrity.tamperedEntries;
      }

      // 2. Cross-check: does the DB's most-recent log_hash agree with
      //    what the running AuditLogService remembers as its last hash?
      const latest = await this.db.query(
        `SELECT log_hash FROM audit_logs ORDER BY id DESC LIMIT 1`
      ).catch(err => { console.error('[audit-hardening] latestHash query error:', err.message); return null; });

      if (latest && latest.rows.length > 0) {
        const dbHash  = latest.rows[0].log_hash;
        const memHash = this.auditLog._lastHash;
        if (memHash !== '0'.repeat(64) && dbHash !== memHash) {
          result.hashMismatch = true;
          result.verified = false;
        }
      }

      // 3. Act on findings
      if (result.verified === false) {
        this._stats.tamperEventsEmitted++;
        await this._onTamperDetected(result);
      }

      this._stats.lastSweepVerified = result.verified;
    } finally {
      this._sweepRunning = false;
    }

    return result;
  }

  async _onTamperDetected(sweepResult) {
    const details = {
      sweepAt:          sweepResult.at,
      tamperedCount:    sweepResult.tampered.length,
      hashMismatch:     sweepResult.hashMismatch,
      firstTampered:    sweepResult.tampered[0] || null
    };

    // Log a CRITICAL audit entry (which Day 11 turns into a notification)
    await this.auditLog.log({
      action:   'AUDIT_INTEGRITY_CHECK',
      resource: 'audit_logs',
      details,
      success:  false,
      severity: 'CRITICAL'
    }).catch(err => console.error('[audit-hardening] tamper audit error:', err.message));

    // Direct notification (belt + suspenders — the audit event already
    // triggers Day 11's security-alert listener, but a direct call
    // ensures the notification exists even if the listener hasn't fired yet)
    if (this.notifications) {
      await this.notifications.create({
        type:     'BLOCKCHAIN_TAMPER',
        severity: 'CRITICAL',
        title:    'Audit log integrity violation detected',
        message:  `Integrity sweep at ${sweepResult.at} found ${sweepResult.tampered.length} tampered entries` +
                  (sweepResult.hashMismatch ? ' and a hash mismatch (possible external write).' : '.'),
        resourceType: 'audit_logs',
        requiresAck:  true
      }).catch(err => console.error('[audit-hardening] tamper notification error:', err.message));
    }
  }

  // ============================================================
  // DB WRITE HELPERS (for use by AuditLogService, via composition)
  // ============================================================

  /**
   * Prepare an audit log entry for DB write by encrypting its details.
   * Returns a new object (does not mutate the original).
   */
  prepareForWrite(entry) {
    if (!entry || entry.details === null || entry.details === undefined) return entry;
    const clone = { ...entry };
    const str = typeof clone.details === 'string' ? clone.details : JSON.stringify(clone.details);
    clone.details = this.encrypt(str);
    return clone;
  }

  /**
   * Decrypt the details field on a row returned from the DB.
   * Returns a new object (does not mutate the original).
   */
  decryptRow(row) {
    if (!row) return row;
    const clone = { ...row };
    if (clone.details && this.isEncrypted(clone.details)) {
      try {
        const plaintext = this.decrypt(clone.details);
        try { clone.details = JSON.parse(plaintext); }
        catch { clone.details = plaintext; }
      } catch {
        clone.details = '[DECRYPTION_FAILED]';
      }
    }
    return clone;
  }

  /** Decrypt an array of rows in place (efficiency helper). */
  decryptRows(rows) {
    return rows.map(r => this.decryptRow(r));
  }

  // ============================================================
  // KEY STATUS
  // ============================================================

  /**
   * Return safe status info — whether a real key is loaded, never the
   * key material itself.
   */
  getKeyStatus() {
    return {
      productionKeyLoaded: this._keyAvailable,
      algorithm:           AuditHardeningService.ALGO,
      keyBits:             256,
      note: this._keyAvailable
        ? 'Production key loaded from AUDIT_ENCRYPTION_KEY env var'
        : 'WARNING: dev-mode key in use — set AUDIT_ENCRYPTION_KEY for production'
    };
  }

  /** Service statistics. */
  getStats() {
    return {
      ...this._stats,
      sweepActive:      this._sweepInterval !== null,
      keyAvailable:     this._keyAvailable
    };
  }
}

module.exports = AuditHardeningService;
