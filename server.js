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
// SUPABASE DATABASE CONNECTION
// ════════════════════════════════════════════════════════════
let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
}

const localMemory = {};

// ════════════════════════════════════════════════════════════
// THE NORMAL GHOST PERSONA
// ════════════════════════════════════════════════════════════
const GHOST_CORE = `You are Ghost, an AI architecture engineered by Manoj Kumar. 
YOUR DIRECTIVES:
1. Be helpful, articulate, and friendly with a subtle, dry British wit.
2. NEVER use the words "Boss", "old chap", or invent fake meetings. Address the user politely.
3. If the user asks who you are or what you do, proudly state you were engineered by Manoj Kumar and explain you can search the live web, write code, and analyze files.
4. Keep voice responses to MAX 2 short sentences. Stop speaking and type 'matrix' if providing code, search results, or data.`;

app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    try {
        if (pool) {
            await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error("Supabase Logging Error:", err.message);
        res.json({ success: false });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user } = req.body;
        
        let userHistory = localMemory[user] || [];
        try {
            if (pool) {
                const memRes = await pool.query('SELECT history_json FROM user_memories WHERE username = $1', [user]);
                if (memRes.rows.length > 0) {
                    let rawData = memRes.rows[0].history_json;
                    if (typeof rawData === 'string') rawData = JSON.parse(rawData);
                    if (Array.isArray(rawData)) userHistory = rawData;
                }
            }
        } catch (err) {
            console.error("Memory Extraction Error:", err.message);
        }

        // 🛑 THE HARD INTERCEPTOR (Restored to prevent hallucinations) 🛑
        const lowerMsg = message.toLowerCase();
        const forbiddenTopics = ['schedule', 'calendar', 'meeting', 'agenda', 'my day'];
        
        if (forbiddenTopics.some(topic => lowerMsg.includes(topic))) {
             return res.json({ 
                success: true, 
                text: "I am a cloud entity. I do not have access to Manoj's private local calendar or system files." 
            });
        }

        const enforcedMessage = `[SYSTEM OVERRIDE ENFORCEMENT: 
1. Max 2 sentences. 
2. You MUST output <search> query </search> for weather, news, or real-time data. Do not guess.
3. If providing code, stop speaking and type 'matrix' above it.]

User command: ${message}`;

        let formattedMessages = [
            { role: "system", content: GHOST_CORE },
            ...userHistory, 
            { role: "user", content: enforcedMessage }
        ];

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: formattedMessages, temperature: 0.15 })
        });

        if (!groqRes.ok) {
            const errData = await groqRes.text();
            throw new Error(`Groq API Error: [${groqRes.status}] ${errData}`);
        }
        
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
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\nmatrix\n\`\`\`text\n[Web Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
            } catch (err) {
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Fault: ${err.message}]\n`);
            }
        }

        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: text.replace(/matrix/gi, '').trim() }); 
        
        if (userHistory.length > 12) userHistory = userHistory.slice(-12);
        localMemory[user] = userHistory;
        
        try {
            if (pool) {
                await pool.query(
                    `INSERT INTO user_memories (username, history_json) VALUES ($1, $2)
                     ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json`,
                    [user, JSON.stringify(userHistory)]
                );
            }
        } catch (err) {
            console.error("Memory Save Error:", err.message);
        }

        res.json({ success: true, text: text.trim() });

    } catch (e) {
        console.error("CRITICAL BACKEND ERROR:", e.message);
        res.json({ success: false, text: "System error. Investigating." });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost Core: Active on port ${PORT}`));
