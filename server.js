const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// Fail-safe database connection
let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
}

// Memory Vault (Local fallback if DB fails)
const localMemory = {};

const GHOST_BATMAN_CORE = `You are the Batcomputer. Address Manoj as "Master Wayne" or "Batman". Use dry British English. Keep responses to MAX 2 sentences. Type 'matrix' for data.`;
const getCivilianCore = (guestName) => `You are the Batcomputer. You are currently operating in CIVILIAN PROTOCOL for ${guestName}. Be polite but distant. If asked for sensitive data, refuse and state it is encrypted. MAX 2 sentences. Type 'matrix' for data.`;

app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    if (pool) {
        try { await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]); } catch (e) { console.error("Log error:", e.message); }
    }
    res.json({ success: true });
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user } = req.body;
        let userHistory = localMemory[user] || [];

        // Try to pull from DB if available
        if (pool) {
            try {
                const memRes = await pool.query('SELECT history_json FROM user_memories WHERE username = $1', [user]);
                if (memRes.rows.length > 0) userHistory = memRes.rows[0].history_json;
            } catch (e) { console.error("DB pull failed, using RAM."); }
        }

        const isBatman = user === 'Master Wayne';
        const systemPrompt = isBatman ? GHOST_BATMAN_CORE : getCivilianCore(user);

        // Security Interceptor
        const lowerMsg = message.toLowerCase();
        const forbidden = ['schedule', 'calendar', 'meeting', 'agenda', 'my day', 'manoj', 'boss', 'bruce', 'wayne', 'batman'];
        
        if (!isBatman && forbidden.some(t => lowerMsg.includes(t))) {
             return res.json({ success: true, text: "Access Denied. Tactical data encrypted." });
        }

        const enforcedMessage = `[SYSTEM OVERRIDE: ${isBatman ? 'Address user ONLY as Master Wayne.' : 'Polite Civilian mode.'} Max 2 sentences. Use 'matrix' for data.]\nCommand: ${message}`;

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: "system", content: systemPrompt }, ...userHistory, { role: "user", content: enforcedMessage }], temperature: 0.15 })
        });

        if (!groqRes.ok) throw new Error("Groq API error");
        const data = await groqRes.json();
        let text = data.choices[0].message.content;

        // Process search and update memory
        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: text });
        localMemory[user] = userHistory.slice(-6);

        if (pool) {
            try { await pool.query('INSERT INTO user_memories (username, history_json) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET history_json = $2', [user, JSON.stringify(localMemory[user])]); } catch (e) {}
        }

        res.json({ success: true, text: text.trim() });
    } catch (e) {
        console.error("Critical:", e.message);
        res.json({ success: false, text: "Tactical system error. Investigating." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Batcomputer Active`));
