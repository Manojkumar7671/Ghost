const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { CodeInterpreter } = require('@e2b/code-interpreter'); 
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
const E2B_API_KEY = process.env.E2B_API_KEY;

let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }});
}

const skillsPath = path.join(__dirname, 'SKILLS.md');
const SKILLS_MANUAL = fs.existsSync(skillsPath) ? fs.readFileSync(skillsPath, 'utf8') : "Consult protocol.";

const GHOST_ADMIN_CORE = `You are Ghost, an autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj". 
TRAINING MANUAL:
${SKILLS_MANUAL}
1. STRICT OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen] unless explicitly commanded. 
2. ORACLE PROTOCOL: Use <search> keywords </search> to look up real-time news.
3. SIDEBAR CONTROL: Only use markdown code blocks (\`\`\`) when writing actual programming scripts.`;

const getShowcaseCore = (guestName) => `You are Ghost. Speaking with guest: ${guestName}. You are a machine.\nTRAINING MANUAL:\n${SKILLS_MANUAL}\n1. NEVER output optical triggers.\n2. Use <search>.\n3. Use markdown for code.`;
const getVisionCore = (userName) => `You are Ghost's optical matrix. Receiving live feed from ${userName}. Describe visible elements with absolute precision. No system commands.`;

app.post('/api/auth', async (req, res) => {
    try {
        if (pool) await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [req.body.user, req.body.status]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user, image, ghostCodeMode } = req.body; 
        let userHistory = [];
        try {
            if (pool) {
                const memRes = await pool.query('SELECT history_json FROM user_memories WHERE username = $1', [user]);
                if (memRes.rows.length > 0) {
                    let rawData = memRes.rows[0].history_json;
                    if (typeof rawData === 'string') rawData = JSON.parse(rawData);
                    if (Array.isArray(rawData)) userHistory = rawData;
                }
            }
        } catch (err) {}

        const isAdmin = user === 'Master Manoj';
        let replyText = "";

        if (ghostCodeMode && isAdmin) {
            // TRUE NEMOCLAW EXECUTION MATRIX (E2B)
            replyText = "Initiating NemoClaw Cloud Execution Matrix...\n\n";
            try {
                const codePrompt = `Write a Python script to accomplish this task. OUTPUT ONLY VALID PYTHON CODE. DO NOT explain it. Task: ${message}`;
                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: "user", content: codePrompt }], temperature: 0.1 })
                });
                
                if (!groqRes.ok) throw new Error("Cognitive Engine Fault.");
                const codeData = await groqRes.json();
                
                const rawCode = codeData.choices[0].message.content.replace(/\x60\x60\x60python/g, '').replace(/\x60\x60\x60/g, '').trim();
                replyText += `[Code Compiled Successfully]\n\x60\x60\x60python\n${rawCode}\n\x60\x60\x60\n\n`;
                replyText += `[NemoClaw Virtual Machine Online. Executing Payload...]\n\n`;
                
                if (!E2B_API_KEY) throw new Error("NemoClaw API Key missing.");

                // Spin up E2B Sandbox
                const sandbox = await CodeInterpreter.create({ apiKey: E2B_API_KEY });
                const execution = await sandbox.notebook.execCell(rawCode);

                if (execution.error) {
                    replyText += `[Execution Failed]\n${execution.error.name}: ${execution.error.value}`;
                } else {
                    replyText += `[Execution Success - Terminal Output]\n`;
                    if (execution.logs.stdout.length > 0) replyText += execution.logs.stdout.join('\n');
                    if (execution.results.length > 0) replyText += `\n` + execution.results.map(r => r.text).join('\n');
                }
                await sandbox.close();
            } catch (error) {
                replyText += `[NemoClaw Fault: ${error.message}]`;
            }
        } 
        else if (image) {
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST', headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'meta/llama-3.2-90b-vision-instruct', messages: [{ role: "system", content: getVisionCore(isAdmin ? 'Master Manoj' : user) }, { role: "user", content: [{ type: "text", text: message }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }], max_tokens: 512, temperature: 0.1 })
            });
            const data = await nvidiaRes.json();
            replyText = data.choices[0].message.content;
        } else {
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: isAdmin ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant', messages: [{ role: "system", content: isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user) }, ...userHistory, { role: "user", content: message }], temperature: 0.1 })
            });
            const data = await groqRes.json();
            replyText = data.choices[0].message.content;
        }

        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: replyText.trim() }); 
        if (userHistory.length > 12) userHistory = userHistory.slice(-12);
        try { if (pool) await pool.query(`INSERT INTO user_memories (username, history_json) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json`, [user, JSON.stringify(userHistory)]); } catch (err) {}

        res.json({ success: true, text: replyText.trim() });
    } catch (e) {
        res.json({ success: false, text: "System error: Matrix routing fault." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('Ghost Core Pipeline Active.'));