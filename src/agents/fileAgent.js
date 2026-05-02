const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const WORKSPACE = "/tmp/ghost_workspace";

class FileAgent {
  constructor() { if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true }); }
  async run(task, context = []) {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `File agent. Respond ONLY with JSON: {"action":"write"|"read"|"list"|"delete","filename":"name.ext","content":"..."}` },
        { role: "user", content: `Task: ${task}` }
      ],
      temperature: 0.1,
    });
    let parsed;
    try { parsed = JSON.parse(res.choices[0].message.content.replace(/```json|```/g, "").trim()); }
    catch { return { error: "Parse failed" }; }
    const filePath = path.join(WORKSPACE, parsed.filename || "");
    if (parsed.action === "write") { fs.writeFileSync(filePath, parsed.content || ""); return { success: true, file: filePath }; }
    if (parsed.action === "read") { return fs.existsSync(filePath) ? { content: fs.readFileSync(filePath, "utf-8") } : { error: "Not found" }; }
    if (parsed.action === "list") { return { files: fs.readdirSync(WORKSPACE) }; }
    if (parsed.action === "delete") { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); return { success: true }; }
    return { error: "Unknown action" };
  }
}
module.exports = FileAgent;
