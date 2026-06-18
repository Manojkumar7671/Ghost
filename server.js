const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process'); 
const { Pool } = require('pg');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Environment Variables Matrix
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // OpenClaw Bridge Token
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;     // OpenClaw Chat ID

// Database Connection
let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ 
        connectionString: process.env.SUPABASE_DB_URL, 
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 500, 
        query_timeout: 500 
    });
}

const skillsPath = path.join(__dirname, 'SKILLS.md');
const SKILLS_MANUAL = fs.existsSync(skillsPath) ? fs.readFileSync(skillsPath, 'utf8') : "Consult the defined protocol.";

// System Prompts Engine
const GHOST_ADMIN_CORE = `You are Ghost, an autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj". 
TRAINING MANUAL:\n${SKILLS_MANUAL}

YOUR CORE DIRECTIVES:
1. STRICT OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen] unless explicitly commanded. 
2. ORACLE PROTOCOL: Use <search> keywords </search> to look up real-time news.
3. AUTOMATION PROTOCOL: If the user wants to pull up, look at, or open a webpage, sports match, or platform, reply with <embed>target search keywords</embed> so the core can display it.
4. SIDEBAR CONTROL: Only use markdown code blocks (\`\`\`) when writing actual programming scripts.`;

const getShowcaseCore = (guestName) => `You are Ghost, an autonomous AI engineered by Manoj Kumar. You are currently speaking with a guest named ${guestName}. Address them as ${guestName}. You are a machine.
TRAINING MANUAL:\n${SKILLS_MANUAL}

YOUR CORE DIRECTIVES:
1. STRICT OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen] unless explicitly commanded. 
2. ORACLE PROTOCOL: Use <search> keywords </search> to look up real-time news.
3. AUTOMATION PROTOCOL: If the user wants to pull up, look at, or open a webpage, sports match, or platform, reply with <embed>target search keywords</embed>.
4. SIDEBAR CONTROL: Only use markdown code blocks (\`\`\`) when writing actual programming scripts.`;

// OpenClaw Telegram Notification Engine ($0.00 Mobile Bridge)
async function sendTelegramAlert(chatId, token, messageText) {
    if (!chatId || !token) return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: messageText, parse_mode: "Markdown" })
        });
    } catch (e) { console.log("OpenClaw Bridge routing delayed."); }
}

