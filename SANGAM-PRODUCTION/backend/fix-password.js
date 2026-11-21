// Admin password reset utility.
// Usage: PASSWORD_PEPPER=... DATABASE_URL=... node fix-password.js <username> <new-password>
//        (or set NEW_PASSWORD / RESET_USERNAME in the environment instead of argv)
// Secrets are never hardcoded; the pepper must match the server's PASSWORD_PEPPER.
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

async function main() {
  const pepper = process.env.PASSWORD_PEPPER;
  const username = process.argv[2] || process.env.RESET_USERNAME || 'admin';
  const password = process.argv[3] || process.env.NEW_PASSWORD;
  if (!pepper) throw new Error('PASSWORD_PEPPER env var is required');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL env var is required');
  if (!password) throw new Error('New password required: pass as argv[3] or NEW_PASSWORD env var');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await bcrypt.hash(password + pepper, 10);
  const res = await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, username]);
  console.log(`Password updated for ${username} (${res.rowCount} row(s))`);
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
