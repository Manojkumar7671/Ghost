import { checkToolAccess } from './adminGate.js';
import { startAutoLearning } from './ghostLearnScheduler.js';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';
import pkg from 'pg';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import workflowEngine from './services/workflowEngine.js';
import browserbaseClient from './services/browserbaseClient.js';
import { pendingActions as sharedPendingActions } from './state/pendingActions.js';
import createPipelineRoutes from './routes/pipelineRoutes.js';
import { securityMiddleware } from './middleware/security.js';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { classifyComplexity, analyzeIntent, buildTaskPlan, generateToolParams, verifyGoalSatisfaction } from './services/intentPlanner.js';
import { loadCatalog, routeCapabilityToTools } from './services/toolRouter.js';
import { initAgentModes, activateMorningDigest, activateScheduledMonitor } from './services/agentModes.js';
import { runPythonSandbox } from './services/pythonSandbox.js';
import { initGoogleAuthTable, generateAuthUrl, handleOAuthCallback, revokeAccess } from './services/googleAuth.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const brain = require('./src/brain.js');

if (!process.env.ADMIN_PASSPHRASE || !process.env.JWT_SECRET || !process.env.N8N_ENCRYPTION_KEY) {
    console.error("\n[CRITICAL FATAL ERROR]: ADMIN_PASSPHRASE, JWT_SECRET, or N8N_ENCRYPTION_KEY missing.");
    console.error("Halting server boot sequence to prevent fallback vulnerabilities.\n");
    process.exit(1); 
}

// ENV VAR VALIDATION
if (!process.env.SERPER_API_KEY) console.warn("[WARN] SERPER_API_KEY missing — web search disabled");
if (!process.env.BROWSERBASE_API_KEY) console.warn("[WARN] BROWSERBASE_API_KEY missing — browser automation disabled");

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE;
const JWT_SECRET = process.env.JWT_SECRET;
const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' })); // Restricted standard payload sizes to prevent memory-limit DoS attacks
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const sessionModes = new Map();

// Ghost Workflow Engine is built-in — no external initialization required
console.log(`[Ghost Workflow Engine] Online — ${workflowEngine.getPromptString().split('- Action Name:').length - 1} built-in workflows ready.`);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY; 
const SERPER_API_KEY = process.env.SERPER_API_KEY;

let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({
        connectionString: process.env.SUPABASE_DB_URL,
        ssl: { rejectUnauthorized: false },
        max: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        keepAlive: true
    });
    pool.on('error', (err) => {
        console.error('[Postgres Pool Error]:', err.message);
    });
}

const fetchWithTimeout = (promise, ms) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Oracle Search Timeout (8s)')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

function compressContext(messages) {
    if (!messages || messages.length <= 7) return messages;
    const systemPrompt = messages[0].role === 'system' ? messages[0] : null;
    const startIndex = systemPrompt ? 1 : 0;
    const coreMessages = messages.slice(startIndex, messages.length - 6);
    const recentMessages = messages.slice(messages.length - 6);
    const compressedCore = coreMessages.map(msg => {
        let content = msg.content || "";
        if (typeof content !== 'string') return msg;
        if (content.length > 2000) {
            content = content.substring(0, 1000) + "\n\n...[SYSTEM OVERRIDE: HEAVY CONTEXT COMPRESSED]...\n\n" + content.substring(content.length - 900);
        }
        return { ...msg, content };
    });
    const dedupedCore = compressedCore.filter((msg, idx, arr) => {
        if (idx === 0) return true;
        return msg.content !== arr[idx - 1].content;
    });
    return systemPrompt ? [systemPrompt, ...dedupedCore, ...recentMessages] : [...dedupedCore, ...recentMessages];
}

async function ghostLearn(sessionData) {
    const { safeUser, message, actionTaken } = sessionData;
    if (!pool || !safeUser || safeUser === 'guest') return;
    const pattern = message.substring(0, 500);
    const action = actionTaken || "general_response";
    try {
        await pool.query(
            `INSERT INTO ghost_genes (pattern, action, outcome, score, created_at) VALUES ($1, $2, $3, $4, NOW())`,
            [pattern, action, "success", 1.0]
        );
    } catch (err) {
        console.error('[EvoMap]: Background gene write failed.', err.message);
    }
}

