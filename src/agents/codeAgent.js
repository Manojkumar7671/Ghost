const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TMP = path.join(__dirname, "../../tmp/ghost_code");
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
      try { 
        parsed = JSON.parse(res.choices[0].message.content.replace(/```json|```/g, "").trim()); 
      } catch (err) { 
        continue; 
      }

      // Generate a unique isolated filename using a UUID prefix to prevent race conditions during concurrent runs
      const safeFilename = `${crypto.randomUUID()}_${parsed.filename.replace(/[^a-zA-Z0-9_.]/g, "")}`;
      const filePath = path.join(TMP, safeFilename);
      fs.writeFileSync(filePath, parsed.code);

      try {
        const cmd = parsed.language === "python" ? `python3 ${filePath}` : `node ${filePath}`;
        
        // Asynchronous, non-blocking code execution wrapper with strict timeout limits
        const output = await new Promise((resolve, reject) => {
          exec(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr || error.message));
            } else {
              resolve(stdout);
            }
          });
        });

        // Cleanup
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        
        return { success: true, output: output.trim(), code: parsed.code, attempts: attempt };
      } catch (err) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (attempt === retries) {
          return { success: false, error: err.message, code: parsed.code };
        }
      }
    }
    return { success: false, error: "Max retries reached" };
  }
}

module.exports = CodeAgent;
