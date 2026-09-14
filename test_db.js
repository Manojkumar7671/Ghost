import pkg from 'pg';
const { Pool } = pkg;

async function testMem() {
    const pool = new Pool({
        connectionString: 'postgresql://postgres.nztjqoinkepycntrfavo:Manoj7671014128@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
        ssl: { rejectUnauthorized: false }
    });
    
    // Check if we can write to ghost_memory (a table with RLS)
    console.log("Inserting a test memory...");
    await pool.query("INSERT INTO ghost_memory (key, value) VALUES ('test_rls_key', 'test_rls_value') ON CONFLICT (key) DO UPDATE SET value = 'test_rls_value';");
    
    console.log("Reading test memory...");
    const res = await pool.query("SELECT * FROM ghost_memory WHERE key = 'test_rls_key';");
    console.log("Result:", res.rows);
    
    await pool.end();
}

testMem().catch(console.error);
