'use strict';

const { Pool } = require('pg');
const http     = require('http');
const createApp = require('./app');
const { runMigrations } = require('../scripts/run-migrations');

// ============================================================
// REQUIRED ENVIRONMENT VARIABLES
// Startup fails fast with a clear message if any are missing.
// ============================================================
const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'PASSWORD_PEPPER'
];

// AUDIT_ENCRYPTION_KEY is required in production only
if (process.env.NODE_ENV === 'production') {
  REQUIRED_VARS.push('AUDIT_ENCRYPTION_KEY');
}

function validateEnv() {
  const missing = REQUIRED_VARS.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error('\n❌  SANGAM startup failed — missing required environment variables:');
    missing.forEach(v => console.error(`    • ${v}`));
    console.error('\nSee .env.example for documentation.\n');
    process.exit(1);
  }

  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.error('❌  JWT_SECRET must be at least 32 characters');
    process.exit(1);
  }

  if (process.env.AUDIT_ENCRYPTION_KEY &&
      process.env.AUDIT_ENCRYPTION_KEY.length !== 64) {
    console.error('❌  AUDIT_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
    process.exit(1);
  }
}

// ============================================================
// STARTUP SEQUENCE
// ============================================================
async function start() {
  validateEnv();

  const PORT     = parseInt(process.env.PORT || '3000', 10);
  const NODE_ENV = process.env.NODE_ENV || 'development';

  console.log(`\n🪖  SANGAM Supply Chain Management System`);
  console.log(`    Environment: ${NODE_ENV}`);
  console.log(`    Node.js:     ${process.version}`);

  // 1. Connect DB pool
  const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    max:             20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });

  // Test connection before running migrations
  try {
    const client = await db.connect();
    console.log(`\n✅  Database connected`);
    client.release();
  } catch (err) {
    console.error(`\n❌  Database connection failed: ${err.message}`);
    console.error('    Check DATABASE_URL and ensure PostgreSQL is running');
    process.exit(1);
  }

  // 2. Run migrations
  console.log(`\n📋  Running migrations...`);
  try {
    await runMigrations(db);
  } catch (err) {
    console.error(`\n❌  Migration failed: ${err.message}`);
    await db.end();
    process.exit(1);
  }

  // 3. Create Express app + shared services
  const app = createApp(db, {}, { logLevel: NODE_ENV === 'test' ? false : undefined });

  const { hardening, alerts, units } = app.locals.services;

  // 3.5. Optional demo data seed (Day 59) — SEED_DEMO_DATA=true
  //      Populates app.locals.services directly — the same instances every
  //      route serves from — so seeded data is immediately visible over
  //      HTTP. This is the missing link that made `npm run seed:demo`
  //      unable to populate a real running server: that script's CLI path
  //      builds its own disposable, disconnected service instances that
  //      vanish when the script exits, never touching this process's data.
  //      Off by default — a real deployment should start empty.
  //      seedDemoData() detects prior seeding (via the brigade's unit
  //      code) and skips cleanly rather than duplicating; in-memory state
  //      doesn't survive a restart anyway, so "reset the demo" is simply
  //      restarting the process with this flag set.
  if (process.env.SEED_DEMO_DATA === 'true') {
    console.log('\n🌱  SEED_DEMO_DATA=true — seeding demo data...');
    try {
      const { seedDemoData } = require('../scripts/seed-demo-data.js');
      const result = await seedDemoData(app.locals.services);
      if (result?.alreadySeeded) {
        console.log('🌱  Demo data already present — skipped re-seed.');
      } else {
        console.log(`🌱  Demo data seeded: ${result.itemCount} items, ${result.transferCount} transfers, ${result.movementCount} movement orders.`);
      }
    } catch (err) {
      console.error(`\n❌  Demo data seeding failed: ${err.message}`);
      process.exit(1);
    }
  }

  // 4. Start integrity sweep (Day 16) — after app is wired
  if (hardening && NODE_ENV !== 'test') {
    hardening.startIntegritySweep();
    console.log('🔍  Audit integrity sweep started (hourly)');
  }

  // 5. Listen
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.listen(PORT, resolve);
    server.on('error', reject);
  });

  console.log(`\n🚀  SANGAM listening on port ${PORT}`);
  console.log(`    Health: http://localhost:${PORT}/health\n`);

  // 6. Day 31: Alert escalation poller — runs every 30 seconds
  //    Scans all known unit IDs from the UnitManagementService in-memory map.
  //    Non-fatal: if units or alerts aren't available, the poller is skipped.
  let alertPoller = null;
  if (alerts && units) {
    const SCAN_INTERVAL_MS = 30 * 1000;
    alertPoller = setInterval(async () => {
      try {
        // Use the public method — never reach into _units directly
        const allUnitIds = typeof units.getUnitIds === 'function' ? units.getUnitIds() : [];
        if (allUnitIds.length > 0) {
          await alerts.scan(allUnitIds);
        }
      } catch (_err) {
        // Non-fatal — log silently, never crash the server
      }
    }, SCAN_INTERVAL_MS);
    console.log('🔔  Alert escalation poller started (30s interval)');
  }

  // ============================================================
  // GRACEFUL SHUTDOWN
  // ============================================================
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n⚠️   Received ${signal} — shutting down gracefully...`);

    // Stop accepting new connections
    server.close(async () => {
      console.log('    HTTP server closed');

      // Stop pollers
      if (alertPoller) clearInterval(alertPoller);
      if (hardening)   hardening.stopIntegritySweep();

      // Log shutdown to audit
      const { audit } = app.locals.services;
      if (audit) {
        await audit.log({
          action: 'SYSTEM_SHUTDOWN', resource: 'system',
          details: { signal }, success: true
        }).catch(err => console.error('[server] shutdown audit error:', err.message));
        await audit.destroy().catch(err => console.error('[server] audit destroy error:', err.message));
      }

      // Close DB pool
      await db.end().catch(err => console.error('[server] db.end error:', err.message));
      console.log('    Database pool closed');
      console.log('    Goodbye.\n');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('    Forced exit after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });

  return server;
}

if (require.main === module) {
  start().catch(err => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { start, validateEnv };
