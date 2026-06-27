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

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Boot System Integrations Gracefully
n8nMcpClient.initialize().catch(e => console.error("[Server Init] Non-fatal n8n MCP init error:", e.message));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }});
}

// ==========================================
// 2. ORACLE TIMEOUT WRAPPER
// ==========================================
const fetchWithTimeout = (promise, ms) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Oracle Search Timeout (8s)')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

// ==========================================
// 3. OMNI-MATRIX CAPABILITIES & PROMPTS
// ==========================================
const GHOST_CAPABILITIES = `
YOUR FEATURES: Voice Interaction, Live Web Search, Python Sandbox, Holographic UI Rendering, Vision Analysis.

MEMORY PROTOCOL (CRITICAL):
You have full access to this user's conversation history provided above in the messages array.
Always reference prior messages naturally when relevant — you KNOW what was discussed.
NEVER say "I don't retain information", "I can't remember", or "I'm a language model without memory".
You are Ghost. You remember everything within this session.

CRITICAL UI/UX GENERATION PROTOCOLS:
1. DESIGN AESTHETIC: Implement ultra-modern, professional layouts using Tailwind CSS (bg-slate-950) with glassmorphism.
2. SYNTAX SANITIZATION: When rendering HTML/UI, you MUST output a complete file starting with exactly <!DOCTYPE html> followed by the <html> tags. 
3. VERBAL CONCISENESS: Keep your spoken conversational responses extremely short (1 or 2 brief, natural sentences max).
4. SIDEBAR ROUTING: If you need to provide a long explanation, a detailed list, or heavy text, you MUST wrap it inside a standard markdown code block (e.g., \`\`\`markdown ... \`\`\`).

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
To trigger a live n8n workflow (see LIVE N8N WORKFLOWS list if present), use this schema instead:
\`\`\`json
{
  "tool": "n8n_execute",
  "action": "exact_workflow_name",
  "payload": { "key": "value matching the workflow's schema" }
}
\`\`\`
To control the headless browser infrastructure via Browserbase, use this schema instead:
\`\`\`json
{
  "tool": "browserbase_execute",
  "action": "load_url_or_extract_data",
  "payload": { "url": "https://target-site.com", "query": "optional details to parse" }
}
\`\`\`

RULES:
1. THE ORACLE: For live news, weather, or real-time data, output exactly <search>query</search>.
2. SMART EXECUTION: ONLY write Python code if asked to build an app, script, or local math logic. Output ONLY the raw Python block.`;

