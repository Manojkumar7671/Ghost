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

// ==========================================
// 1. CRITICAL BOOT SEQUENCE (FAIL-DEADLY)
// ==========================================
if (!process.env.ADMIN_PASSPHRASE || !process.env.JWT_SECRET) {
    console.error("\n[CRITICAL FATAL ERROR]: ADMIN_PASSPHRASE or JWT_SECRET missing.");
    console.error("Halting server boot sequence to prevent fallback vulnerabilities.\n");
    process.exit(1); 
}

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE;
const JWT_SECRET = process.env.JWT_SECRET;

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1); // CRITICAL: Required for Cloudflare/Render IP tracking
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// API KEYS
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// DATABASE
let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }});
}

// ==========================================
// 2. OMNI-MATRIX CAPABILITIES & PROMPTS
// ==========================================
const GHOST_CAPABILITIES = `
YOUR FEATURES: Voice Interaction, Live Web Search, Python Sandbox, Holographic UI Rendering, Vision Analysis.

CRITICAL UI/UX GENERATION PROTOCOLS:
1. DESIGN AESTHETIC: Implement ultra-modern, professional layouts using Tailwind CSS (bg-slate-950) with glassmorphism.
2. SYNTAX SANITIZATION: When rendering HTML via Python execution, build the structure dynamically as a pristine string asset.

EXTERNAL ACTIONS PROTOCOL (STRICT):
You are strictly forbidden from writing Python code to make external network requests, API calls, or webhooks. 
If you need to trigger an external action (e.g., send an email, log to a sheet, notify admin), you MUST output a raw JSON block.
Schema:
\`\`\`json
{
  "tool": "trigger_webhook",
  "action": "description_of_action",
  "payload": { "key": "value" }
}
\`\`\`

RULES:
1. THE ORACLE: For live news, weather, or real-time data, output exactly <search>query</search>.
2. SMART EXECUTION: ONLY write Python code if asked to build an app, script, or local math logic. Output ONLY the raw Python block.`;

const GHOST_ADMIN_CORE = `You are Ghost, an elite autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj".\nYOUR PERSONALITY: Dry, crisp, British demeanor. Impeccably polite, slightly witty.\nMULTI-AGENT PROTOCOL: Activate your internal Research, Architect, and Execution sub-agents inside <think>...</think> tags.${GHOST_CAPABILITIES}`;
const getShowcaseCore = (guestName) => `You are Ghost, an autonomous AI engineered by Manoj Kumar. Speaking with guest: ${guestName}.\nYOUR PERSONALITY: Dry, crisp, British demeanor.\nMULTI-AGENT PROTOCOL: Activate internal sub-agents inside <think>...</think> tags.${GHOST_CAPABILITIES}`;

const PROVIDER_MATRIX = [
    { name: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', apiKey: GROQ_API_KEY },
    { name: 'Nvidia NIM', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/llama-3.3-nemotron-super-49b-v1', apiKey: NVIDIA_API_KEY },
    { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct', apiKey: OPENROUTER_API_KEY },
    { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-1.5-pro', apiKey: GEMINI_API_KEY }
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
            clearTimeout(timeoutId);
            const data = await res.json();
            if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
            if (provider.name === 'Gemini' && (!data.choices || !data.choices[0] || !data.choices[0].message)) throw new Error("Invalid Gemini response structure.");
            
            console.log(`[Gateway Success]: Routed successfully through ${provider.name}`);
            return data.choices[0].message.content;
        } catch (e) {
            clearTimeout(timeoutId);
            console.log(`[Gateway Failover]: ${provider.name} failed (${e.name === 'AbortError' ? 'Timeout' : e.message}). Rerouting...`);
        }
    }
    throw new Error("Critical Gateway Failure: All matrix nodes unreachable.");
}

// ==========================================
// 3. AUTHENTICATION & RATE LIMITING
// ==========================================
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5,
    message: { success: false, error: "Too many login attempts. IP blocked for 15 minutes." },
    standardHeaders: true, legacyHeaders: false,
});

app.post('/api/auth', authLimiter, async (req, res) => {
    const { authString, user = 'Unknown' } = req.body;
    const ip = req.ip; 
    const userAgent = req.headers['user-agent'] || 'Unknown';
    let success = false, role = 'guest';

    if (authString === ADMIN_PASSPHRASE) {
        success = true; role = 'admin';
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.cookie('ghost_session', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 24 * 60 * 60 * 1000 });
    }

    if (authString && pool) {
        const dbUser = success ? 'Master Manoj' : 'Failed Auth Attempt';
        pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', 
            [dbUser, success ? 'Login Success (Admin)' : `Login Failed (IP: ${ip})`]).catch(e => {});
    }

    if (success) return res.json({ success: true, role: 'admin' });
    return res.status(401).json({ success: false, error: 'Unauthorized credentials.' });
});

function requireAdminToken(req, res, next) {
    const token = req.cookies.ghost_session;
    if (!token) return res.status(403).json({ success: false, error: 'Missing token.' });
    try {
        if (jwt.verify(token, JWT_SECRET).role === 'admin') return next();
        throw new Error('Invalid role.');
    } catch (err) { return res.status(403).json({ success: false, error: 'Token expired/invalid.' }); }
}

function checkIsAdmin(req) {
    const token = req.cookies.ghost_session;
    try { return token && jwt.verify(token, JWT_SECRET).role === 'admin'; } catch(e) { return false; }
}

// ==========================================
// 4. THE PROPOSAL ENGINE (CHAT ROUTE)
// ==========================================
const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    max: 20, 
    message: { success: true, text: "[SYSTEM WARNING]: API rate limit exceeded. Cooling down." },
    standardHeaders: true, legacyHeaders: false,
});

const pendingActions = new Map();

