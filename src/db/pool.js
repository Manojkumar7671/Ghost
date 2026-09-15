require('dotenv').config();
const { Pool } = require('pg');

let pool = null;
if (process.env.SUPABASE_DB_URL) {
  pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: (process.env.SUPABASE_DB_URL.includes('localhost') || process.env.SUPABASE_DB_URL.includes('127.0.0.1')) 
          ? false 
          : { rejectUnauthorized: false },
    max: 10
  });
  pool.on('error', (err) => console.error('[DB Pool Error]:', err.message));
} else {
  console.warn("[DB Pool] SUPABASE_DB_URL not set.");
}

module.exports = pool;
