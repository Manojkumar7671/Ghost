const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool.js');

async function applySchema() {
    if (!pool) {
        console.error("No database pool available. Is SUPABASE_DB_URL set?");
        process.exit(1);
    }
    const sqlPath = path.join(__dirname, '../src/db/phase4_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    try {
        await pool.query(sql);
        console.log("Phase 4 schema applied successfully.");
    } catch (err) {
        console.error("Error applying schema:", err);
    } finally {
        await pool.end();
    }
}
applySchema();
