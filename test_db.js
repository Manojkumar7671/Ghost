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
        const { rows } = await pool.query(`SELECT username, length(history_json::text) as size FROM user_memories WHERE username LIKE 'stress%' OR username = 'bughunt_user'`);
        console.log("Memory sizes:");
        for (const r of rows) {
            console.log(`${r.username}: ${r.size} bytes`);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
