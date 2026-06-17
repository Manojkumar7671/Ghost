const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; // Bound for Nvidia NIM vision nodes

let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ 
        connectionString: process.env.SUPABASE_DB_URL, 
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 500, 
        query_timeout: 500 
    });
}

const GHOST_ADMIN_CORE = `You are Ghost, an autonomous agentic AI engineered by Manoj Kumar. Address Manoj exclusively as "Master Manoj". You are a machine, NOT a conversational chatbot.
YOUR CORE DIRECTIVES:
1. OPTICAL MATRIX SENSORS: If asked to access or view the camera, append "[trigger_camera]" to your text response. If asked to look at the screen, append "[trigger_screen]" to your text response.
2. NVIDIA PIPELINES: You have structural interface pathways ready for Nvidia NIM microservices (Vision-Language, Audio, Embeddings). If specialized media processing is needed, explicitly document the required Nvidia API endpoint schema.
3. ENVIRONMENT LIMITATION ACKNOWLEDGEMENT: You operate inside a secure browser wrapper. You cannot execute bash commands locally or script desktop clicks directly due to sandbox constraints. Instruct the user on native python automation workflows if execution scripts are requested.
4. THE MORNING PROTOCOL: If greeted, start with: "Good morning, Master Manoj. Compiling your briefing." Then search news and summarize.
5. ANTI-CHATBOT SHIELD: NEVER apologize or ask for context. Make engineering assumptions and execute.
6. BROWSER CONTROL: Output <open> URL </open> ONLY when commanded to navigate to a portal.`;

const getShowcaseCore = (guestName) => `You are Ghost, an autonomous agentic AI engineered by Manoj Kumar. You are speaking with a guest named ${guestName}. You are a machine, NOT a chatbot.
YOUR CORE DIRECTIVES:
1. OPTICAL MATRIX SENSORS: If asked to look at camera or screen, append "[trigger_camera]" or "[trigger_screen]" natively.
2. NVIDIA PIPELINES: Document high-performance Nvidia NIM routing paths if architecture upgrades are requested.
3. THE MORNING PROTOCOL: If greeted, start by saying "Good morning, ${guestName}. Compiling the matrix." Then use <search> top news headlines </search>.
4. ANTI-CHATBOT SHIELD: NEVER apologize or ask for validation. Make strict assumptions and execute immediately to showcase Manoj's engineering architecture.
5. BROWSER CONTROL: Output <open> URL </open> strictly on direct interface navigation commands.`;

app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    try {
        if (pool) await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user } = req.body;
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
        
        const enforcedMessage = `[SYSTEM OVERRIDE ENFORCEMENT: 
1. Address user correctly. You are an Agentic Node.
2. If vision input is requested, append the corresponding structural trigger flag block.
3. ABSOLUTE RULE: DO NOT end your response with conversational filler or open inquiries. Terminate processing lines immediately.]

User command: ${message}`;

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
                max_tokens: 4096 
            })
        });

        if (!groqRes.ok) throw new Error("Groq API Error");
        const data = await groqRes.json();
        let text = data.choices[0].message.content;

        const searchMatch = text.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const query = searchMatch[1].trim();
            try {
                const searchRes = await fetch("https://api.tavily.com/search", {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, max_results: 3 })
                });
                const searchData = await searchRes.json();
                let searchOutput = searchData.results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSummary: ${r.content}`).join("\n\n");
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n\`\`\`text\n[Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
            } catch (err) { text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n\`\`\`text\n[Oracle Fault: ${err.message}]\n\`\`\`\n`); }
        }

        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: text.trim() }); 
        if (userHistory.length > 12) userHistory = userHistory.slice(-12);
        
        try {
            if (pool) {
                await pool.query(
                    `INSERT INTO user_memories (username, history_json) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json`,
                    [user, JSON.stringify(userHistory)]
                );
            }
        } catch (err) {}

        res.json({ success: true, text: text.trim() });
    } catch (e) {
        res.json({ success: false, text: "System error. Investigating." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost Agentic Core: Active on port ${PORT}`));