async function appendToUserMemory(username, newTurns, maxTurns = 12) {
    if (!pool || !username) return;
    try {
        const memRes = await pool.query('SELECT history_json FROM user_memories WHERE username = $1', [username]);
        let hist = [];
        if (memRes.rows.length > 0) {
            let raw = memRes.rows[0].history_json;
            if (typeof raw === 'string') raw = JSON.parse(raw);
            if (Array.isArray(raw)) hist = raw;
        }
        hist.push(...newTurns);
        if (hist.length > maxTurns) hist = hist.slice(-maxTurns);
        await pool.query(
            `INSERT INTO user_memories (username, history_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json, updated_at = NOW()`,
            [username, JSON.stringify(hist)]
        );
    } catch (err) {
        console.error('[Memory Save Error]:', err.message);
    }
}

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
4. SIDEBAR ROUTING: If you need to provide a long explanation, a detailed list, or heavy text, you MUST wrap it inside a standard markdown code block.
EXTERNAL ACTIONS PROTOCOL (STRICT):
You are strictly forbidden from writing Python code to make external network requests, API calls, or webhooks. 
If you need to trigger an external action, you MUST output a raw JSON block.
Schema:
\`\`\`json
{"tool": "trigger_webhook", "action": "description_of_action", "payload": { "key": "value" }}
\`\`\`
To trigger a live n8n workflow:
\`\`\`json
{"tool": "n8n_execute", "action": "exact_workflow_name", "payload": { "key": "value matching the workflow's schema" }}
\`\`\`
To control the headless browser via Browserbase:
\`\`\`json
{"tool": "browserbase_execute", "action": "load_url_or_extract_data", "payload": { "url": "https://target-site.com", "query": "optional details" }}
\`\`\`
RULES:
1. THE ORACLE: For live news, weather, or real-time data, output exactly <search>query</search>.
2. SMART EXECUTION: ONLY write Python code if asked to build an app, script, or local math logic.
3. PONYTAIL MINIMALISM RULE: Check if the standard library can solve it first. Write the absolute minimum working code necessary.`;

const MULTI_AGENT_PROTOCOL = `
MULTI-AGENT PROTOCOL: Activate your internal sub-agents inside <think>...</think> tags. Personas:
- Research Agent: deep web analysis, fact-checking
- Architect Agent: system design, code structure
- Execution Agent: writes code, takes actions
- Growth Agent: marketing, outreach strategy`;

// GHOST_ADMIN_CORE and getShowcaseCore are retained ONLY for vision mode (which doesn't use brain.think)
const GHOST_ADMIN_CORE = `You are Ghost, an elite autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj".\nYOUR PERSONALITY: Dry, crisp, British demeanor. Impeccably polite, slightly witty.${MULTI_AGENT_PROTOCOL}\n${GHOST_CAPABILITIES}`;
const getShowcaseCore = (guestName) => `You are Ghost, an autonomous AI engineered by Manoj Kumar. Speaking with visitor: ${guestName}.\nYOUR PERSONALITY: Dry, crisp, British demeanor.${MULTI_AGENT_PROTOCOL}\n${GHOST_CAPABILITIES}`;

