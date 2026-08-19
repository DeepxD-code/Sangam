const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pepper = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const connectionString = 'postgresql://postgres:postgres@localhost:5432/postgres';

async function main() {
  const pool = new Pool({ connectionString });
  
  const password = 'Admin@1234';
  const hash = await bcrypt.hash(password + pepper, 10);
  console.log('New hash:', hash);
  
  await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, 'admin']);
  console.log('Password updated for admin');
  
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });