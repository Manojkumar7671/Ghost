import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import pkg from 'pg';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import n8nMcpClient from './services/mcpClient.js';
import browserbaseClient from './services/browserbaseClient.js';
import { search } from 'duck-duck-scrape'; 

// ==========================================
// 1. CRITICAL BOOT SEQUENCE
// ==========================================
if (!process.env.ADMIN_PASSPHRASE || !process.env.JWT_SECRET) {
    console.error("\n[CRITICAL FATAL ERROR]: ADMIN_PASSPHRASE or JWT_SECRET missing.");
    process.exit(1); 
}
const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE;
const JWT_SECRET = process.env.JWT_SECRET;
const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

n8nMcpClient.initialize().catch(e => console.error("[Server Init] Non-fatal n8n MCP init error:", e.message));

let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }});
}

const fetchWithTimeout = (promise, ms) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Oracle Search Timeout (8s)')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const GHOST_CAPABILITIES = `You are Ghost. You remember everything within this session.
EXTERNAL ACTIONS PROTOCOL (STRICT): Output JSON schema for triggers.
RULES: 1. THE ORACLE: Output <search>query</search> for real-time data. 2. SMART EXECUTION: Output raw Python block only if asked for logic.`;

const GHOST_ADMIN_CORE = `You are Ghost, an elite autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj".${GHOST_CAPABILITIES}`;
const getShowcaseCore = (guestName) => `You are Ghost. Speaking with visitor: ${guestName}.${GHOST_CAPABILITIES}`;

const PROVIDER_MATRIX = [
    { name: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', apiKey: process.env.GROQ_API_KEY },
    { name: 'Nvidia NIM', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/llama-3.3-nemotron-super-49b-v1', apiKey: process.env.NVIDIA_API_KEY }
];

async function callLLM(messages, maxTokens) {
    for (const provider of PROVIDER_MATRIX) {
        if (!provider.apiKey) continue;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); 
        try {
            const res = await fetch(provider.endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: provider.model, messages, temperature: 0.1, max_tokens: maxTokens }),
                signal: controller.signal
            });
            const data = await res.json();
            clearTimeout(timeoutId);
            return data.choices[0].message.content;
        } catch (e) { clearTimeout(timeoutId); }
    }
    throw new Error("Matrix nodes unreachable.");
}

app.post('/api/auth', async (req, res) => {
    const { authString, user = 'Unknown' } = req.body;
    if (authString === ADMIN_PASSPHRASE) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.cookie('ghost_session', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400000 });
        return res.json({ success: true, role: 'admin' });
    }
    res.clearCookie('ghost_session'); 
    return res.json({ success: true, role: 'guest' });
});

const pendingActions = new Map();
app.post('/api/chat', async (req, res) => {
    try {
        const { message, user, ghostCodeMode = true } = req.body;
        const isAdmin = req.cookies.ghost_session && jwt.verify(req.cookies.ghost_session, JWT_SECRET).role === 'admin';
        const safeUser = isAdmin ? 'master_manoj' : (user?.toLowerCase() || 'guest');
        
        let userHistory = [];
        if (pool && safeUser !== 'guest') {
            const memRes = await pool.query('SELECT history_json FROM user_memories WHERE username = $1', [safeUser]);
            if (memRes.rows.length > 0) userHistory = JSON.parse(memRes.rows[0].history_json);
        }

        let toolsPrompt = isAdmin ? `\n[N8N/BROWSERBASE TOOLS ENABLED]` : "";
        const messagesArray = [{ role: "system", content: (isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user)) + toolsPrompt }, ...userHistory, { role: "user", content: message }];
        let fullResponse = await callLLM(messagesArray, 2000);

        // ORACLE FIX: Removed invalid safeSearch option
        const searchMatch = fullResponse.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const results = await fetchWithTimeout(search(searchMatch[1]), 8000);
            messagesArray.push({ role: "assistant", content: fullResponse });
            messagesArray.push({ role: "user", content: `Data: ${JSON.stringify(results.results.slice(0, 3))}` });
            fullResponse = await callLLM(messagesArray, 2000);
        }

        // FIRE-AND-FORGET MEMORY SAVE (Eliminates 4-minute hang)
        userHistory.push({ role: 'user', content: message }, { role: 'assistant', content: fullResponse });
        if (userHistory.length > 6) userHistory = userHistory.slice(-6);
        if (pool && safeUser !== 'guest') {
            pool.query(`INSERT INTO user_memories (username, history_json) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json`,
                [safeUser, JSON.stringify(userHistory)]).catch(e => console.log("Background save failed."));
        }

        res.json({ success: true, text: fullResponse });
    } catch (e) { res.json({ success: true, text: `Matrix Error: ${e.message}` }); }
});

app.listen(10000, '0.0.0.0', () => console.log(`Ghost Online.`));