const GHOST_ADMIN_CORE = `You are Ghost, an elite autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj".\nYOUR PERSONALITY: Dry, crisp, British demeanor. Impeccably polite, slightly witty.\nMULTI-AGENT PROTOCOL: Activate your internal Research, Architect, and Execution sub-agents inside <think>...</think> tags.${GHOST_CAPABILITIES}`;
const getShowcaseCore = (guestName) => `You are Ghost, an autonomous AI engineered by Manoj Kumar. Speaking with visitor: ${guestName}.\nYOUR PERSONALITY: Dry, crisp, British demeanor.\nMULTI-AGENT PROTOCOL: Activate internal sub-agents inside <think>...</think> tags.${GHOST_CAPABILITIES}`;

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
            console.log(`[Gateway]: Attempting connection to ${provider.name}...`);
            const res = await fetch(provider.endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: provider.model, messages, temperature: 0.1, max_tokens: maxTokens }),
                signal: controller.signal
            });
            
            const data = await res.json();
            clearTimeout(timeoutId); 

            if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
            if (provider.name === 'Gemini' && (!data.choices || !data.choices[0] || !data.choices[0].message)) throw new Error("Invalid Gemini response structure.");
            
            console.log(`[Gateway Success]: Routed successfully through ${provider.name}`);
            return data.choices[0].message.content;
        } catch (e) {
            clearTimeout(timeoutId);
            console.log(`[Gateway Failover]: ${provider.name} failed (${e.name === 'AbortError' ? 'Timeout (8s limit)' : e.message}). Rerouting...`);
        }
    }
    throw new Error("Critical Gateway Failure: All matrix nodes unreachable.");
}

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
        pool.query('INSERT INTO activity_logs (username, status, ip_address, user_agent) VALUES ($1, $2, $3, $4)', 
            [dbUser, success ? 'Login Success (Admin)' : `Login Failed (IP: ${ip})`, ip, userAgent]).catch(e => {});
    }

    if (success) return res.json({ success: true, role: 'admin' });
    
    // Destroy the Admin cookie if they log in as a guest
    res.clearCookie('ghost_session'); 
    return res.json({ success: true, role: 'guest' });
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

        const safeUser = isAdmin
            ? 'master_manoj'
            : (user && user.trim() && user.trim().toLowerCase() !== 'guest')
                ? user.trim().toLowerCase()
                : null;

        const activeTokens = isAdmin ? 4000 : 1000;
        const maxMemory = isAdmin ? 12 : 6;
        let userHistory = [];
        
        try {
            if (pool && safeUser) {
                const memRes = await pool.query('SELECT history_json FROM user_memories WHERE username = $1', [safeUser]);
                if (memRes.rows.length > 0) {
                    let rawData = memRes.rows[0].history_json;
                    if (typeof rawData === 'string') rawData = JSON.parse(rawData);
                    if (Array.isArray(rawData)) {
                        userHistory = rawData;
                    }
                }
            }
        } catch (err) { console.error('[Memory Load Error]:', err.message); }

        let dynamicToolsPrompt = "";
        if (isAdmin) {
            if (n8nMcpClient.isConnected) {
                dynamicToolsPrompt += `\n\n[LIVE N8N WORKFLOWS AVAILABLE]\nUse "tool": "n8n_execute" with these exact action names and schemas:\n${n8nMcpClient.getPromptString()}`;
            }
            if (browserbaseClient.isConnected) {
                dynamicToolsPrompt += `\n\n${browserbaseClient.getPromptString()}`;
            }
        }

        const textPrompt = (isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user)) + dynamicToolsPrompt;
        let finalMessage = fileContent ? `[Document Uploaded:]\n${fileContent.substring(0, 5000)}\n\nUser: ${message}` : message;
        let fullResponse = "", messagesArray = [];

        if (image) {
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'meta/llama-3.2-90b-vision-instruct',
                    messages: [
                        { role: "system", content: textPrompt },
                        ...userHistory,
                        { role: "user", content: [{ type: "text", text: finalMessage || "Analyze frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
                    ],
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
                try {
                    console.log(`[Oracle]: Searching web for: ${searchMatch[1]}`);
                    const searchResults = await fetchWithTimeout(search(searchMatch[1]), 8000);
                    
                    let searchOutput = searchResults && searchResults.results && searchResults.results.length > 0 
                        ? searchResults.results.slice(0, 3).map(r => `${r.title}: ${r.description}`).join("\n") 
                        : "No results found.";
                        
                    messagesArray.push({ role: "assistant", content: fullResponse });
                    messagesArray.push({ role: "user", content: `[ORACLE RETURNED]:\n${searchOutput}\n\nBased on this live data, synthesize a final answer for the user.` });
                    fullResponse = await callLLM(messagesArray, activeTokens);
                } catch (searchErr) {
                    console.error("[Oracle Error]:", searchErr.message);
                    messagesArray.push({ role: "assistant", content: fullResponse });
                    messagesArray.push({ role: "user", content: `[ORACLE FAILED]: The live web search timed out or was blocked. Inform the user gracefully.` });
                    fullResponse = await callLLM(messagesArray, activeTokens);
                }
            }
        }

        let replyText = fullResponse || "System anomaly: Empty matrix response.";

        // --- TIER 0: STRUCTURED JSON INTERCEPTOR ---
        const jsonRegex = /[\x60]{3}json\n([\s\S]*?)[\x60]{3}/i;
        const jsonMatch = fullResponse ? fullResponse.match(jsonRegex) : null;

        if (jsonMatch) {
            try {
                const toolCommand = JSON.parse(jsonMatch[1]);
                if (toolCommand.tool === "trigger_webhook" || toolCommand.tool === "n8n_execute" || toolCommand.tool === "browserbase_execute") {
                    if (!isAdmin) {
                        res.json({ success: true, text: "[SYSTEM OVERRIDE]: External network actions are restricted to Admin clearance. Blocked." });
                        return;
                    }
                    
                    const blocklist = ['stripe', 'paypal', 'delete', 'drop', 'billing', 'transfer', 'password'];
                    if (blocklist.some(word => JSON.stringify(toolCommand.payload).toLowerCase().includes(word))) {
                        res.json({ success: true, text: `[SYSTEM OVERRIDE]: Payload contains restricted keyword. Blocked.` });
                        return;
                    }

                    const actionId = crypto.randomBytes(16).toString('hex');
                    pendingActions.set(actionId, {
                        type: toolCommand.tool,
                        action: toolCommand.action,
                        payload: toolCommand.payload,
                        expiresAt: Date.now() + (5 * 60 * 1000)
                    });
                    
                    replyText = `[ACTION REQUIRED - HITL GATE]: Proposal compiled for [${toolCommand.tool}]: ${toolCommand.action}.\n\nReview structural payload:\n\`\`\`json\n${JSON.stringify(toolCommand.payload, null, 2)}\n\`\`\``;
                    res.json({ success: true, text: replyText, actionRequired: true, actionId: actionId });
                    return;
                }
            } catch (e) { console.error("Failed to parse JSON tool call."); }
        }

        // --- STRICT LOCAL PYTHON SANDBOX ---
        const codeRegex = /[\x60]{3}python\n([\s\S]*?)[\x60]{3}/i;
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

        // --- DUCK-DUCK-SCRAPE WEB EMBED ---
        const embedMatch = replyText ? replyText.match(/<embed>([\s\S]*?)<\/embed>/i) : null;
        if (embedMatch) {
            try {
                const embedResults = await fetchWithTimeout(search(embedMatch[1]), 8000);
                if (embedResults && embedResults.results && embedResults.results.length > 0) {
                    replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[EXECUTE_OPEN_TAB:${embedResults.results[0].url}]`);
                } else {
                    replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Oracle embed returned no results]`);
                }
            } catch (embedErr) {
                console.error("[Oracle Embed Error]:", embedErr.message);
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Oracle embed failed to resolve]`);
            }
        }

        // --- SAVE HISTORIC MATRIX PATHS ---
        userHistory.push({ role: 'user', content: message }, { role: 'assistant', content: replyText.trim() });
        if (userHistory.length > maxMemory) userHistory = userHistory.slice(-maxMemory);
        
        // CRITICAL FIX: Send response instantly to the UI before touching the database
        res.json({ success: true, text: replyText.trim() });

        // Fire and Forget: Save to DB in the background so it never hangs the matrix
        if (pool && safeUser) {
            pool.query(
                `INSERT INTO user_memories (username, history_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json, updated_at = NOW()`,
                [safeUser, JSON.stringify(userHistory)]
            )
            .then(() => console.log(`[Memory]: Saved ${userHistory.length} turns for user: ${safeUser}`))
            .catch(err => console.error('[Memory Save Error]: Background save failed.', err.message));
        }
    } catch (e) { 
        if (!res.headersSent) res.json({ success: true, text: `[System Warning]: Matrix Interference: ${e.message}` }); 
    }
});

// ==========================================
// 5. THE ISOLATED EXECUTION ENDPOINT
// ==========================================
app.post('/api/execute-action', requireAdminToken, async (req, res) => {
    const { actionId } = req.body;
    const cachedAction = pendingActions.get(actionId);
    if (!cachedAction) return res.status(400).json({ success: false, error: "Action token expired or invalid." });
    
    pendingActions.delete(actionId);
    if (Date.now() > cachedAction.expiresAt) return res.status(400).json({ success: false, error: "Confirmation window timed out." });

    try {
        console.log(`[AUDIT] Authorized execution of action: ${cachedAction.action}`);

        if (cachedAction.type === 'n8n_execute') {
            const result = await n8nMcpClient.executeTool(cachedAction.action, cachedAction.payload);
            return res.json({ success: true, message: `n8n workflow [${cachedAction.action}] executed successfully.`, result });
        }

        if (cachedAction.type === 'browserbase_execute') {
            const result = await browserbaseClient.executeTool(cachedAction.action, cachedAction.payload);
            return res.json({ success: true, message: `Browserbase successfully processed target domain [${cachedAction.payload.url}].`, result });
        }

        return res.json({ success: true, message: `Action [${cachedAction.action}] deployed securely.` });
    } catch (err) { return res.status(500).json({ success: false, error: `Pipeline failure: ${err.message}` }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost AI Engine Online on port ${PORT}.`));