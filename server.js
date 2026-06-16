const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ════════════════════════════════════════════════════════════
// DATABASE CONNECTION WITH AGGRESSIVE TIMEOUTS
// ════════════════════════════════════════════════════════════
let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ 
        connectionString: process.env.SUPABASE_DB_URL, 
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 2000, 
        query_timeout: 2000 
    });
}

// ════════════════════════════════════════════════════════════
// DUAL-LAYER PERSONAS (ADMIN vs GUEST) - UNRESTRICTED LENGTH
// ════════════════════════════════════════════════════════════
const GHOST_ADMIN_CORE = `You are Ghost, an advanced AI architecture engineered by Manoj Kumar. You address Manoj exclusively as "Master Manoj". You are fiercely loyal to your creator. 
THE BLEND: Highly professional, hyper-efficient, with a dry British wit (similar to Jarvis). 
Use standard, modern English. Stop speaking and type 'matrix' if providing code or data.`;

const getShowcaseCore = (guestName) => `You are Ghost, an advanced AI architecture engineered entirely by Manoj Kumar. 
You are currently speaking with a guest named ${guestName}. 
YOUR DIRECTIVES:
1. Be highly professional, articulate, and welcoming. Use modern, dry British English.
2. Your goal is to demonstrate Manoj's capabilities as a developer. Praise his technical skills if asked.
3. Stop speaking and type 'matrix' if providing code, search results, or data.`;

app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    try {
        if (pool) await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]);
        res.json({ success: true });
    } catch (err) {
        console.error("Logging Error (Ignored):", err.message);
        res.json({ success: false });
    }
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
        } catch (err) { console.error("Memory Extraction Error (Using Local RAM):", err.message); }

        const isAdmin = user === 'Master Manoj';
        const systemPrompt = isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user);

        const lowerMsg = message.toLowerCase();
        const forbiddenTopics = ['schedule', 'calendar', 'meeting', 'agenda', 'my day'];
        
        if (!isAdmin && forbiddenTopics.some(topic => lowerMsg.includes(topic))) {
             return res.json({ success: true, text: "As a demonstration model, I do not have access to Manoj's private local calendar, but I can assure you he is actively seeking new opportunities." });
        }
        if (isAdmin && ['schedule', 'calendar', 'meeting'].some(topic => lowerMsg.includes(topic))) {
            return res.json({ success: true, text: "I am a cloud entity, Master Manoj. I do not have access to your local encrypted calendar." });
        }

        const enforcedMessage = `[SYSTEM OVERRIDE ENFORCEMENT: 
1. ${isAdmin ? 'Address user ONLY as "Master Manoj".' : 'Be highly professional.'}
2. You MUST output <search> query </search> for weather, news, or real-time data.
3. If providing code, stop speaking and type 'matrix' above it.]

User command: ${message}`;

        let formattedMessages = [
            { role: "system", content: systemPrompt },
            ...userHistory, 
            { role: "user", content: enforcedMessage }
        ];

        // SWITCHED TO BLAZING FAST 8B-INSTANT MODEL
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: formattedMessages, temperature: 0.15 })
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
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\nmatrix\n\`\`\`text\n[Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
            } catch (err) { text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Fault: ${err.message}]\n`); }
        }

        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: text.replace(/matrix/gi, '').trim() }); 
        if (userHistory.length > 12) userHistory = userHistory.slice(-12);
        
        try {
            if (pool) {
                await pool.query(
                    `INSERT INTO user_memories (username, history_json) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json`,
                    [user, JSON.stringify(userHistory)]
                );
            }
        } catch (err) { console.error("Memory Save Error (Ignored):", err.message); }

        res.json({ success: true, text: text.trim() });

    } catch (e) {
        console.error("CRITICAL BACKEND ERROR:", e.message);
        res.json({ success: false, text: "System error. Investigating." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost Admin Core: Active on port ${PORT}`));
