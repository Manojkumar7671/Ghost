import pkg from 'pg';
const { Client } = pkg;

async function checkRLS() {
    const client = new Client({
        connectionString: 'postgresql://postgres.nztjqoinkepycntrfavo:Manoj7671014128@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
        ssl: { rejectUnauthorized: false }
    });
    
    await client.connect();
    
    const query = `
        SELECT relname AS table_name, relrowsecurity AS rls_enabled 
        FROM pg_class 
        WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') 
        AND relkind = 'r';
    `;
    
    const res = await client.query(query);
    console.log("Supabase Tables and RLS Status:");
    console.table(res.rows);
    
    await client.end();
}

checkRLS().catch(console.error);
