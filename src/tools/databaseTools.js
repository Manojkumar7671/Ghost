const { Pool } = require('pg');

let pool;
if (process.env.SUPABASE_DB_URL) {
  pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 2
  });
} else {
  console.warn("[Database Tools] Warning: SUPABASE_DB_URL is not set. Database query tool will not be functional.");
}

/**
 * Executes a PostgreSQL query directly against the connected Supabase instance.
 * Allows the Ghost AI brain to dynamically inspect tables, update states, and save logs.
 */
async function executeQuery(payload) {
  const { sql, params = [], userContext } = payload;
  
  if (!pool) {
    return { error: "Database not connected. SUPABASE_DB_URL env variable is missing or empty." };
  }
  
  // If GHOST_DEPLOYMENT_MODE is 'public' (or unset), block non-admin writes
  const isPublic = (process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public';
  if (isPublic && (!userContext || !userContext.isAdmin)) {
    // 1. Strip comments: -- single-line comments and /* ... */ multi-line comments
    const commentFreeSql = sql
      .replace(/--.*$/gm, '') // Strip single line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Strip multi line comments
      .trim();

    // 2. Extract first non-whitespace keyword (strip leading parentheses)
    const cleanSql = commentFreeSql.replace(/^[\s(]+/, '').trim();
    const firstWord = cleanSql.split(/\s+/)[0]?.toLowerCase() || '';

    // 3. Whitelist check: must start with SELECT (or SHOW/DESCRIBE)
    if (firstWord !== 'select' && firstWord !== 'show' && firstWord !== 'describe') {
      return { error: "Database execution failed: Writing and schema-modifying queries are restricted to admin clearance in public deployment mode." };
    }

    // 4. Blocklist check: check if any write keyword appears anywhere in the comment-free SQL
    const writeKeywords = ['insert', 'update', 'delete', 'drop', 'truncate', 'create', 'alter', 'grant', 'revoke', 'replace', 'into'];
    const queryLower = commentFreeSql.toLowerCase();
    if (writeKeywords.some(keyword => {
      // Ensure keyword matches as a full word to avoid blocking column names like 'created_at' or 'updated_at'
      const regex = new RegExp('\\b' + keyword + '\\b');
      return regex.test(queryLower);
    })) {
      return { error: "Database execution failed: Writing and schema-modifying queries are restricted to admin clearance in public deployment mode." };
    }
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
