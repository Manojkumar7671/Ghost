const fs = require("fs");
const DB = "/tmp/ghost_memory.json";
class MemoryAgent {
  constructor() {
    this.data = { memory: {}, history: [] };
    if (fs.existsSync(DB)) { try { this.data = JSON.parse(fs.readFileSync(DB, "utf-8")); } catch {} }
  }
  save() { try { fs.writeFileSync(DB, JSON.stringify(this.data)); } catch {} }
  set(key, value) { this.data.memory[key] = value; this.save(); return { success: true }; }
  get(key) { return this.data.memory[key] || null; }
  delete(key) { delete this.data.memory[key]; this.save(); return { success: true }; }
  list() { return Object.entries(this.data.memory).map(([k, v]) => ({ key: k, value: v })); }
  addHistory(role, content) {
    this.data.history.push({ role, content });
    if (this.data.history.length > 100) this.data.history = this.data.history.slice(-100);
    this.save();
  }
  getHistory(limit = 20) { return this.data.history.slice(-limit); }
  clearHistory() { this.data.history = []; this.save(); return { success: true }; }
}
module.exports = MemoryAgent;