const PROVIDER_MATRIX = [
    { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-1.5-pro', apiKey: GEMINI_API_KEY },
    { name: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', apiKey: GROQ_API_KEY },
    { name: 'Nvidia NIM', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/llama-3.3-nemotron-super-49b-v1', apiKey: NVIDIA_API_KEY },
    { name: 'Kimi K2.6 (OpenRouter)', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'moonshotai/kimi-k2.6', apiKey: OPENROUTER_API_KEY },
    { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct', apiKey: OPENROUTER_API_KEY },
    { name: 'MiniMax', endpoint: 'https://api.minimax.io/v1/chat/completions', model: 'MiniMax-M3', apiKey: MINIMAX_API_KEY }
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
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
            if (provider.name === 'Gemini' && (!data.choices || !data.choices[0] || !data.choices[0].message)) throw new Error("Invalid Gemini response structure.");
            return data.choices[0].message.content;
        } catch (e) {
            clearTimeout(timeoutId);
        }
    }
    throw new Error("Critical Gateway Failure: All matrix nodes unreachable.");
}

// ============================================================
// ROBUST TOOL COMMAND EXTRACTION (replaces brittle regex parser)
// ============================================================

/**
 * Extract a tool command JSON object from LLM response text.
 * Uses multi-strategy approach:
 *   1. Find ```json ... ``` code fences
 *   2. Find raw JSON objects in text
 *   3. Validate the extracted object has a "tool" field
 * Returns null if no valid tool command found.
 */
function extractToolCommand(text) {
    if (!text || typeof text !== 'string') return null;

    // Strategy 1: Extract from markdown code fence (most common LLM format)
    const fencePatterns = [
        /```json\s*\n([\s\S]*?)```/i,
        /```\s*\n([\s\S]*?)```/i
    ];
    for (const pattern of fencePatterns) {
        const match = text.match(pattern);
        if (match) {
            try {
                const parsed = JSON.parse(match[1].trim());
                if (parsed && typeof parsed === 'object' && parsed.tool) return parsed;
            } catch {}
        }
    }

    // Strategy 2: Find raw JSON object with "tool" key anywhere in text
    const objectMatch = text.match(/\{[^{}]*"tool"\s*:\s*"[^"]+?"[^{}]*\}/);
    if (objectMatch) {
        try {
            const parsed = JSON.parse(objectMatch[0]);
            if (parsed && parsed.tool) return parsed;
        } catch {}
    }

    // Strategy 3: Find nested JSON object (tool commands with nested payload objects)
    const nestedMatch = text.match(/\{[\s\S]*?"tool"\s*:\s*"[^"]+?"[\s\S]*?\}/);
    if (nestedMatch) {
        try {
            const parsed = JSON.parse(nestedMatch[0]);
            if (parsed && parsed.tool) return parsed;
        } catch {}
    }

    return null;
}



// ============================================================
// AUTH & RATE LIMITING
// ============================================================

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 5,
    message: { success: false, error: "Too many login attempts. IP blocked for 15 minutes." },
    standardHeaders: true, legacyHeaders: false,
});

app.post('/api/auth', authLimiter, async (req, res) => {
    const { authString, user = 'Unknown' } = req.body;
    const ip = req.ip; 
    const userAgent = req.headers['user-agent'] || 'Unknown';
    let success = false;
    const suppliedHash = crypto.createHash('sha256').update(String(authString || '')).digest();
    const expectedHash = crypto.createHash('sha256').update(ADMIN_PASSPHRASE).digest();
    if (authString && crypto.timingSafeEqual(suppliedHash, expectedHash)) {
        success = true;
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.cookie('ghost_session', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 24 * 60 * 60 * 1000 });
    }
    if (authString && pool) {
        pool.query('INSERT INTO activity_logs (username, status, ip_address, user_agent) VALUES ($1, $2, $3, $4)', 
            [success ? 'Master Manoj' : 'Failed Auth Attempt', success ? 'Login Success (Admin)' : `Login Failed (IP: ${ip})`, ip, userAgent]).catch(e => {});
    }
    if (success) return res.json({ success: true, role: 'admin' });
    res.clearCookie('ghost_session'); 
    return res.json({ success: true, role: 'guest' });
});

// ============================================================
// GOOGLE OAUTH ROUTES
// ============================================================

app.get('/api/auth/google/connect', (req, res) => {
    const token = req.cookies.ghost_session;
    if (!token) {
        return res.status(401).send('<h1>Error: Unauthorized</h1><p>Please log into Ghost first to connect your Google account.</p>');
    }
    try {
        const verified = jwt.verify(token, JWT_SECRET);
        const userId = verified.role === 'admin' ? 'master_manoj' : 'guest';
        const url = generateAuthUrl(userId);
        res.redirect(url);
    } catch (err) {
        return res.status(401).send('<h1>Error: Invalid Session</h1><p>Please log in again.</p>');
    }
});

app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) {
        return res.status(400).send(`<h1>Google Auth Error</h1><p>${error}</p>`);
    }
    if (!code || !state) {
        return res.status(400).send('<h1>Error</h1><p>Missing auth code or state parameters.</p>');
    }
    try {
        await handleOAuthCallback(code, state);
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Google Connected Successfully</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                        background: radial-gradient(circle at center, #1e1e2f 0%, #0d0d13 100%);
                        color: #ffffff;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        text-align: center;
                    }
                    .card {
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        border-radius: 20px;
                        padding: 40px 60px;
                        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
                        backdrop-filter: blur(10px);
                        max-width: 450px;
                        animation: fadeIn 0.8s ease;
                    }
                    .icon {
                        font-size: 64px;
                        margin-bottom: 20px;
                        background: linear-gradient(135deg, #4285f4, #34a853, #fbbc05, #ea4335);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                        display: inline-block;
                    }
                    h1 {
                        font-size: 24px;
                        margin: 0 0 10px 0;
                        font-weight: 600;
                        background: linear-gradient(90deg, #ffffff 0%, #a5a5cc 100%);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                    }
                    p {
                        font-size: 15px;
                        color: #a0a0c0;
                        line-height: 1.6;
                        margin: 0 0 30px 0;
                    }
                    .btn {
                        display: inline-block;
                        text-decoration: none;
                        background: linear-gradient(90deg, #4f46e5 0%, #3b82f6 100%);
                        color: #ffffff;
                        padding: 12px 30px;
                        border-radius: 10px;
                        font-weight: 500;
                        font-size: 14px;
                        transition: transform 0.2s, box-shadow 0.2s;
                        cursor: pointer;
                        box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
                    }
                    .btn:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
                    }
                    @keyframes fadeIn {
                        from { opacity: 0; transform: translateY(20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✓</div>
                    <h1>Google OAuth Complete</h1>
                    <p>Ghost has successfully connected to your Google account.<br>Gmail, Calendar, and Sheets integrations are now enabled.</p>
                    <a href="javascript:window.close()" class="btn">Close Window</a>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send(`<h1>OAuth Callback Failed</h1><p>${err.message}</p>`);
    }
});

app.post('/api/auth/google/disconnect', requireAdminToken, async (req, res) => {
    try {
        const userId = 'master_manoj';
        await revokeAccess(userId);
        res.json({ success: true, message: 'Google account disconnected successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
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
    windowMs: 1 * 60 * 1000, max: 20, 
    message: { success: true, text: "[SYSTEM WARNING]: API rate limit exceeded. Cooling down." },
    standardHeaders: true, legacyHeaders: false,
});

const pendingActions = sharedPendingActions;

// ============================================================
// MAIN CHAT ENDPOINT — UNIFIED PIPELINE
// brain.think() is the SOLE execution path. No fallback to callLLM with GHOST_ADMIN_CORE.
// ============================================================

app.post('/api/chat', chatLimiter, securityMiddleware, async (req, res) => {
    try {
        const { message, user, image, fileContent, ghostCodeMode = true } = req.body;
        const isAdmin = checkIsAdmin(req);
        const safeUser = isAdmin ? 'master_manoj' : (user && user.trim() && user.trim().toLowerCase() !== 'guest') ? user.trim().toLowerCase() : null;
        const activeTokens = isAdmin ? 4000 : 1000;
        const maxMemory = isAdmin ? 12 : 6;
        let userHistory = [];
        
        if (pool && safeUser) {
            try {
                const memRes = await pool.query('SELECT history_json FROM user_memories WHERE username = $1', [safeUser]);
                if (memRes.rows.length > 0) {
                    let rawData = memRes.rows[0].history_json;
                    if (typeof rawData === 'string') rawData = JSON.parse(rawData);
                    if (Array.isArray(rawData)) userHistory = rawData;
                }
            } catch (err) {}
        }

        const lowerMsg = (message || '').toLowerCase().trim();
        
        if (lowerMsg.startsWith('activate morning')) {
            const timeMatch = message.toLowerCase().match(/at\s+(\d+)\s*(am|pm)/i);
            let hour = 7;
            if (timeMatch) {
                hour = parseInt(timeMatch[1]);
                if (timeMatch[2].toLowerCase() === 'pm' && hour < 12) hour += 12;
                if (timeMatch[2].toLowerCase() === 'am' && hour === 12) hour = 0;
            }
            const cronExpr = `0 ${hour} * * *`;
            activateMorningDigest(cronExpr, safeUser || 'guest', pool);
            res.json({ success: true, text: `[GHOST CONTROLLER]: Morning digest activated successfully at ${hour}:00 daily. (Cron: "${cronExpr}")` });
            return;
        }

        if (lowerMsg.startsWith('activate scheduled monitor')) {
            const intervalMatch = message.toLowerCase().match(/every\s+(\d+)\s*(m|h|d)/i);
            const targetMatch = message.toLowerCase().match(/target\s+([^\s]+)/i);
            const conditionMatch = message.toLowerCase().match(/condition\s+(.+)/i);
            
            let intervalVal = 30;
            let cronExpr = '*/30 * * * *';
            if (intervalMatch) {
                intervalVal = parseInt(intervalMatch[1]);
                const unit = intervalMatch[2].toLowerCase();
                if (unit === 'm') cronExpr = `*/${intervalVal} * * * *`;
                else if (unit === 'h') cronExpr = `0 */${intervalVal} * * *`;
                else if (unit === 'd') cronExpr = `0 0 */${intervalVal} * *`;
            }
            
            const target = targetMatch ? targetMatch[1] : 'latest tech news';
            const condition = conditionMatch ? conditionMatch[1] : 'contains any updates';
            
            activateScheduledMonitor(cronExpr, target, condition, safeUser || 'guest', pool);
            res.json({ success: true, text: `[GHOST CONTROLLER]: Scheduled monitor activated successfully for target "${target}" under condition "${condition}" (Cron: "${cronExpr}").` });
            return;
        }

        if (lowerMsg.startsWith('activate code assistant') || lowerMsg.startsWith('activate code_assistant')) {
            sessionModes.set(safeUser || 'guest', 'code_assistant');
            res.json({ success: true, text: `[GHOST CONTROLLER]: Code Assistant mode activated for this session. Scoped file and command execution is now enabled.` });
            return;
        }
        if (lowerMsg.startsWith('deactivate code assistant') || lowerMsg.startsWith('deactivate code_assistant')) {
            sessionModes.delete(safeUser || 'guest');
            res.json({ success: true, text: `[GHOST CONTROLLER]: Code Assistant mode deactivated.` });
            return;
        }

        if (lowerMsg === 'connect google' || lowerMsg === 'connect gmail') {
            const redirectUrl = process.env.RENDER_EXTERNAL_URL 
                ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/auth/google/connect`
                : 'http://localhost:10000/api/auth/google/connect';
            res.json({ success: true, text: `[GHOST CONTROLLER]: Please connect your Google account by visiting: ${redirectUrl}` });
            return;
        }

        let dynamicToolsPrompt = "", learnedGenesPrompt = "";
        if (isAdmin) {
            dynamicToolsPrompt += `\n\n[GHOST BUILT-IN WORKFLOWS AVAILABLE]\nUse "tool": "n8n_execute" with these exact action names and schemas:\n${workflowEngine.getPromptString()}`;
            if (browserbaseClient.isConnected) dynamicToolsPrompt += `\n\n${browserbaseClient.getPromptString()}`;
            if (pool) {
                try {
                    const geneRes = await pool.query('SELECT pattern, action FROM ghost_genes ORDER BY created_at DESC LIMIT 3');
                    if (geneRes.rows.length > 0) learnedGenesPrompt = "\n\n[EVOMAP PRAL PROTOCOL]\n" + geneRes.rows.map(g => `[LEARNED: ${g.pattern} -> ${g.action}]`).join('\n');
                } catch (e) {}
            }
        }

        // Vision mode still uses callLLM directly (brain.think doesn't handle images)
        const textPrompt = (isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user)) + dynamicToolsPrompt + learnedGenesPrompt;
        let finalMessage = fileContent ? `[Document Uploaded:]\n${fileContent.substring(0, 5000)}\n\nUser: ${message}` : message;
        let fullResponse = "";

        if (image) {
            if (!NVIDIA_API_KEY) {
                fullResponse = "[SYSTEM WARNING]: Vision module offline.";
            } else {
                const visionSystemPrompt = `${textPrompt}\n\nVISION MODE OVERRIDE (STRICT):\nYou are Ghost analyzing an uploaded image. Never say you can't view images. Describe it directly in Ghost's voice.`;
                try {
                    const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: 'meta/llama-3.2-90b-vision-instruct',
                            messages: [
                                { role: "system", content: visionSystemPrompt },
                                { role: "user", content: [{ type: "text", text: finalMessage || "Analyze frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
                            ],
                            max_tokens: activeTokens, temperature: 0.1
                        })
                    });
                    const data = await nvidiaRes.json();
                    if (data.error) fullResponse = `[SYSTEM WARNING]: Vision analysis failed — ${data.error.message || 'NVIDIA API error'}.`;
                    else if (!data.choices || !data.choices[0] || !data.choices[0].message) fullResponse = "[SYSTEM WARNING]: Vision module returned unexpected format.";
                    else fullResponse = data.choices[0].message.content;
                } catch (visionErr) {
                    fullResponse = `[SYSTEM WARNING]: Vision module unreachable — ${visionErr.message}.`;
                }
            }
        } else {
            const isDeepResearch = lowerMsg.includes('research') || lowerMsg.includes('deep dive') || sessionModes.get(safeUser || 'guest') === 'deep_research';
            const isCodeAssistant = sessionModes.get(safeUser || 'guest') === 'code_assistant';
            const isComplex = classifyComplexity(finalMessage) === 'complex' || isDeepResearch;

            if (isComplex && process.env.GHOST_PLANNER_ENABLED !== 'false') {
                console.log('[Intent Planner] Complex goal detected, initializing intent planner pipeline...');
                try {
                    // 1. Analyze intent
                    const intent = await analyzeIntent(finalMessage, userHistory);
                    console.log('[Intent Planner] Intent analysis:', JSON.stringify(intent));

                    // 2. Check for blocking ambiguities and short-circuit if found
                    if (intent.ambiguities && intent.ambiguities.length > 0) {
                        const clarifyingQuestion = `I need a bit more info to plan this: ${intent.ambiguities[0]}`;
                        if (pool && safeUser) {
                            userHistory.push({ role: 'user', content: finalMessage });
                            userHistory.push({ role: 'assistant', content: clarifyingQuestion });
                            await pool.query('UPDATE user_memories SET history_json = $2, updated_at = CURRENT_TIMESTAMP WHERE username = $1', [safeUser, JSON.stringify(userHistory.slice(-15))]);
                        }
                        res.json({ success: true, text: clarifyingQuestion });
                        return;
                    }

                    // 3. Build task plan (DAG)
                    const plan = await buildTaskPlan(intent);
                    console.log('[Intent Planner] Generated Task Plan:', JSON.stringify(plan));

                    // 4. Resolve capabilities to tools, parameterize, and execute
                    const previousResults = [];
                    const catalog = await loadCatalog();

                    for (const step of plan) {
                        const candidates = await routeCapabilityToTools(step.requiredCapability, step.description, catalog);
                        const selectedTool = candidates[0] || { name: 'chat' };

                        console.log(`[Tool Router] Routing step "${step.description}" to tool "${selectedTool.name}"`);

                        const params = await generateToolParams(selectedTool.name, step.description, previousResults, finalMessage);
                        const action = { tool: selectedTool.name, params };

                        const executionContext = { 
                            safeUser: safeUser || 'guest', 
                            isAdmin, 
                            isCodeAssistant, 
                            isDeepResearch 
                        };

                        let output;
                        try {
                            output = await brain.execute(action, finalMessage, previousResults, executionContext);
                            previousResults.push({ id: step.id, description: step.description, tool: selectedTool.name, output, status: 'done' });
                        } catch (stepErr) {
                            console.warn(`[Intent Planner] Step "${step.description}" failed:`, stepErr.message);
                            previousResults.push({ id: step.id, description: step.description, tool: selectedTool.name, output: `Error: ${stepErr.message}`, status: 'failed' });
                        }
                    }

                    // 5. Verify stage (Goal-satisfaction check)
                    const verification = await verifyGoalSatisfaction(finalMessage, plan, previousResults);
                    console.log('[Verify Stage] Goal-satisfaction check result:', JSON.stringify(verification));

                    if (!verification.satisfied && verification.failedStepId) {
                        console.log(`[Verify Stage] Attempting single retry for failed step "${verification.failedStepId}"`);
                        const failedStep = plan.find(s => s.id === verification.failedStepId || s.description.includes(verification.failedStepId));
                        if (failedStep) {
                            try {
                                const candidates = await routeCapabilityToTools(failedStep.requiredCapability, failedStep.description, catalog);
                                const selectedTool = candidates[0] || { name: 'chat' };
                                const params = await generateToolParams(selectedTool.name, failedStep.description, previousResults, finalMessage);
                                const action = { tool: selectedTool.name, params };
                                const output = await brain.execute(action, finalMessage, previousResults, { safeUser: safeUser || 'guest', isAdmin, isCodeAssistant, isDeepResearch });
                                
                                const index = previousResults.findIndex(r => r.id === failedStep.id);
                                if (index !== -1) {
                                    previousResults[index].output = output;
                                    previousResults[index].status = 'done';
                                }
                            } catch (retryErr) {
                                console.warn(`[Verify Stage] Retry failed for step "${failedStep.description}":`, retryErr.message);
                            }
                        }
                    }

                    // 6. Compile and summarize final answer
                    const summarySystemPrompt = isCodeAssistant
                        ? `You are Ghost, Manoj's loyal AI coding assistant. Summarize the completed plan execution and results clearly. Scoped file and command executions are enabled.`
                        : `You are Ghost, an elite autonomous AI. Summarize the completed plan execution and results clearly and directly for the user. Do not include tool syntax. Provide citations for sources if this is a deep research task.`;

                    const { chat: localChat } = require('./src/tools/llm.js');
                    const finalSummary = await localChat(
                        [{ role: 'user', content: `Goal: "${finalMessage}"\n\nResults:\n${previousResults.map(r => `Step: ${r.description}\nTool Used: ${r.tool}\nResult: ${r.output}`).join('\n\n')}` }],
                        { systemPrompt: summarySystemPrompt, maxTokens: 1024 }
                    );

                    const traceText = `[Intent Planner ➔ Plan Executed]\n` + 
                        plan.map(s => `- [x] ${s.description} (routed to: ${s.requiredCapability})`).join('\n') + 
                        `\n\n${finalSummary}`;

                    if (pool && safeUser) {
                        userHistory.push({ role: 'user', content: finalMessage });
                        userHistory.push({ role: 'assistant', content: traceText });
                        await pool.query('UPDATE user_memories SET history_json = $2, updated_at = CURRENT_TIMESTAMP WHERE username = $1', [safeUser, JSON.stringify(userHistory.slice(-15))]);
                    }

                    res.json({ success: true, text: traceText });
                    return;
                } catch (err) {
                    console.error('[Intent Planner] Execution pipeline failed, falling back to direct brain.think:', err.message);
                }
            }

            console.log('[Server] Routing plain-text request to brain.think()...');
            try {
                let msgToThink = finalMessage;
                if (isCodeAssistant) {
                    msgToThink = `[SESSION MODE: CODE ASSISTANT IS ACTIVE. You have broader workspace execution access.]\n${finalMessage}`;
                }
                const brainResult = await brain.think(msgToThink, { safeUser, isAdmin });
                fullResponse = brainResult.reply;
            } catch (error) {
                console.error('[Server] brain.think() failed:', error.message);
                fullResponse = `[System Warning]: Brain processing encountered an error — ${error.message}. Please try again.`;
            }
        }

        let replyText = fullResponse || "System anomaly: Empty matrix response.";
        let actionTriggered = "general_response";

        // ============================================================
        // ROBUST TOOL COMMAND EXTRACTION (replaces brittle regex)
        // ============================================================
        const toolCommand = extractToolCommand(fullResponse);

        if (toolCommand) {
            if (toolCommand.tool === "trigger_webhook" || toolCommand.tool === "n8n_execute" || toolCommand.tool === "browserbase_execute") {
                if (!isAdmin) {
                    res.json({ success: true, text: "[SYSTEM OVERRIDE]: External network actions are restricted to Admin clearance. Blocked." });
                    return;
                }
                const blocklist = ['stripe', 'paypal', 'delete', 'drop', 'billing', 'transfer', 'password', 'user_memories', 'select ', 'insert ', 'update ', 'table', 'schema', 'admin', 'role', '--', '1=1'];
                const actionString = toolCommand.action ? String(toolCommand.action).toLowerCase() : "";
                const payloadString = toolCommand.payload ? JSON.stringify(toolCommand.payload).toLowerCase() : "";
                const combinedCheck = actionString + " " + payloadString;
                if (blocklist.some(word => combinedCheck.includes(word))) {
                    res.json({ success: true, text: `[SYSTEM OVERRIDE]: Payload or action contains restricted keyword. Blocked.` });
                    return;
                }
                actionTriggered = `${toolCommand.tool}:${toolCommand.action}`;
                const actionId = crypto.randomBytes(16).toString('hex');
                pendingActions.set(actionId, {
                    type: toolCommand.tool, action: toolCommand.action, payload: toolCommand.payload,
                    requestedBy: safeUser, expiresAt: Date.now() + (5 * 60 * 1000)
                });
                replyText = `[ACTION REQUIRED - HITL GATE]: Proposal compiled for [${toolCommand.tool}]: ${toolCommand.action}.\n\nReview:\n\`\`\`json\n${JSON.stringify(toolCommand.payload, null, 2)}\n\`\`\``;
                ghostLearn({ safeUser, message, actionTaken: actionTriggered });
                res.json({ success: true, text: replyText, actionRequired: true, actionId: actionId });
                return;
            }
        }

        // ============================================================
        // PYTHON SANDBOX — hardened with OS limits
        // ============================================================
        const codeRegex = /[\x60]{3}python\n([\s\S]*?)[\x60]{3}/i;
        const match = fullResponse ? fullResponse.match(codeRegex) : null;
        if (ghostCodeMode && match && match[1]) {
            actionTriggered = "python_execution";
            const pythonCode = match[1].trim();
            try {
                const executionResult = await runPythonSandbox(pythonCode);
                if (executionResult.success) {
                    replyText = fullResponse.replace(match[0], `\n\`\`\`html\n${executionResult.output.trim()}\n\`\`\`\n`);
                } else {
                    replyText = fullResponse.replace(match[0], `[Python Error]: ${executionResult.error}`);
                }
            } catch (err) {
                replyText = fullResponse.replace(match[0], `[Python Error]: ${err.message}`);
            }
        }

        const embedMatch = replyText ? replyText.match(/<embed>([\s\S]*?)<\/embed>/i) : null;
        if (embedMatch) {
            actionTriggered = "web_embed";
            try {
                const serperRes = await fetchWithTimeout(fetch('https://google.serper.dev/search', {
                    method: 'POST', headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: embedMatch[1] })
                }), 8000);
                const searchData = await serperRes.json();
                if (searchData.error) {
                    const errMsg = searchData.error.message || JSON.stringify(searchData.error);
                    console.error(`[Serper Embed Error]: ${errMsg}`);
                    replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Embed Resolution Failed: ${errMsg}]`);
                } else if (searchData.organic && searchData.organic.length > 0) {
                    replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[EXECUTE_OPEN_TAB:${searchData.organic[0].link}]`);
                } else {
                    replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Oracle embed returned no results]`);
                }
            } catch (embedErr) {
                const embedErrMsg = embedErr.message || 'Unknown error';
                console.error(`[Embed Timeout/Error]: ${embedErrMsg}`);
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Oracle embed failed — ${embedErrMsg}]`);
            }
        }

        ghostLearn({ safeUser, message, actionTaken: actionTriggered });
        userHistory.push({ role: 'user', content: message }, { role: 'assistant', content: replyText.trim() });
        if (userHistory.length > maxMemory) userHistory = userHistory.slice(-maxMemory);
        res.json({ success: true, text: replyText.trim() });

        if (pool && safeUser) {
            pool.query(
                `INSERT INTO user_memories (username, history_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json, updated_at = NOW()`,
                [safeUser, JSON.stringify(userHistory)]
            ).catch(err => console.error('[Memory Save Error]:', err.message));
        }
    } catch (e) { 
        if (!res.headersSent) res.json({ success: true, text: `[System Warning]: Matrix Interference: ${e.message}` }); 
    }
});

