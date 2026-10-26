import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../mysql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupMySQL() {
  console.log('[MySQL Setup] Verifying database connectivity...');

  try {
    // 1. Verify basic connectivity with SELECT 1
    const [testRow] = await pool.query('SELECT 1 as connected');
    if (!testRow || testRow[0].connected !== 1) {
      throw new Error('Connection verification query did not return 1');
    }
    console.log('[MySQL Setup] Successfully connected to MySQL database.');

    // 2. Read and apply schema from sql/mysql_baseline.sql
    const sqlPath = path.resolve(__dirname, '../../../sql/mysql_baseline.sql');
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Schema file not found at: ${sqlPath}`);
    }

    const schemaSql = fs.readFileSync(sqlPath, 'utf8');
    console.log('[MySQL Setup] Applying baseline schema from sql/mysql_baseline.sql...');

    await pool.query(schemaSql);
    console.log('[MySQL Setup] Schema applied successfully.');

    // 3. Inspect and print created tables
    const [tables] = await pool.query('SHOW TABLES');
    console.log('\n' + '='.repeat(60));
    console.log(' [MYSQL BASELINE READY]');
    console.log(' Database:  ', process.env.MYSQL_DATABASE || 'codered_db');
    console.log(' User:      ', process.env.MYSQL_USER || 'codered_user');
    console.log(' Tables created:');
    for (const t of tables) {
      const tableName = Object.values(t)[0];
      console.log(`   - ${tableName}`);
    }
    console.log('='.repeat(60) + '\n');

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('\n' + '!'.repeat(60));
    console.error(' [MYSQL CONNECTION / SETUP ERROR]');
    console.error(' Error Message:', err.message);
    console.error('!'.repeat(60));

    if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.message.includes('Access denied')) {
      console.error('\n⚠️ Access denied for user: ' + (process.env.MYSQL_USER || 'codered_user'));
      console.error('Please check that MYSQL_PASSWORD in backend/.env matches your MySQL server.\n');
      console.error('If you need to configure the user in MySQL, run the following SQL as MySQL root:');
      console.error(`
CREATE DATABASE IF NOT EXISTS ${process.env.MYSQL_DATABASE || 'codered_db'};
CREATE USER IF NOT EXISTS '${process.env.MYSQL_USER || 'codered_user'}'@'localhost' IDENTIFIED BY 'YOUR_MYSQL_PASSWORD';
GRANT ALL PRIVILEGES ON ${process.env.MYSQL_DATABASE || 'codered_db'}.* TO '${process.env.MYSQL_USER || 'codered_user'}'@'localhost';
FLUSH PRIVILEGES;
`);
    } else if (err.code === 'ECONNREFUSED') {
      console.error('\n⚠️ Could not connect to MySQL server on localhost:3306.');
      console.error('Verify that the MySQL/MariaDB service is running:');
      console.error('  sudo systemctl status mysqld  (or mariadb)');
    }

    if (pool) await pool.end();
    process.exit(1);
  }
}

setupMySQL();
