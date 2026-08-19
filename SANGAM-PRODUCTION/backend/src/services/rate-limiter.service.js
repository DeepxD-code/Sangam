'use strict';

/**
 * SANGAM Rate Limiter
 *
 * In-memory sliding-window rate limiter — no Redis dependency, fitting
 * the offline-first deployment model (a field node has no external
 * cache to talk to).
 *
 * Primary use: per-IP throttling on /auth/login, which catches
 * distributed credential-stuffing that per-account lockout (Day 14
 * AuthService) cannot — lockout is keyed on *username*, this is keyed
 * on *source*.
 */
class RateLimiter {
  constructor() {
    this._buckets = new Map(); // key -> { count, resetAt }
  }

  // ============================================================
  // CORE CHECK — usable directly in tests or non-Express contexts
  // ============================================================

  /**
   * Record a hit for `key` and report whether it's within limits.
   *
   * @param {string} key
   * @param {number} maxRequests
   * @param {number} windowMs
   * @returns {{ allowed: boolean, count: number, remaining: number, resetAt: number }}
   */
  check(key, maxRequests, windowMs) {
    const now = Date.now();
    let bucket = this._buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this._buckets.set(key, bucket);
    }

    bucket.count++;

    return {
      allowed:   bucket.count <= maxRequests,
      count:     bucket.count,
      remaining: Math.max(0, maxRequests - bucket.count),
      resetAt:   bucket.resetAt
    };
  }

  /** Inspect current state for `key` without incrementing it. */
  peek(key) {
    const bucket = this._buckets.get(key);
    if (!bucket || bucket.resetAt <= Date.now()) return null;
    return { count: bucket.count, resetAt: bucket.resetAt };
  }

  /** Clear the bucket for a single key (e.g. after successful login). */
  reset(key) {
    this._buckets.delete(key);
  }

  /** Remove all expired buckets. Call periodically to bound memory use. */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, bucket] of this._buckets) {
      if (bucket.resetAt <= now) {
        this._buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Current number of tracked keys (for stats/testing). */
  get size() {
    return this._buckets.size;
  }

  // ============================================================
  // EXPRESS MIDDLEWARE FACTORY
  // ============================================================

  /**
   * Build Express middleware enforcing `maxRequests` per `windowMs`,
   * keyed by `keyFn(req)` (defaults to `req.ip`).
   *
   * On limit exceeded: responds 429 with a Retry-After header.
   *
   * @param {number} maxRequests
   * @param {number} windowMs
   * @param {function} [keyFn]
   */
  middleware(maxRequests, windowMs, keyFn = (req) => req.ip) {
    return (req, res, next) => {
      const key = keyFn(req);
      const result = this.check(key, maxRequests, windowMs);

      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));

      if (!result.allowed) {
        const retryAfterSec = Math.ceil((result.resetAt - Date.now()) / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          success: false,
          error:   'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Try again in ${retryAfterSec}s.`,
          retryAfter: retryAfterSec
        });
      }

      return next();
    };
  }
}

module.exports = RateLimiter;
