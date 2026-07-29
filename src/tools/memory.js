const fs = require('fs-extra');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '../../memory');
function getMemoryFile(username) {
  const safe = (username || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MEMORY_DIR, `persistent_${safe}.json`);
}
const COST_FILE = path.join(MEMORY_DIR, 'cost_tracker.json');

fs.ensureDirSync(MEMORY_DIR);

function getHistoryFile(username) {
  const safe = (username || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MEMORY_DIR, `chat_history_${safe}.json`);
}

function loadHistory(username) {
  const file = getHistoryFile(username);
  return fs.existsSync(file) ? fs.readJsonSync(file) : [];
}

function saveMessage(username, role, content) {
  const history = loadHistory(username);
  let safeContent = content;
  if (typeof safeContent === 'string' && safeContent.length > 10000) {
    safeContent = safeContent.substring(0, 10000) + '... [TRUNCATED DUE TO SIZE]';
  }
  history.push({ role, content: safeContent, ts: new Date().toISOString() });
  if (history.length > 100) history.splice(0, history.length - 100);
  fs.writeJsonSync(getHistoryFile(username), history, { spaces: 2 });
}

function getHistory(username, limit = 20) {
  const h = loadHistory(username);
  return h.slice(-limit).map(m => ({ role: m.role, content: m.content }));
}

function clearHistory(username) { 
  fs.writeJsonSync(getHistoryFile(username), []); 
}
function loadMemory(username) {
  const file = getMemoryFile(username);
  return fs.existsSync(file) ? fs.readJsonSync(file) : {};
}
function remember(username, key, value) {
  const mem = loadMemory(username);
  mem[key] = { value, ts: new Date().toISOString() };
  fs.writeJsonSync(getMemoryFile(username), mem, { spaces: 2 });
}
function recall(username, key) { return loadMemory(username)[key]?.value ?? null; }
function forgetKey(username, key) {
  const mem = loadMemory(username);
  delete mem[key];
  fs.writeJsonSync(getMemoryFile(username), mem, { spaces: 2 });
}
function allMemory(username) { return loadMemory(username); }
function loadCosts() {
  return fs.existsSync(COST_FILE) ? fs.readJsonSync(COST_FILE) : { total_tokens: 0, total_cost_usd: 0, calls: [] };
}
function trackCost(model, input_tokens, output_tokens) {
  const costs = loadCosts();
  const cost = (input_tokens * 0.00000059) + (output_tokens * 0.00000079);
  costs.total_tokens += (input_tokens + output_tokens);
  costs.total_cost_usd += cost;
  costs.calls.push({ model, input_tokens, output_tokens, cost, ts: new Date().toISOString() });
  if (costs.calls.length > 500) costs.calls.splice(0, costs.calls.length - 500);
  fs.writeJsonSync(COST_FILE, costs, { spaces: 2 });
  return cost;
}
function getCostSummary() {
  const c = loadCosts();
  return { total_tokens: c.total_tokens, total_cost_usd: c.total_cost_usd.toFixed(6), total_calls: c.calls.length, today: c.calls.filter(x => x.ts.startsWith(new Date().toISOString().slice(0, 10))).length };
}

async function saveMemory(entry, metadata) {
  const mem = await import('../../memory.js');
  return mem.saveMemory(entry, metadata);
}

async function queryMemory(query, topK) {
  const mem = await import('../../memory.js');
  return mem.queryMemory(query, topK);
}

module.exports = { saveMessage, getHistory, clearHistory, remember, recall, forgetKey, allMemory, trackCost, getCostSummary, saveMemory, queryMemory };
