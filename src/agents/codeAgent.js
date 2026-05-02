const Groq = require("groq-sdk");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class CodeAgent {
  async run(task, context = []) {
    const contextStr = context.length ? `Previous results:\n${JSON.stringify(context)}\n\n` : "";
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: 'Write code. Respond ONLY with JSON: {"language":"python"|"javascript","code":"...","filename":"script.py"}' },
        { role: "user", content: `${contextStr}Task: ${task}` }
      ],
      temperature: 0.2,
    });
    let parsed;
    try { parsed = JSON.parse(res.choices[0].message.content.replace(/```json|```/g, "").trim()); }
    catch { return { error: "Parse failed" }; }
    const tmpDir = "/tmp/ghost_code";
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, parsed.filename);
    fs.writeFileSync(filePath, parsed.code);
    try {
      const cmd = parsed.language === "python" ? `python3 ${filePath}` : `node ${filePath}`;
      const output = execSync(cmd, { timeout: 15000 }).toString();
      return { success: true, output, code: parsed.code };
    } catch (err) {
      return { success: false, error: err.message, code: parsed.code };
    }
  }
}
module.exports = CodeAgent;
