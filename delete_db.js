import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config({ override: true });

const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const result = await pool.query(`DELETE FROM user_memories WHERE username LIKE 'stress_user_%' OR username = 'bughunt_user' RETURNING username`);
        console.log("Deleted users:", result.rows.map(r => r.username));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
