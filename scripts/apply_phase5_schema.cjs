const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool.js');

async function applySchema() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, '../src/db/phase5_schema.sql'), 'utf8');
        await pool.query(sql);
        console.log("Phase 5 schema applied.");
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
applySchema();
