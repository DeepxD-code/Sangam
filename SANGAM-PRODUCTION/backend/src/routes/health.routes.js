'use strict';

const express = require('express');
const { version } = require('../../../package.json');

/**
 * SANGAM Health Route
 *
 * GET /health
 *   200 { status:"ok", version, nodeEnv, uptime, db:{connected,latencyMs} }
 *   503 { status:"degraded", ... }     — when DB is unreachable
 *
 * No authentication required. Used by:
 *   - Docker HEALTHCHECK
 *   - Load balancers / reverse proxies
 *   - External monitoring (Nagios, Prometheus scrape target)
 */
function createHealthRoutes(db) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const base = {
      status:  'ok',
      version,
      nodeEnv: process.env.NODE_ENV || 'development',
      uptime:  Math.floor(process.uptime())
    };

    // DB latency probe
    let dbStatus = { connected: false, latencyMs: null };

    if (db) {
      const start = Date.now();
      try {
        await db.query('SELECT 1');
        dbStatus = { connected: true, latencyMs: Date.now() - start };
      } catch {
        dbStatus = { connected: false, latencyMs: null };
      }
    }

    const payload = { ...base, db: dbStatus };

    if (!dbStatus.connected) {
      payload.status = 'degraded';
      return res.status(503).json(payload);
    }

    return res.status(200).json(payload);
  });

  return router;
}

module.exports = createHealthRoutes;
