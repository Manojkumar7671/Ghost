const fs = require("fs");
const path = require("path");
const WORKSPACE = "/tmp/ghost_workspace";
class FileAgent {
  constructor() { if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true }); }
  async run(task) {
    const lower = task.toLowerCase();
    if (lower.includes("write") || lower.includes("create") || lower.includes("save")) {
      const match = task.match(/(?:write|create|save)\s+(\S+)\s+(?:with\s+)?(.+)/is);
      if (match) {
        const filePath = path.join(WORKSPACE, match[1]);
        fs.writeFileSync(filePath, match[2]);
        return { success: true, file: filePath };
      }
    }
    if (lower.includes("read")) {
      const match = task.match(/read\s+(\S+)/i);
      if (match) {
        const filePath = path.join(WORKSPACE, match[1]);
        return fs.existsSync(filePath) ? { content: fs.readFileSync(filePath, "utf-8") } : { error: "Not found" };
      }
    }
    if (lower.includes("list")) { return { files: fs.readdirSync(WORKSPACE) }; }
    return { error: "Unknown file action" };
  }
}
module.exports = FileAgent;
