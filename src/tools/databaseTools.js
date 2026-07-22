const { Pool } = require('pg');

let pool;
if (process.env.SUPABASE_DB_URL) {
  pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: (process.env.SUPABASE_DB_URL.includes('localhost') || process.env.SUPABASE_DB_URL.includes('127.0.0.1')) ? false : { rejectUnauthorized: false },
    max: 2
  });
} else {
  console.warn("[Database Tools] Warning: SUPABASE_DB_URL is not set. Database query tool will not be functional.");
}

/**
 * Executes a PostgreSQL query directly against the connected Supabase instance.
 * Allows the Ghost AI brain to dynamically inspect tables, update states, and save logs.
 */
async function logTrajectory(userGoal, sql, resultOutput, status) {
  if (!pool) return;
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS skillopt_trajectories (
        id SERIAL PRIMARY KEY,
        user_goal TEXT,
        generated_sql TEXT,
        result_output TEXT,
        status TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    await pool.query(
      `INSERT INTO skillopt_trajectories (user_goal, generated_sql, result_output, status)
       VALUES ($1, $2, $3, $4)`,
      [userGoal || 'Unknown', sql, JSON.stringify(resultOutput), status]
    );
  } catch (err) {
    console.error('[SkillOpt Logger] Error logging trajectory:', err.message);
  }
}

async function executeQuery(payload) {
  const { sql, params = [], userContext, userGoal } = payload;

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
      const err = { error: "Database execution failed: Writing and schema-modifying queries are restricted to admin clearance in public deployment mode." };
      logTrajectory(userGoal, sql, err, 'fail').catch(() => {});
      return err;
    }

    // 4. Blocklist check: check if any write keyword appears anywhere in the comment-free SQL
    const writeKeywords = ['insert', 'update', 'delete', 'drop', 'truncate', 'create', 'alter', 'grant', 'revoke', 'replace', 'into'];
    const queryLower = commentFreeSql.toLowerCase();
    if (writeKeywords.some(keyword => {
      // Ensure keyword matches as a full word to avoid blocking column names like 'created_at' or 'updated_at'
      const regex = new RegExp('\\b' + keyword + '\\b');
      return regex.test(queryLower);
    })) {
      const err = { error: "Database execution failed: Writing and schema-modifying queries are restricted to admin clearance in public deployment mode." };
      logTrajectory(userGoal, sql, err, 'fail').catch(() => {});
      return err;
    }
  }

  if (!pool) {
    const err = { error: "Database not connected. SUPABASE_DB_URL env variable is missing or empty." };
    logTrajectory(userGoal, sql, err, 'fail').catch(() => {});
    return err;
  }
  
  // Guard check to block destructive operations on system tables or credentials
  const blockedKeywords = ['drop database', 'drop table users', 'delete from users', 'truncate table users', 'grant ', 'revoke '];
  const queryLower = sql.toLowerCase();
  if (blockedKeywords.some(keyword => queryLower.includes(keyword))) {
    const err = { error: "Query blocked: Action attempts destructive modifications on restricted tables." };
    logTrajectory(userGoal, sql, err, 'fail').catch(() => {});
    return err;
  }
  
  try {
    const res = await pool.query(sql, params);
    const output = { 
      success: true, 
      rowCount: res.rowCount,
      rows: res.rows.slice(0, 100) // Truncate rows to prevent token limit overflows
    };
    logTrajectory(userGoal, sql, output, 'pass').catch(() => {});
    return output;
  } catch (err) {
    const errorOutput = { error: `Postgres execution failed: ${err.message}` };
    logTrajectory(userGoal, sql, errorOutput, 'fail').catch(() => {});
    return errorOutput;
  }
}

/**
 * Simple connection test function for Supabase Postgres pool.
 */
async function testConnection() {
  if (!pool) {
    return { success: false, connected: false, message: "SUPABASE_DB_URL is not configured." };
  }
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS _ghost_conn_test (id SERIAL PRIMARY KEY, test_val TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    const val = `ghost_ping_${Date.now()}`;
    const insertRes = await pool.query(`INSERT INTO _ghost_conn_test (test_val) VALUES ($1) RETURNING *`, [val]);
    const selectRes = await pool.query(`SELECT * FROM _ghost_conn_test WHERE id = $1`, [insertRes.rows[0].id]);
    return { success: true, connected: true, written: insertRes.rows[0], readBack: selectRes.rows[0] };
  } catch (err) {
    return { success: false, connected: false, error: err.message };
  }
}

module.exports = {
  executeQuery,
  testConnection
};
