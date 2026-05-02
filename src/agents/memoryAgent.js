const fs = require("fs");
const path = require("path");

const DB_PATH = "/tmp/ghost_memory.json";

class MemoryAgent {
  constructor() {
    this.data = { memory: {}, history: [] };
    if (fs.existsSync(DB_PATH)) {
      try { this.data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8")); } catch {}
    }
  }

  save() { fs.writeFileSync(DB_PATH, JSON.stringify(this.data)); }

  set(key, value) { this.data.memory[key] = value; this.save(); return { success: true }; }
  get(key) { return this.data.memory[key] || null; }
  delete(key) { delete this.data.memory[key]; this.save(); return { success: true }; }
  list() { return Object.entries(this.data.memory).map(([key, value]) => ({ key, value })); }

  addHistory(role, content) {
    this.data.history.push({ role, content });
    if (this.data.history.length > 100) this.data.history = this.data.history.slice(-100);
    this.save();
  }

  getHistory(limit = 20) { return this.data.history.slice(-limit); }
  clearHistory() { this.data.history = []; this.save(); return { success: true }; }

  async run(task) {
    const lower = task.toLowerCase();
    if (lower.includes("remember") || lower.includes("save")) {
      const match = task.match(/remember that (.+)/i) || task.match(/save (.+)/i);
      if (match) { this.set("note_" + Date.now(), match[1]); return { result: "Saved: " + match[1] }; }
    }
    if (lower.includes("what do you know") || lower.includes("list memory")) {
      const all = this.list();
      return { result: all.length ? JSON.stringify(all) : "No memories stored." };
    }
    if (lower.includes("forget") || lower.includes("clear")) {
      this.data.memory = {}; this.save();
      return { result: "Memory cleared." };
    }
    return { result: "Memory agent ready." };
  }
}

module.exports = MemoryAgent;
