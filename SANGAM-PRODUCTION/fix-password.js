require('dotenv').config({ path: 'E:\\Potential-gold\\Sangam\\SANGAM-PRODUCTION\\.env' });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

async function main() {
  const pepper = process.env.PASSWORD_PEPPER || 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  const password = 'Admin@1234';
  const hash = await bcrypt.hash(password + pepper, 10);
  console.log('New hash:', hash);
  
  await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, 'admin']);
  console.log('Password updated for admin');
  
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });