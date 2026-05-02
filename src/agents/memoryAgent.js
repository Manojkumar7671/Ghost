const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.RENDER ? "/tmp/ghost_memory.db" : path.join(process.env.HOME, "ghost_memory.db");

class MemoryAgent {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        value TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        content TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
    `);
  }

  set(key, value) {
    this.db.prepare("INSERT OR REPLACE INTO memory (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
    return { success: true };
  }

  get(key) {
    const row = this.db.prepare("SELECT value FROM memory WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : null;
  }

  delete(key) {
    this.db.prepare("DELETE FROM memory WHERE key = ?").run(key);
    return { success: true };
  }

  list() {
    return this.db.prepare("SELECT key, value FROM memory").all().map(r => ({ key: r.key, value: JSON.parse(r.value) }));
  }

  addHistory(role, content) {
    this.db.prepare("INSERT INTO history (role, content) VALUES (?, ?)").run(role, content);
  }

  getHistory(limit = 20) {
    return this.db.prepare("SELECT role, content FROM history ORDER BY id DESC LIMIT ?").all(limit).reverse();
  }

  clearHistory() {
    this.db.prepare("DELETE FROM history").run();
    return { success: true };
  }

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
    if (lower.includes("forget") || lower.includes("clear memory")) {
      this.db.prepare("DELETE FROM memory").run();
      return { result: "Memory cleared." };
    }
    return { result: "Memory agent ready. Use: remember/save/list memory/forget." };
  }
}

module.exports = MemoryAgent;
