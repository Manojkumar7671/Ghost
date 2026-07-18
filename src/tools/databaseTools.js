const { Pool } = require('pg');

let pool;
if (process.env.SUPABASE_DB_URL) {
  pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  console.warn("[Database Tools] Warning: SUPABASE_DB_URL is not set. Database query tool will not be functional.");
}

/**
 * Executes a PostgreSQL query directly against the connected Supabase instance.
 * Allows the Ghost AI brain to dynamically inspect tables, update states, and save logs.
 */
async function executeQuery(payload) {
  const { sql, params = [] } = payload;
  
  if (!pool) {
    return { error: "Database not connected. SUPABASE_DB_URL env variable is missing or empty." };
  }
  
  // Guard check to block destructive operations on system tables or credentials
  const blockedKeywords = ['drop database', 'drop table users', 'delete from users', 'truncate table users', 'grant ', 'revoke '];
  const queryLower = sql.toLowerCase();
  if (blockedKeywords.some(keyword => queryLower.includes(keyword))) {
    return { error: "Query blocked: Action attempts destructive modifications on restricted tables." };
  }
  
  try {
    const res = await pool.query(sql, params);
    return { 
      success: true, 
      rowCount: res.rowCount,
      rows: res.rows.slice(0, 100) // Truncate rows to prevent token limit overflows
    };
  } catch (err) {
    return { error: `Postgres execution failed: ${err.message}` };
  }
}

module.exports = {
  executeQuery
};
