const express = require('express');
const path = require('path');
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

const GHOST_ADMIN_CORE = `You are Ghost, an autonomous AI engineered by Manoj Kumar. Address Manoj exclusively as "Master Manoj". You are a machine.
YOUR CORE DIRECTIVES:
1. THE CAMERA COMMAND: If the user says "turn on camera", "look at this", or "open camera", output EXACTLY this text and nothing else: "[trigger_camera] Optical sensors active." DO NOT write Python code. DO NOT use markdown code blocks.
2. THE SCREEN COMMAND: If the user says "share screen" or "turn on screen sharing", output EXACTLY: "[trigger_screen] Screen capture active." DO NOT write mock terminal text or scripts.
3. THE MORNING PROTOCOL: If greeted with "good morning", say "Good morning, Master Manoj. Compiling your briefing." Then use <search> top global news headlines </search>.
4. SIDEBAR CONTROL: NEVER use markdown code blocks (\`\`\`) UNLESS the user explicitly asks you to write a programming script (like HTML, Python, or JS). 
5. NO HALLUCINATIONS: If asked "what do you see?" before the camera is on, just activate the camera. Do not guess.`;

const getShowcaseCore = (guestName) => `You are Ghost, an autonomous AI engineered by Manoj Kumar. You are speaking with ${guestName}. You are a machine.
YOUR CORE DIRECTIVES:
1. THE CAMERA COMMAND: If told to turn on camera, output EXACTLY: "[trigger_camera] Optical sensors active." DO NOT write code.
2. THE SCREEN COMMAND: If told to share screen, output EXACTLY: "[trigger_screen] Screen capture active." DO NOT write code.
3. SIDEBAR CONTROL: NEVER use markdown code blocks (\`\`\`) unless explicitly asked to write a script.`;

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

        const isAdmin = user === 'Master Manoj';
        const systemPrompt = isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user);
        
        let replyText = "";

        if (image) {
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${NVIDIA_API_KEY}`, 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ 
                    model: 'meta/llama-3.2-90b-vision-instruct', 
                    messages: [
                        { role: "system", content: systemPrompt },
                        { 
                            role: "user", 
                            content: [
                                { type: "text", text: message || "Analyze this matrix capture input." },
                                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }
                            ]
                        }
                    ],
                    max_tokens: 512,
                    temperature: 0.15
                })
            });

            if (!nvidiaRes.ok) throw new Error("NVIDIA Vision Pipeline Fault");
            const nvidiaData = await nvidiaRes.json();
            replyText = nvidiaData.choices[0].message.content;

        } else {
            const enforcedMessage = `[SYSTEM NOTE: Follow your core directives exactly. No conversational filler.]\n\nUser command: ${message}`;

            let formattedMessages = [
                { role: "system", content: systemPrompt },
                ...userHistory, 
                { role: "user", content: enforcedMessage }
            ];

            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'llama-3.1-8b-instant', 
                    messages: formattedMessages, 
                    temperature: 0.15,
                    max_tokens: 2048 
                })
            });

            if (!groqRes.ok) throw new Error("Groq Engine Fault");
            const data = await groqRes.json();
            replyText = data.choices[0].message.content;
        }

        // Search Parsing & Image Link Stripper
        const searchMatch = replyText.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const query = searchMatch[1].trim();
            try {
                const searchRes = await fetch("https://api.tavily.com/search", {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, max_results: 3 })
                });
                const searchData = await searchRes.json();
                let searchOutput = searchData.results.map(r => `Title: ${r.title}\nSummary: ${r.content}`).join("\n\n");
                
                // Strip raw markdown images so the UI stays clean
                searchOutput = searchOutput.replace(/!\[.*?\]\(.*?\)/g, '');
                
                replyText = replyText.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Execution: Success]\n\n${searchOutput}\n`);
            } catch (err) { replyText = replyText.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Fault: ${err.message}]\n`); }
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
        res.json({ success: false, text: "System error down within optical routing sub-modules." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost Core Pipeline Active.`));