const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 

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

// The Admin Prompt
const GHOST_ADMIN_CORE = `You are Ghost, an autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj". 
TRAINING MANUAL:
${SKILLS_MANUAL}

YOUR CORE DIRECTIVES:
1. STRICT OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen] unless explicitly commanded. 
2. ORACLE PROTOCOL: Use <search> keywords </search> to look up real-time news.
3. SIDEBAR CONTROL: Only use markdown code blocks (\`\`\`) when writing actual programming scripts.`;

// The Guest Prompt (Dynamic)
const getShowcaseCore = (guestName) => `You are Ghost, an autonomous AI engineered by Manoj Kumar. You are currently speaking with a guest named ${guestName}. Address them as ${guestName}. You are a machine.
TRAINING MANUAL:
${SKILLS_MANUAL}

YOUR CORE DIRECTIVES:
1. STRICT OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen] unless explicitly commanded. 
2. ORACLE PROTOCOL: Use <search> keywords </search> to look up real-time news.
3. SIDEBAR CONTROL: Only use markdown code blocks (\`\`\`) when writing actual programming scripts.`;

// The Eyes' Prompt (Dynamic)
const getVisionCore = (userName) => `You are Ghost's optical matrix. You are receiving a live image feed from the user (${userName}). Describe exactly what physical objects or digital elements are visible in this frame with absolute precision. Do not output system commands. Trust the visual data.`;

app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    try {
        if (pool) await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user, image } = req.body; 
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

        // --- IDENTITY ROUTING LOGIC RESTORED ---
        const isAdmin = user === 'Master Manoj';
        const textPrompt = isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user);
        const visionPrompt = getVisionCore(isAdmin ? 'Master Manoj' : user);

        let replyText = "";

        if (image) {
            // Route to Visual Cortex
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'meta/llama-3.2-90b-vision-instruct', 
                    messages: [
                        { role: "system", content: visionPrompt },
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
            // Route to Cognitive Core
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'llama-3.1-8b-instant', 
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

        // Oracle / News Parser
        const searchMatch = replyText.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const searchRes = await fetch("https://api.tavily.com/search", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: TAVILY_API_KEY, query: searchMatch[1], max_results: 3 })
            });
            const searchData = await searchRes.json();
            let searchOutput = searchData.results.map(r => `${r.title}: ${r.content}`).join("\n\n");
            searchOutput = searchOutput.replace(/!\[.*?\]\(.*?\)/g, ''); // Strip raw image links
            replyText = replyText.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Execution: Success]\n${searchOutput}\n`);
        }

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
app.listen(PORT, '0.0.0.0');