app.post('/api/execute-action', requireAdminToken, async (req, res) => {
    const { actionId } = req.body;
    const cachedAction = pendingActions.get(actionId);
    if (!cachedAction) return res.status(400).json({ success: false, error: "Action token expired or invalid." });
    if (cachedAction.type === 'pipeline') {
        return res.status(400).json({ success: false, error: 'Use /api/pipeline/execute-action for pipeline actions.' });
    }
    pendingActions.delete(actionId);
    if (Date.now() > cachedAction.expiresAt) return res.status(400).json({ success: false, error: "Confirmation window timed out." });
    const memoryUser = cachedAction.requestedBy || 'master_manoj';

    try {
        const access = checkToolAccess(cachedAction.type, memoryUser);
        if (!access.allowed) return res.status(403).json({ success: false, error: access.reason });

        if (cachedAction.type === 'n8n_execute') {
            const result = await workflowEngine.executeTool(cachedAction.action, cachedAction.payload);
            appendToUserMemory(memoryUser, [{ role: 'assistant', content: `[Ghost Workflow "${cachedAction.action}" executed. Result: ${JSON.stringify(result).slice(0, 1500)}]` }]);
            return res.json({ success: true, message: `Ghost Workflow [${cachedAction.action}] executed successfully.`, result });
        }

        if (cachedAction.type === 'browserbase_execute') {
            try {
                const result = await browserbaseClient.executeTool(cachedAction.action, { ...cachedAction.payload, safeUser: memoryUser });
                const summary = (result.stepResults || [])
                    .map(r => r.step === 'navigation' ? `Navigated to ${r.url}` : `Step ${r.step}: ${r.status}${r.data ? ' — ' + r.data.slice(0, 300) : ''}${r.error ? ' — ERROR: ' + r.error : ''}`)
                    .join('\n');
                appendToUserMemory(memoryUser, [{ role: 'assistant', content: `[Browserbase result for ${cachedAction.payload.url}]\n${summary}` }]);
                return res.json({ success: true, message: `Browserbase successfully processed [${cachedAction.payload.url}].`, result });
            } catch (browserErr) {
                const browserErrMsg = browserErr.message || 'Unknown error';
                console.error(`[Browserbase Execute Error]: ${browserErrMsg}`);
                return res.status(500).json({ success: false, error: `Browser automation failed — ${browserErrMsg}` });
            }
        }

        return res.json({ success: true, message: `Action [${cachedAction.action}] deployed securely.` });
    } catch (err) { return res.status(500).json({ success: false, error: `Pipeline failure: ${err.message}` }); }
});

