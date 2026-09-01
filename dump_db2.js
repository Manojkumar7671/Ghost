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
        const { rows } = await pool.query(`SELECT username, history_json FROM user_memories WHERE username = 'stress_user_1'`);
        for (const r of rows) {
            console.log(r.history_json);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