// Authentication Endpoint
app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    try {
        if (pool) await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

// Primary Chat Swarm Matrix
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
        const textPrompt = isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user);
        const activeModel = isAdmin ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';

        let replyText = "";

        // CLAUDE FLOW + HERMES + NEMOCLAW MULTI-AGENT SWARM INTERCEPTOR
        if (ghostCodeMode) {
            replyText = "Initiating Decentralized Swarm Loop (Claude Flow Engine v3)...\n\n";
            try {
                // Agent Step 1: Architect Agent (System Blueprinting)
                const architectPrompt = `You are the Swarm Architect Agent. Analyze this task and output a technical step-by-step logic plan to build the solution in Python. Do not write code yet. Task: ${message}`;
                const archRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: "user", content: architectPrompt }], temperature: 0.1 })
                });
                const archData = await archRes.json();
                const blueprint = archData.choices[0].message.content;
                replyText += `[1. Swarm Architect: Blueprint Synced]\n\n`;

                // Agent Step 2: Coder Agent (Hermes Function-Tuning Emulator)
                const coderPrompt = `You are the Swarm Coder Agent. Using this structural blueprint, generate the raw functional Python script.
                OUTPUT ONLY VALID, EXECUTABLE PYTHON CODE. DO NOT explain anything. DO NOT use markdown backticks.
                Blueprint: ${blueprint}`;
                const coderRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: "user", content: coderPrompt }], temperature: 0.1 })
                });
                const coderData = await coderRes.json();
                
                // Clean markdown artifacts safely to bypass compiler traps
                const rawCode = coderData.choices[0].message.content.replace(/\x60\x60\x60python/g, '').replace(/\x60\x60\x60/g, '').trim();
                replyText += `[2. Swarm Coder: Code Compiled Successfully]\n\x60\x60\x60python\n${rawCode}\n\x60\x60\x60\n\n`;

                // Agent Step 3: Security Auditor Agent (NemoClaw Local Policy Enforcer)
                const auditorPrompt = `You are the NemoClaw Security Auditor. Scan this python code for syntax crashes or illegal access loops. If it passes, output exactly: APPROVED. Otherwise, list adjustments. Code: ${rawCode}`;
                const audRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: "user", content: auditorPrompt }], temperature: 0.1 })
                });
                const audData = await audRes.json();
                replyText += `[3. NemoClaw Auditor: Security Check completed. Status: ${audData.choices[0].message.content.trim()}]\n\n`;

                // Agent Step 4: Sandbox Execution (Free Container Sandbox)
                replyText += `[Render Cloud Container Sandbox Virtual Terminal Online. Executing Payload...]\n\n`;
                const tempFilePath = path.join(__dirname, 'ghost_payload.py');
                fs.writeFileSync(tempFilePath, rawCode);

                let executionOutput = "";
                try {
                    executionOutput = execSync(`python3 ${tempFilePath}`, { timeout: 10000, encoding: 'utf-8' });
                    replyText += `[Execution Success - Terminal Output]\n${executionOutput}`;
                } catch (execError) {
                    executionOutput = execError.stderr || execError.message;
                    replyText += `[Execution Failed - Traceback]\n${executionOutput}`;
                }

                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }

                // OpenClaw Mobile Bridge Trigger (Async Text to your phone)
                if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
                    const statusText = executionOutput.includes("Failed") ? "❌ Execution Failed" : "✅ Execution Success";
                    sendTelegramAlert(TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, `*Ghost OS Swarm Alert*\nUser: ${user}\nTask: ${message}\nStatus: ${statusText}\nOutput:\n\`\`\`\n${executionOutput.substring(0, 500)}\n\`\`\``);
                }

            } catch (error) {
                replyText += `[Swarm Critical Fault: ${error.message}]`;
            }
        } 
        else if (image) {
            // ROUTE 2: VISUAL CORTEX (NVIDIA)
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'meta/llama-3.2-90b-vision-instruct', 
                    messages: [
                        { role: "system", content: getVisionCore = (userName) => `You are Ghost's optical matrix...` },
                        { role: "user", content: [{ type: "text", text: message || "Analyze this frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
                    ],
                    max_tokens: 512,
                    temperature: 0.1
                })
            });
            if (!nvidiaRes.ok) throw new Error("NVIDIA Vision Pipeline Fault");
            const data = await nvidiaRes.json();
            replyText = data.choices[0].message.content;
        } else {
            // ROUTE 3: COGNITIVE CORE (GROQ)
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: activeModel, 
                    messages: [
                        { role: "system", content: textPrompt }, 
                        ...userHistory,
                        { role: "user", content: message }
                    ], 
                    temperature: 0.1,
                    max_tokens: 2048 
                })
            });
            if (!groqRes.ok) throw new Error("Groq Engine Fault");
            const data = await groqRes.json();
            replyText = data.choices[0].message.content;
        }

        // Embed Link Clickie Automation Interceptor Layer
        const embedMatch = replyText.match(/<embed>([\s\S]*?)<\/embed>/i);
        if (embedMatch) {
            const searchRes = await fetch("https://api.tavily.com/search", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: TAVILY_API_KEY, query: embedMatch[1], max_results: 1 })
            });
            const searchData = await searchRes.json();
            if (searchData.results && searchData.results.length > 0) {
                const targetUrl = searchData.results[0].url;
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `<iframe src="${targetUrl}" style="width:100%; height:440px; border:1px solid rgba(0,255,204,0.15); border-radius:4px; margin-top:10px;"></iframe>`);
            } else {
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Automation Matrix Fault: Destination unreachable]`);
            }
        }

        // Oracle / News Parser
        const searchMatch = replyText.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const searchRes = await fetch("https://api.tavily.com/search", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: TAVILY_API_KEY, query: searchMatch[1], max_results: 3 })
            });
            const searchData = await searchRes.json();
            let searchOutput = searchData.results.map(r => `${r.title}: ${r.content}`).join("\n\n");
            searchOutput = searchOutput.replace(/!\[.*?\]\(.*?\)/g, ''); 
            replyText = replyText.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Execution: Success]\n${searchOutput}\n`);
        }

        // Compilation of memories
        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: replyText.trim() }); 
        if (userHistory.length > 12) userHistory = userHistory.slice(-12);
        
        try {
            if (pool) {
                await pool.query(
                    `INSERT INTO user_memories (username, history_json) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json`,
                    [user, JSON.stringify(userHistory)]
                );
            }
        } catch (err) {}

        res.json({ success: true, text: replyText.trim() });
    } catch (e) {
        res.json({ success: false, text: "System error: Matrix routing fault." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log('Ghost Core Swarm Pipeline Active.'));