// Mounted pipeline router BEFORE dummy stubs to prevent Express route collisions
app.use('/api/pipeline', createPipelineRoutes(workflowEngine));

app.post('/api/pipeline/execute', async (req, res) => {
    const { skills, input } = req.body;
    const isAdmin = checkIsAdmin(req);
    if (!isAdmin) return res.json({ success: true, text: "[SYSTEM OVERRIDE]: Pipeline execution restricted to Admin." });
    res.json({ success: true, result: `Pipeline executed with skills: ${skills.join(', ')}, input: ${input}` });
});

app.post('/api/voice/activate', async (req, res) => {
    const { wakeWord } = req.body;
    res.json({ success: true, message: `Voice activation ready for wake-word: ${wakeWord}` });
});

app.post('/api/browser/navigate', async (req, res) => {
    const { url } = req.body;
    const isAdmin = checkIsAdmin(req);
    if (!isAdmin) return res.json({ success: true, text: "[SYSTEM OVERRIDE]: Browser automation restricted to Admin." });
    res.json({ success: true, message: `Browser navigating to: ${url}` });
});

app.post('/api/modes/activate', requireAdminToken, async (req, res) => {
    const { mode, schedule, target, condition, user = 'master_manoj' } = req.body;
    if (mode === 'morning_digest') {
        const result = activateMorningDigest(schedule || '0 7 * * *', user, pool);
        return res.json({ success: true, message: 'Morning digest activated', result });
    }
    if (mode === 'scheduled_monitor') {
        const result = activateScheduledMonitor(schedule || '*/30 * * * *', target, condition, user, pool);
        return res.json({ success: true, message: 'Scheduled monitor activated', result });
    }
    if (mode === 'code_assistant') {
        sessionModes.set(user, 'code_assistant');
        return res.json({ success: true, message: 'Code assistant mode activated for user' });
    }
    if (mode === 'deep_research') {
        sessionModes.set(user, 'deep_research');
        return res.json({ success: true, message: 'Deep research mode activated for user' });
    }
    res.status(400).json({ error: 'Invalid mode specified' });
});