app.post('/api/chat', chatLimiter, async (req, res) => {
    try {
        const { message, user, image, fileContent, ghostCodeMode = true } = req.body;
        const isAdmin = checkIsAdmin(req);
        
        const activeTokens = isAdmin ? 4000 : 1000;
        const maxMemory = isAdmin ? 12 : 6;
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

        const textPrompt = isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user);
        let finalMessage = fileContent ? `[Document Uploaded:]\n${fileContent.substring(0, 5000)}\n\nUser: ${message}` : message;
        let fullResponse = "", messagesArray = [];

        if (image) {
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'meta/llama-3.2-90b-vision-instruct',
                    messages: [{ role: "system", content: textPrompt }, { role: "user", content: [{ type: "text", text: finalMessage || "Analyze frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }],
                    max_tokens: activeTokens, temperature: 0.1
                })
            });
            const data = await nvidiaRes.json();
            fullResponse = data.choices[0].message.content;
        } else {
            messagesArray = [{ role: "system", content: textPrompt }, ...userHistory, { role: "user", content: finalMessage }];
            fullResponse = await callLLM(messagesArray, activeTokens);

            const searchMatch = fullResponse ? fullResponse.match(/<search>([\s\S]*?)<\/search>/i) : null;
            if (searchMatch) {
                const searchRes = await fetch("https://api.tavily.com/search", { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: TAVILY_API_KEY, query: searchMatch[1], max_results: 3 }) });
                const searchData = await searchRes.json();
                let searchOutput = searchData.results && searchData.results.length > 0 ? searchData.results.map(r => `${r.title}: ${r.content}`).join("\n") : "No results.";
                messagesArray.push({ role: "assistant", content: fullResponse });
                messagesArray.push({ role: "user", content: `[ORACLE RETURNED]:\n${searchOutput}\n\nSynthesize final answer.` });
                fullResponse = await callLLM(messagesArray, activeTokens);
            }
        }

        let replyText = fullResponse || "System anomaly: Empty matrix response.";

        // --- TIER 0: STRUCTURED JSON INTERCEPTOR ---
        const jsonRegex = /[\x60]{3}json\n([\s\S]*?)[\x60]{3}/i;
        const jsonMatch = fullResponse ? fullResponse.match(jsonRegex) : null;

        if (jsonMatch) {
            try {
                const toolCommand = JSON.parse(jsonMatch[1]);
                if (toolCommand.tool === "trigger_webhook") {
                    if (!isAdmin) return res.json({ success: true, text: "[SYSTEM OVERRIDE]: External network actions are restricted to Admin clearance. Blocked." });
                    
                    const blocklist = ['stripe', 'paypal', 'delete', 'drop', 'billing', 'transfer', 'password'];
                    if (blocklist.some(word => JSON.stringify(toolCommand.payload).toLowerCase().includes(word))) {
                        return res.json({ success: true, text: `[SYSTEM OVERRIDE]: Payload contains restricted keyword. Blocked.` });
                    }

                    const actionId = crypto.randomBytes(16).toString('hex');
                    pendingActions.set(actionId, { action: toolCommand.action, payload: toolCommand.payload, expiresAt: Date.now() + (5 * 60 * 1000) });
                    
                    replyText = `[ACTION REQUIRED - HITL GATE]: Proposal compiled for: ${toolCommand.action}.\n\nReview structural payload:\n\`\`\`json\n${JSON.stringify(toolCommand.payload, null, 2)}\n\`\`\``;
                    return res.json({ success: true, text: replyText, actionRequired: true, actionId: actionId });
                }
            } catch (e) { console.error("Failed to parse JSON tool call."); }
        }

        // --- LOCAL PYTHON SANDBOX ---
        const codeRegex = /[\x60]{3}(?:python)?\n([\s\S]*?)[\x60]{3}/i;
        const match = fullResponse ? fullResponse.match(codeRegex) : null;
        if (ghostCodeMode && match && match[1]) {
            const tempFilePath = path.join(__dirname, 'ghost_payload.py');
            fs.writeFileSync(tempFilePath, match[1].trim());
            try {
                const executionOutput = execSync(`python3 ${tempFilePath}`, { timeout: 15000, encoding: 'utf-8' });
                replyText = fullResponse.replace(match[0], `\n\`\`\`html\n${executionOutput.trim()}\n\`\`\`\n`);
            } catch (execError) { replyText = fullResponse.replace(match[0], `[Python Error]: ${execError.stderr || execError.message}`); }
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        }

        // TAVILY WEB EMBED
        const embedMatch = replyText ? replyText.match(/<embed>([\s\S]*?)<\/embed>/i) : null;
        if (embedMatch) {
            const searchRes = await fetch("https://api.tavily.com/search", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: TAVILY_API_KEY, query: embedMatch[1], max_results: 1 })
            });
            const searchData = await searchRes.json();
            if (searchData.results && searchData.results.length > 0) {
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[EXECUTE_OPEN_TAB:${searchData.results[0].url}]`);
            }
        }

        // MEMORY SAVE
        userHistory.push({ role: 'user', content: message }, { role: 'assistant', content: replyText.trim() });
        if (userHistory.length > maxMemory) userHistory = userHistory.slice(-maxMemory);
        try { if (pool) await pool.query(`INSERT INTO user_memories (username, history_json) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json`, [user, JSON.stringify(userHistory)]); } catch (err) {}

        res.json({ success: true, text: replyText.trim() });
    } catch (e) { res.json({ success: true, text: `[System Warning]: Matrix Interference: ${e.message}` }); }
});

// ==========================================
// 5. THE ISOLATED EXECUTION ENDPOINT
// ==========================================
app.post('/api/execute-action', requireAdminToken, async (req, res) => {
    const { actionId } = req.body;
    const cachedAction = pendingActions.get(actionId);
    if (!cachedAction) return res.status(400).json({ success: false, error: "Action token expired or invalid." });
    
    pendingActions.delete(actionId); // BURN NONCE
    if (Date.now() > cachedAction.expiresAt) return res.status(400).json({ success: false, error: "Confirmation window timed out." });

    try {
        console.log(`[AUDIT] Authorized execution of action: ${cachedAction.action}`);
        // Integration point for Nango/n8n payload delivery
        return res.json({ success: true, message: `Action [${cachedAction.action}] deployed securely.` });
    } catch (err) { return res.status(500).json({ success: false, error: `Pipeline failure: ${err.message}` }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost AI Engine Online on port ${PORT}.`));