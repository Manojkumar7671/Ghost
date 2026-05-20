const cron = require('node-cron');
const chokidar = require('chokidar');
const { chat } = require('../tools/llm');
const { searchWeb } = require('./webAgent');
const { remember } = require('../tools/memory');
const fs = require('fs-extra');
const path = require('path');

const jobs = new Map();
const watchers = new Map();

function scheduleTask(id, cronExpr, fn, label = '') {
  if (jobs.has(id)) jobs.get(id).destroy();
  const job = cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Running: ${label || id}`);
    try { await fn(); } catch (err) { console.error(`[Scheduler] Error:`, err.message); }
  });
  jobs.set(id, job);
  return { id, cron: cronExpr, label };
}
function cancelTask(id) {
  if (jobs.has(id)) { jobs.get(id).destroy(); jobs.delete(id); return { success: true }; }
  return { error: 'Not found' };
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
  scheduleTask('daily_briefing', '0 23 * * *', generateBriefing, 'Daily Briefing 4:30AM IST');
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
