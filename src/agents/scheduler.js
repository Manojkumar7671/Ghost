const cron = require('node-cron');
const chokidar = require('chokidar');
const { chat } = require('../tools/llm');
const { searchWeb } = require('./webAgent');
const { remember } = require('../tools/memory');
const fs = require('fs-extra');
const path = require('path');
const { Pool } = require('pg');

let pool = null;
if (process.env.SUPABASE_DB_URL) {
  pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: (process.env.SUPABASE_DB_URL.includes('localhost') || process.env.SUPABASE_DB_URL.includes('127.0.0.1')) ? false : { rejectUnauthorized: false },
    max: 2
  });
}

const jobs = new Map();
const watchers = new Map();

// Registry of persisted task types
const taskRegistry = {
  'generateBriefing': async () => {
    return await generateBriefing();
  }
};

async function scheduleTask(id, cronExpr, fnOrType, label = '') {
  if (jobs.has(id)) jobs.get(id).destroy();
  
  let taskType = 'custom';
  let fn = fnOrType;
  if (typeof fnOrType === 'string') {
    taskType = fnOrType;
    fn = taskRegistry[fnOrType];
  } else if (fnOrType === generateBriefing) {
    taskType = 'generateBriefing';
  }

  if (!fn) {
    console.error(`[Scheduler] Unknown task type: ${taskType}`);
    return { error: 'Unknown task type' };
  }

  const job = cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Running: ${label || id}`);
    try { await fn(); } catch (err) { console.error(`[Scheduler] Error:`, err.message); }
  });
  jobs.set(id, job);
  
  // Persist to Supabase
  if (pool && taskType !== 'custom') {
    try {
      await pool.query(
        `INSERT INTO scheduled_jobs (id, cron_expr, task_type, label, active) 
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (id) DO UPDATE SET 
         cron_expr = EXCLUDED.cron_expr, 
         task_type = EXCLUDED.task_type, 
         label = EXCLUDED.label, 
         active = true,
         updated_at = NOW()`,
        [id, cronExpr, taskType, label]
      );
    } catch (err) {
      console.error(`[Scheduler DB Save Error]:`, err.message);
    }
  }

  return { id, cron: cronExpr, label };
}

async function cancelTask(id) {
  if (jobs.has(id)) { 
    jobs.get(id).destroy(); 
    jobs.delete(id); 
    
    if (pool) {
      try {
        await pool.query(`DELETE FROM scheduled_jobs WHERE id = $1`, [id]);
      } catch (err) {
        console.error(`[Scheduler DB Delete Error]:`, err.message);
      }
    }
    return { success: true }; 
  }
  return { error: 'Not found' };
}

async function loadPersistedTasks() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id VARCHAR(255) PRIMARY KEY,
        cron_expr TEXT NOT NULL,
        task_type TEXT NOT NULL,
        label TEXT,
        active BOOLEAN DEFAULT true,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    const res = await pool.query(`SELECT * FROM scheduled_jobs WHERE active = true`);
    for (const row of res.rows) {
      console.log(`[Scheduler] Restoring persisted task: ${row.id} (${row.cron_expr})`);
      await scheduleTask(row.id, row.cron_expr, row.task_type, row.label);
    }
  } catch (err) {
    console.error(`[Scheduler DB Load Error]:`, err.message);
  }
}

// Auto-load on startup
if (pool) {
  loadPersistedTasks();
}

function listTasks() { return Array.from(jobs.keys()).map(id => ({ id, active: true })); }

async function generateBriefing() {
  const topics = ['AI news today', 'tech startups India today', 'remote work opportunities'];
  const results = await Promise.allSettled(topics.map(t => searchWeb(t)));
  const snippets = results.filter(r => r.status === 'fulfilled').map((r, i) => `${topics[i]}: ${r.value.summary}`).join('\n\n');
  const briefing = await chat([{ role: 'user', content: `Morning briefing:\n${snippets}` }], { systemPrompt: 'Create a sharp morning briefing for Manoj, a CS student and entrepreneur in Andhra Pradesh.' });
  remember('last_briefing', { content: briefing, ts: new Date().toISOString() });
  return briefing;
}
function startDailyBriefing() {
  scheduleTask('daily_briefing', '0 23 * * *', 'generateBriefing', 'Daily Briefing 4:30AM IST');
  console.log('[Ghost] Daily briefing scheduled at 4:30 AM IST');
}

function watchFolder(folderPath, onFile) {
  if (watchers.has(folderPath)) return { error: 'Already watching' };
  const watcher = chokidar.watch(folderPath, { ignored: /(^|[\/\\])\./, persistent: true, ignoreInitial: true });
  watcher.on('add', async (filePath) => {
    const content = await fs.readFile(filePath, 'utf-8').catch(() => '[binary]');
    const analysis = await chat([{ role: 'user', content: `New file: ${filePath}\n${content.slice(0, 1000)}` }], { systemPrompt: 'Analyze new files and provide insights.' });
    onFile && onFile({ filePath, analysis });
  });
  watchers.set(folderPath, watcher);
  return { success: true, watching: folderPath };
}
function stopWatcher(folderPath) {
  if (watchers.has(folderPath)) { watchers.get(folderPath).close(); watchers.delete(folderPath); return { success: true }; }
  return { error: 'Not watching' };
}
module.exports = { scheduleTask, cancelTask, listTasks, generateBriefing, startDailyBriefing, watchFolder, stopWatcher };
