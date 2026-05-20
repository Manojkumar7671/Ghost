const fs = require('fs-extra');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '../../memory');
const HISTORY_FILE = path.join(MEMORY_DIR, 'chat_history.json');
const MEMORY_FILE = path.join(MEMORY_DIR, 'persistent.json');
const COST_FILE = path.join(MEMORY_DIR, 'cost_tracker.json');

fs.ensureDirSync(MEMORY_DIR);

function loadHistory() {
  return fs.existsSync(HISTORY_FILE) ? fs.readJsonSync(HISTORY_FILE) : [];
}
function saveMessage(role, content) {
  const history = loadHistory();
  history.push({ role, content, ts: new Date().toISOString() });
  if (history.length > 100) history.splice(0, history.length - 100);
  fs.writeJsonSync(HISTORY_FILE, history, { spaces: 2 });
}
function getHistory(limit = 20) {
  const h = loadHistory();
  return h.slice(-limit).map(m => ({ role: m.role, content: m.content }));
}
function clearHistory() { fs.writeJsonSync(HISTORY_FILE, []); }
function loadMemory() {
  return fs.existsSync(MEMORY_FILE) ? fs.readJsonSync(MEMORY_FILE) : {};
}
function remember(key, value) {
  const mem = loadMemory();
  mem[key] = { value, ts: new Date().toISOString() };
  fs.writeJsonSync(MEMORY_FILE, mem, { spaces: 2 });
}
function recall(key) { return loadMemory()[key]?.value ?? null; }
function forgetKey(key) {
  const mem = loadMemory();
  delete mem[key];
  fs.writeJsonSync(MEMORY_FILE, mem, { spaces: 2 });
}
function allMemory() { return loadMemory(); }
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
module.exports = { saveMessage, getHistory, clearHistory, remember, recall, forgetKey, allMemory, trackCost, getCostSummary };
