const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chat } = require("../tools/llm");

const TMP = path.join(__dirname, "../../tmp/ghost_code");
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

class CodeAgent {
  async run(task, context = [], retries = 3) {
    const contextStr = context.length ? `Previous results:\n${JSON.stringify(context.slice(-3))}\n\n` : "";
    const attemptErrors = [];
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      const messages = [
        { role: "system", content: `You are Ghost CodeAgent adhering to Karpathy Coding Guidelines:
1. Think Before Coding & Plan: State clear assumptions. Break tasks into surgical steps.
2. Simplicity First: Write minimal, robust, self-contained code. Avoid overcomplication or unrequested abstractions. Do NOT use sed/awk.
3. Surgical Changes & Self-Verification: Touch only what is requested. Ensure files are written cleanly and checked for existence.

Respond with a small JSON block containing action and filename, followed by the actual code in a separate markdown fenced code block (\`\`\`python or \`\`\`javascript). Example:
\`\`\`json
{"action": "execute", "filename": "script.py"}
\`\`\`
\`\`\`python
print("hello")
\`\`\`

Use only stdlib. Environment is macOS. Use python3 instead of python for subprocess calls. If asked to write a script but NOT run it, use "write" action. To perform actions, use "execute" or "write_and_execute". For shell pipes, use shell=True WITH A SINGLE STRING in Python. If a task requires multiple files or steps, write a single script that accomplishes all of them.` },
        { role: "user", content: `${contextStr}Task: ${task}${attempt > 1 ? `\n\nAttempt ${attempt} - fix previous errors:\n${attemptErrors[attemptErrors.length-1]}` : ""}` }
      ];
      
      const res = await chat(messages, { maxTokens: 2000 });

      let parsed = { language: "python", action: "execute", code: "", filename: "script.py" };
      try {
        const jsonMatch = res.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (!jsonMatch) throw new Error("Missing JSON control block");
        
        const controlObj = JSON.parse(jsonMatch[1].trim());
        parsed.action = controlObj.action || "execute";
        parsed.filename = controlObj.filename;
        parsed.language = (controlObj.filename && controlObj.filename.endsWith('.js')) ? 'javascript' : 'python';

        const codeMatch = res.match(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```/g);
        if (!codeMatch || codeMatch.length < 2) {
            throw new Error("Missing code block. You must provide a JSON block AND a separate Code block.");
        } else {
            // The code is in the last matched block
            parsed.code = codeMatch[codeMatch.length - 1].replace(/```(?:[a-zA-Z0-9_-]+)?\n/, "").replace(/```$/, "").trim();
        }
      } catch (err) { 
        console.error("DEBUG RAW RES:", res);
        attemptErrors.push(`Format Parse Error: ${err.message}. Ensure you provide a JSON block AND a Code block.`);
        continue; 
      }

      const isPersistent = parsed.action === "write" || parsed.action === "write_and_execute";
      const filename = parsed.filename || (parsed.language === "python" ? "script.py" : "script.js");
      
      // If persistent, write to cwd using the requested filename. Otherwise use tmp isolation.
      const filePath = isPersistent 
          ? path.join(process.cwd(), filename)
          : path.join(TMP, `${crypto.randomUUID()}_${filename.replace(/[^a-zA-Z0-9_.]/g, "")}`);
          
      fs.writeFileSync(filePath, parsed.code);

      if (parsed.action === "write") {
        return { success: true, output: `Successfully wrote ${filename}`, code: parsed.code, attempts: attempt };
      }

      try {
        let cmd;
        if (filename.endsWith('.sh')) {
            cmd = `bash ${filePath}`;
        } else {
            cmd = parsed.language === "python" ? `python3 ${filePath}` : `node ${filePath}`;
        }
        
        // Asynchronous, non-blocking code execution wrapper with strict timeout limits
        const output = await new Promise((resolve, reject) => {
          exec(cmd, { timeout: 15000, maxBuffer: 1024 * 1024, cwd: process.cwd() }, (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr || error.message));
            } else {
              resolve(stdout);
            }
          });
        });

        // Cleanup only if it was a temporary execution
        if (!isPersistent && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        
        return { success: true, output: output.trim(), code: parsed.code, attempts: attempt };
      } catch (err) {
        attemptErrors.push(`Execution Error: ${err.message}`);
        if (!isPersistent && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (attempt === retries) {
          return { success: false, error: err.message, code: parsed.code, all_errors: attemptErrors };
        }
      }
    }
    return { success: false, error: "Max retries reached", all_errors: attemptErrors };
  }
}

module.exports = CodeAgent;
