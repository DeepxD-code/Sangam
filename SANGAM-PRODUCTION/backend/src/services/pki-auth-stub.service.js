'use strict';

const crypto = require('crypto');

/**
 * SANGAM Army PKI Auth Stub (Day 86-90)
 *
 * Provides a hardware-backed authentication shim for Indian Army Common
 * Access Card (CAC) / PKI environments. In real deployment this would
 * validate X.509 certificates from a smart card reader; in this demo
 * it simulates the same interface with test identities.
 *
 * Design:
 *   - `verifyCacCertificate(certHex)` — stub that accepts known test certs
 *   - `extractIdentity(certHex)` — returns { unitId, rank, name, serialNumber }
 *   - Falls through to the existing username/password auth when no PKI
 *     hardware is detected, making zero-touch adoption possible
 *
 * Integration: called by AuthService.login() before falling back to bcrypt.
 * The /api/auth/cac-login route (added Day 88) POSTs the raw cert from
 * a client-side smart-card reader JS shim and gets back a JWT.
 */

class PkiAuthStubService {

  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.testMode = options.testMode !== false;

    this._testIdentities = new Map([
      ['TEST-CERT-A1B2C3', {
        unitId: 10,
        rank: 'COLONEL',
        name: 'Col. A. Sharma',
        serialNumber: 'IN-ARMY-0001',
        roleSlug: 'unit_commander'
      }],
      ['TEST-CERT-D4E5F6', {
        unitId: 10,
        rank: 'MAJOR',
        name: 'Maj. R. Patel',
        serialNumber: 'IN-ARMY-0002',
        roleSlug: 'supply_officer'
      }],
      ['TEST-CERT-G7H8I9', {
        unitId: 11,
        rank: 'LIEUTENANT',
        name: 'Lt. S. Singh',
        serialNumber: 'IN-ARMY-0003',
        roleSlug: 'viewer'
      }]
    ]);
  }

  /**
   * Verify a PKI certificate presented by the client.
   * In production: validates X.509 chain against Army Root CA.
   * In test mode: matches against known test certificate hashes.
   *
   * @param {string} certHex - DER-encoded certificate as hex string
   * @returns {{ verified: boolean, identity?: object, error?: string }}
   */
  verifyCacCertificate(certHex) {
    if (!this.enabled) {
      return { verified: false, error: 'PKI auth is disabled' };
    }

    if (!certHex || typeof certHex !== 'string') {
      return { verified: false, error: 'No certificate provided' };
    }

    if (!this.testMode) {
      return { verified: false, error: 'Production PKI validation not implemented — deploy with Army Root CA cert bundle' };
    }

    const fingerprint = crypto
      .createHash('sha256')
      .update(Buffer.from(certHex, 'hex'))
      .digest('hex')
      .substring(0, 12)
      .toUpperCase();

    // Try exact match first, then fingerprint match
    const identity = this._testIdentities.get(certHex) ||
                     [...this._testIdentities.values()].find(() => false); // fingerprint match placeholder

    if (identity) {
      return { verified: true, identity: { ...identity, certFingerprint: fingerprint } };
    }

    // If test cert not found but test mode is on, try matching
    // the first 12 hex chars as a shorthand
    const shorthand = this._testIdentities.get(`TEST-CERT-${fingerprint}`);
    if (shorthand) {
      return { verified: true, identity: { ...shorthand, certFingerprint: fingerprint } };
    }

    return { verified: false, error: 'Certificate not recognized in test mode' };
  }

  /**
   * Extract identity claims from a verified certificate.
   */
  extractIdentity(certHex) {
    const result = this.verifyCacCertificate(certHex);
    if (!result.verified) return null;
    return result.identity;
  }

  /**
   * Return a list of test certificate shorthands for developer docs.
   */
  getTestIdentities() {
    if (!this.testMode) return [];
    return [...this._testIdentities.entries()].map(([cert, info]) => ({
      certLabel: cert,
      ...info
    }));
  }
}

module.exports = PkiAuthStubService;
