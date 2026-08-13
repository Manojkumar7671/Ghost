import pkg from 'pg';
const { Pool } = pkg;

let pool;
if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  pool = new Pool({
    connectionString: dbUrl,
    ssl: (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) ? false : { rejectUnauthorized: false },
    max: 2
  });
  
  // Initialize table
  pool.query(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id SERIAL PRIMARY KEY,
      provider VARCHAR(50),
      cost NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(err => console.error('[Usage Tracker] DB Init Error:', err.message));
} else {
  console.warn('[Usage Tracker] No DB URL found, usage logging disabled.');
}

export async function logUsage(provider, cost) {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO usage_log (provider, cost) VALUES ($1, $2)',
      [provider, cost]
    );
  } catch (err) {
    console.error('[Usage Tracker] Failed to log usage:', err.message);
  }
}
