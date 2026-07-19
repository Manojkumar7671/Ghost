import assert from 'assert';
import pg from 'pg';
import { initTraceTable, saveTrace, cleanupTraces } from '../services/traceStore.js';
import crypto from 'crypto';

const { Pool } = pg;

async function runTests() {
  console.log('=== STARTING PHASE 5 (OBSERVABILITY) TEST SUITE ===');

  if (!process.env.SUPABASE_DB_URL) {
    console.log('[Test Skip] SUPABASE_DB_URL not set in env. Skipping database trace tests.');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: (process.env.SUPABASE_DB_URL && (process.env.SUPABASE_DB_URL.includes('localhost') || process.env.SUPABASE_DB_URL.includes('127.0.0.1'))) ? false : { rejectUnauthorized: false }
  });

  try {
    // 1. Table Initialization
    console.log('Initializing trace table...');
    await initTraceTable(pool);

    // 2. Save Trace Test
    console.log('Saving mock trace records...');
    const requestId = crypto.randomUUID();
    const trace = {
      requestId,
      stepId: 'test_step_1',
      description: 'Test step description',
      toolUsed: 'web_search',
      provider: 'Groq',
      fallbacksTried: '',
      latencyMs: 120,
      status: 'done'
    };

    await saveTrace(pool, trace);
    console.log('✓ Mock trace saved successfully');

    // 3. Query Trace verification
    console.log('Verifying trace database records...');
    const res = await pool.query('SELECT * FROM pipeline_traces WHERE request_id = $1', [requestId]);
    assert.strictEqual(res.rows.length, 1);
    const row = res.rows[0];
    assert.strictEqual(row.step_id, 'test_step_1');
    assert.strictEqual(row.tool_used, 'web_search');
    assert.strictEqual(row.provider, 'Groq');
    assert.strictEqual(row.latency_ms, 120);
    assert.strictEqual(row.status, 'done');
    console.log('✓ Database assertion checks passed');

    // 4. Trace Cleanup Test
    console.log('Testing rolling 7-day cleanup...');
    // Seed an expired trace
    const expiredRequestId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO pipeline_traces (request_id, step_id, description, tool_used, provider, latency_ms, status, created_at)
      VALUES ($1, 'expired_step', 'Old Trace', 'chat', 'Groq', 100, 'done', NOW() - INTERVAL '8 days')
    `, [expiredRequestId]);

    // Seed a non-expired trace
    const activeRequestId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO pipeline_traces (request_id, step_id, description, tool_used, provider, latency_ms, status, created_at)
      VALUES ($1, 'active_step', 'Recent Trace', 'chat', 'Groq', 100, 'done', NOW() - INTERVAL '6 days')
    `, [activeRequestId]);

    await cleanupTraces(pool);

    const expiredRes = await pool.query('SELECT * FROM pipeline_traces WHERE request_id = $1', [expiredRequestId]);
    const activeRes = await pool.query('SELECT * FROM pipeline_traces WHERE request_id = $1', [activeRequestId]);

    assert.strictEqual(expiredRes.rows.length, 0, 'Expired trace should have been deleted!');
    assert.strictEqual(activeRes.rows.length, 1, 'Active trace should NOT have been deleted!');
    console.log('✓ Cleanup deletes traces older than 7 days, retains recent traces');

    // Clean up our test traces
    await pool.query('DELETE FROM pipeline_traces WHERE request_id IN ($1, $2)', [requestId, activeRequestId]);

    console.log('\n=== ALL PHASE 5 OBSERVABILITY TESTS PASSED ===');
    process.exit(0);
  } finally {
    await pool.end();
  }
}

runTests().catch(e => {
  console.error('Phase 5 Test Suite Failed:', e);
  process.exit(1);
});
