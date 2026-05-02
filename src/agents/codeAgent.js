const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TMP = "/tmp/ghost_code";
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

class CodeAgent {
  async run(task, context = [], retries = 3) {
    const contextStr = context.length ? `Previous results:\n${JSON.stringify(context.slice(-3))}\n\n` : "";
    for (let attempt = 1; attempt <= retries; attempt++) {
      const res = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: 'Write working code. Respond ONLY with JSON: {"language":"python"|"javascript","code":"...","filename":"script.py"}. Use only stdlib. No external imports.' },
          { role: "user", content: `${contextStr}Task: ${task}${attempt > 1 ? `\n\nAttempt ${attempt} - fix previous errors` : ""}` }
        ],
        temperature: 0.1,
      });
      let parsed;
      try { parsed = JSON.parse(res.choices[0].message.content.replace(/```json|```/g, "").trim()); }
      catch { continue; }
      const filePath = path.join(TMP, parsed.filename);
      fs.writeFileSync(filePath, parsed.code);
      try {
        const cmd = parsed.language === "python" ? `python3 ${filePath}` : `node ${filePath}`;
        const output = execSync(cmd, { timeout: 20000 }).toString();
        return { success: true, output: output.trim(), code: parsed.code, attempts: attempt };
      } catch (err) {
        if (attempt === retries) return { success: false, error: err.message, code: parsed.code };
      }
    }
    return { success: false, error: "Max retries reached" };
  }
}
module.exports = CodeAgent;
