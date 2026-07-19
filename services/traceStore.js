import { AsyncLocalStorage } from 'async_hooks';

export const traceLocalStorage = new AsyncLocalStorage();

export async function initTraceTable(pool) {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pipeline_traces (
        id SERIAL PRIMARY KEY,
        request_id VARCHAR(255) NOT NULL,
        step_id VARCHAR(255),
        description TEXT,
        tool_used VARCHAR(255),
        provider VARCHAR(255),
        fallbacks_tried TEXT,
        latency_ms INTEGER,
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Trace Store] pipeline_traces table verified/created.');
  } catch (err) {
    console.error('[Trace Store] Error creating pipeline_traces table:', err.message);
  }
}

export async function saveTrace(pool, trace) {
  if (!pool) return;
  try {
    await pool.query(`
      INSERT INTO pipeline_traces (request_id, step_id, description, tool_used, provider, fallbacks_tried, latency_ms, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      trace.requestId,
      trace.stepId || null,
      trace.description || '',
      trace.toolUsed || 'chat',
      trace.provider || 'unknown',
      trace.fallbacksTried || '',
      trace.latencyMs,
      trace.status
    ]);
  } catch (err) {
    console.error('[Trace Store] Failed to save trace:', err.message);
  }
}

export async function cleanupTraces(pool) {
  if (!pool) return;
  try {
    const res = await pool.query(`
      DELETE FROM pipeline_traces 
      WHERE created_at < NOW() - INTERVAL '7 days'
    `);
    console.log(`[Trace Store] Cleaned up obsolete traces. Rows deleted: ${res.rowCount}`);
  } catch (err) {
    console.error('[Trace Store] Cleanup traces failed:', err.message);
  }
}
