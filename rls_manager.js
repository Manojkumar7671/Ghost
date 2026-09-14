import pkg from 'pg';
const { Client } = pkg;

const connectionString = 'postgresql://postgres.nztjqoinkepycntrfavo:Manoj7671014128@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

async function lockDownRLS() {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    
    console.log("Fetching disabled tables...");
    const query = `
        SELECT relname AS table_name 
        FROM pg_class 
        WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') 
        AND relkind = 'r'
        AND relrowsecurity = false;
    `;
    
    const res = await client.query(query);
    const tables = res.rows.map(row => row.table_name);
    
    console.log(`Found ${tables.length} tables with RLS disabled. Enabling...`);
    
    for (const table of tables) {
        try {
            await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
            console.log(`Enabled RLS on ${table}`);
        } catch (err) {
            console.error(`Failed to enable RLS on ${table}:`, err.message);
        }
    }
    
    console.log("\nRe-running audit...");
    const auditQuery = `
        SELECT relname AS table_name, relrowsecurity AS rls_enabled 
        FROM pg_class 
        WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') 
        AND relkind = 'r'
        ORDER BY relname;
    `;
    const auditRes = await client.query(auditQuery);
    console.table(auditRes.rows);
    
    await client.end();
}

lockDownRLS().catch(console.error);
