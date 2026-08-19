'use strict';

/**
 * SANGAM Migration Runner
 *
 * Applies pending SQL migration files in day-number order.
 * Tracks completed migrations in the schema_migrations table.
 * Safe to call on every container startup (skips already-applied files).
 *
 * Usage:
 *   node backend/scripts/run-migrations.js
 *
 * Env vars required:
 *   DATABASE_URL  postgres://user:pass@host:5432/dbname
 */

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '../../database/migrations');

/**
 * Sort migration filenames by their leading number.
 * Handles both 000-init-schema.sql and day-11-xxx.sql patterns.
 *
 * Sort key: the first integer found in the filename.
 * 000-init-schema → 0
 * day-11-xxx      → 11
 * day-16-xxx      → 16
 */
function sortKey(filename) {
  const match = filename.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 9999;
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => sortKey(a) - sortKey(b));
}

async function getAppliedMigrations(client) {
  try {
    const result = await client.query(
      `SELECT filename FROM schema_migrations ORDER BY applied_at`
    );
    return new Set(result.rows.map(r => r.filename));
  } catch {
    // schema_migrations doesn't exist yet — return empty set
    return new Set();
  }
}

async function runMigrations(db = null) {
  const ownPool = !db;
  const pool = db || new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  const results = {
    applied: [],
    skipped: [],
    failed:  null
  };

  try {
    const files   = getMigrationFiles();
    const applied = await getAppliedMigrations(client);

    console.log(`Found ${files.length} migration files, ${applied.size} already applied`);

    for (const filename of files) {
      if (applied.has(filename)) {
        results.skipped.push(filename);
        console.log(`  ⏭  Skipping: ${filename}`);
        continue;
      }

      const filepath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filepath, 'utf8');

      const start = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(sql);

        // Record successful migration
        await client.query(
          `INSERT INTO schema_migrations (filename, duration_ms)
           VALUES ($1, $2)
           ON CONFLICT (filename) DO NOTHING`,
          [filename, Date.now() - start]
        );

        await client.query('COMMIT');
        results.applied.push(filename);
        console.log(`  ✅ Applied:  ${filename} (${Date.now() - start}ms)`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        results.failed = { filename, error: err.message };
        console.error(`  ❌ Failed:   ${filename}: ${err.message}`);
        throw err;
      }
    }

    console.log(`\nMigrations complete: ${results.applied.length} applied, ${results.skipped.length} skipped`);
    return results;
  } finally {
    client.release();
    if (ownPool) await pool.end();
  }
}

// ============================================================
// Run standalone when called directly
// ============================================================
if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations, getMigrationFiles, sortKey };
