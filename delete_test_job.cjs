require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});
pool.query("DELETE FROM scheduled_jobs WHERE id = 'test_persisted_job'")
  .then(() => { console.log("Deleted test job"); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