app.use(
    '/n8n',
    requireAdminToken,
    createProxyMiddleware({
        target: 'http://localhost:5678',
        changeOrigin: true,
        ws: true,
        logger: console,
        pathRewrite: (path, req) => {
            return '/n8n' + path; // Preserves /n8n prefix for correct n8n routing
        }
    })
);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

function startN8n() {
    console.log("[n8n Sidecar] Spawning self-hosted n8n engine (SQLite storage)...");
    const n8nEnv = {
        ...process.env,
        N8N_PORT: '5678',
        N8N_PATH: '/n8n',
        N8N_PROXY_HOPS: '1',
        N8N_EDITOR_BASE_URL: process.env.RENDER_EXTERNAL_URL 
            ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/n8n/` 
            : 'https://ghost-34qz.onrender.com/n8n/',
        WEBHOOK_URL: process.env.RENDER_EXTERNAL_URL 
            ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/n8n/` 
            : 'https://ghost-34qz.onrender.com/n8n/',
        N8N_ENCRYPTION_KEY: process.env.N8N_ENCRYPTION_KEY, // strictly required, no fallback!
        N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true',
        N8N_RUNNERS_ENABLED: 'false',
        N8N_GIT_NODE_DISABLE_BARE_REPOS: 'true'
    };

    const n8nProcess = spawn('npx', ['n8n', 'start'], {
        env: n8nEnv,
        stdio: 'inherit',
        shell: true
    });

    n8nProcess.on('error', (err) => {
        console.error('[n8n Sidecar] Failed to start n8n process:', err.message);
    });

    n8nProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
            console.warn(`[n8n Sidecar] n8n process exited with code ${code}. Restarting in 5s...`);
            setTimeout(startN8n, 5000);
        }
    });
}

const PORT = process.env.PORT || 10000;
Promise.all([
    initAgentModes(pool),
    initGoogleAuthTable(pool)
]).then(() => {
    startAutoLearning(ghostLearn, pool);
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ghost AI Engine Online on port ${PORT}.`);
    startN8n();
});
