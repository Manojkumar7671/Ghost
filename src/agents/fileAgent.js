const fs = require("fs");
const path = require("path");
const { chat } = require("../tools/llm");
const WORKSPACE = "/tmp/ghost_workspace";

class FileAgent {
  constructor() { if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true }); }
  
  async run(task) {
    const lower = task.toLowerCase();
    
    if (lower.includes("read")) {
      const match = task.match(/read\s+(\S+)/i);
      if (match) {
        const filePath = path.join(WORKSPACE, match[1]);
        return fs.existsSync(filePath) ? { content: fs.readFileSync(filePath, "utf-8") } : { error: "Not found" };
      }
    }
    
    if (lower.includes("list")) { return { files: fs.readdirSync(WORKSPACE) }; }
    
    // Default to generate/write a file
    const prompt = `You are the File Agent. Your job is to create files based on the user's task.
Task: ${task}
Please generate the required content and provide a suitable filename.
Respond ONLY with a JSON object in this format: {"filename": "example.html", "content": "..."}`;
    
    const res = await chat([{ role: "user", content: prompt }], { maxTokens: 1000 });
    try {
      const parsed = JSON.parse(res.replace(/```json|```/g, "").trim());
      if (parsed.filename && parsed.content) {
        const filePath = path.join(WORKSPACE, parsed.filename.replace(/[^a-zA-Z0-9_.-]/g, ""));
        fs.writeFileSync(filePath, parsed.content);
        return { success: true, file: filePath, content: parsed.content };
      }
    } catch (e) {
      return { error: "Failed to generate file", output: res };
    }
    
    return { error: "Unknown file action" };
  }
}
module.exports = FileAgent;
