import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

/**
 * MySQL Connection Pool (used exclusively for benchmark baseline)
 * CodeRank application data lives 100% in Redis.
 */
export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'codered_user',
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'codered_db',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  multipleStatements: true
});

export default pool;
