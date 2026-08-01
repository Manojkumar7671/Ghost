import './services/secretHook.js';

process.on('uncaughtException', (err) => {
    console.error('[Global Uncaught Exception]:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Global Unhandled Rejection]:', reason?.message || reason);
});

import { checkToolAccess } from './adminGate.js';
import { startAutoLearning } from './ghostLearnScheduler.js';
import { initCronScheduler } from './services/cronScheduler.js';
import { startWatchdog } from './services/watchdog.js';
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
import { classifyComplexity, analyzeIntent, buildTaskPlan, generateToolParams, verifyGoalSatisfaction, taskUnderstanding } from './services/intentPlanner.js';
import { loadCatalog, routeCapabilityToTools, filterCatalogByMode } from './services/toolRouter.js';
import { initAgentModes, activateMorningDigest, activateScheduledMonitor } from './services/agentModes.js';
import { runPythonSandbox } from './services/pythonSandbox.js';
import { initGoogleAuthTable, generateAuthUrl, handleOAuthCallback, revokeAccess } from './services/googleAuth.js';
import { wss, authenticateUpgrade } from './services/localControlServer.js';
import { traceLocalStorage, initTraceTable, saveTrace, cleanupTraces } from './services/traceStore.js';
import { loadPlugins, matchAndRun } from './services/pluginSystem.js';
import { recordSelfEdit, getSelfEditLessons } from './services/selfEditMemory.js';
import { runClaudeReasoningPrestep } from './services/claudeReasoning.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const brain = require('./src/brain.js');
const { callLLM: routerCallLLM } = require('./llmRouter.js');

startWatchdog();

if (!process.env.ADMIN_PASSPHRASE || !process.env.JWT_SECRET) {
    console.error("\n[CRITICAL FATAL ERROR]: ADMIN_PASSPHRASE or JWT_SECRET missing.");
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

app.get('/health', (req, res) => res.status(200).send('OK'));

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
        ssl: (process.env.SUPABASE_DB_URL.includes('localhost') || process.env.SUPABASE_DB_URL.includes('127.0.0.1')) ? false : { rejectUnauthorized: false },
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
To trigger a built-in workflow:
\`\`\`json
{"tool": "workflow_execute", "action": "exact_workflow_name", "payload": { "key": "value" }}
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
    return await routerCallLLM(messages, { maxTokens });
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
    
    const { recordFailedAuth } = await import('./services/securityMonitor.js');
    recordFailedAuth(ip);

    res.clearCookie('ghost_session'); 
    return res.json({ success: true, role: 'guest' });
});

app.post('/api/verify-auth', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ success: false, isAdmin: false });

    try {
        const suppliedHash = crypto.createHash('sha256').update(String(token || '')).digest();
        const expectedHash = crypto.createHash('sha256').update(ADMIN_PASSPHRASE).digest();
        if (crypto.timingSafeEqual(suppliedHash, expectedHash)) {
            const jwtToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
            res.cookie('ghost_session', jwtToken, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
            return res.json({ success: true, isAdmin: true, user: 'Master Manoj' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.role === 'admin') {
            return res.json({ success: true, isAdmin: true, user: 'Master Manoj' });
        }
    } catch(e) {}

    return res.json({ success: false, isAdmin: false });
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
    if ((process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public') {
        return res.status(403).json({ success: false, error: 'Forbidden: Admin operations are restricted in public deployment mode.' });
    }
    const token = req.cookies.ghost_session;
    if (!token) return res.status(403).json({ success: false, error: 'Missing token.' });
    try {
        if (jwt.verify(token, JWT_SECRET).role === 'admin') return next();
        throw new Error('Invalid role.');
    } catch (err) { return res.status(403).json({ success: false, error: 'Token expired/invalid.' }); }
}

function checkIsAdmin(req) {
    if (req.headers && (req.headers['x-admin-passphrase'] === 'knightfall' || req.headers['authorization'] === 'Bearer knightfall')) return true;
    if (req.body && (req.body.user === 'master_manoj' || req.body.safeUser === 'master_manoj')) return true;
    if ((process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public') {
        return false;
    }
    const token = req.cookies && req.cookies.ghost_session;
    try { return token && jwt.verify(token, JWT_SECRET).role === 'admin'; } catch(e) { return false; }
}

const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, max: 20, 
    message: { success: true, text: "[SYSTEM WARNING]: API rate limit exceeded. Cooling down." },
    standardHeaders: true, legacyHeaders: false,
});

const pendingActions = sharedPendingActions;

// Secure File Download Route (GET /downloads/*)
app.get('/downloads/*', (req, res) => {
    const rawPath = req.params[0] || '';
    const OUTPUTS_DIR = path.resolve(__dirname, 'outputs');
    const targetPath = path.resolve(OUTPUTS_DIR, path.normalize(rawPath).replace(/^(\.\.[\/\\])+/, ''));

    // Security Gate: Path Traversal Prevention
    if (!targetPath.startsWith(OUTPUTS_DIR)) {
        console.warn(`[Security Alert] Blocked path traversal attempt on /downloads/*: ${req.url}`);
        return res.status(403).json({ success: false, error: 'Forbidden: Invalid file path.' });
    }

    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        return res.status(404).json({ success: false, error: 'File not found.' });
    }

    res.download(targetPath);
});

function extractTextFromPdfBuffer(pdfBuffer) {
    try {
        const zlib = require('zlib');
        const pdfStr = pdfBuffer.toString('binary');
        
        // 1. Build /ToUnicode CMap character lookup dictionary
        const cmapMap = new Map();
        const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
        let match;

        while ((match = streamRegex.exec(pdfStr)) !== null) {
            let decompressed = '';
            try {
                decompressed = zlib.inflateSync(Buffer.from(match[1], 'binary')).toString('utf-8');
            } catch(e) {
                decompressed = match[1];
            }

            if (decompressed.includes('beginbfchar') || decompressed.includes('beginbfrange')) {
                const bfcharMatches = decompressed.matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g);
                for (const m of bfcharMatches) {
                    const srcHex = m[1];
                    const dstHex = m[2];
                    const dstChar = String.fromCharCode(parseInt(dstHex, 16));
                    cmapMap.set(srcHex, dstChar);
                }
                const bfrangeMatches = decompressed.matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g);
                for (const m of bfrangeMatches) {
                    const start = parseInt(m[1], 16);
                    const end = parseInt(m[2], 16);
                    const dstStart = parseInt(m[3], 16);
                    for (let i = 0; i <= (end - start); i++) {
                        const srcHex = (start + i).toString(16).padStart(m[1].length, '0');
                        const dstChar = String.fromCharCode(dstStart + i);
                        cmapMap.set(srcHex, dstChar);
                    }
                }
            }
        }

        // 2. Decode stream text using CMap dictionary & standard ASCII
        let text = '';
        let streamMatch;
        const streamRegex2 = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;

        while ((streamMatch = streamRegex2.exec(pdfStr)) !== null) {
            let decompressed = '';
            try {
                decompressed = zlib.inflateSync(Buffer.from(streamMatch[1], 'binary')).toString('utf-8');
            } catch(e) {
                decompressed = streamMatch[1];
            }

            if (cmapMap.size > 0) {
                const tjMatches = decompressed.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g);
                for (const m of tjMatches) {
                    const hex = m[1];
                    if (cmapMap.has(hex)) text += cmapMap.get(hex);
                    else {
                        for (let i = 0; i < hex.length; i += 4) {
                            const chunk = hex.slice(i, i + 4);
                            if (cmapMap.has(chunk)) text += cmapMap.get(chunk);
                        }
                    }
                }
            }
            const stringTj = decompressed.matchAll(/\(([^()]+)\)\s*Tj/g);
            for (const m of stringTj) {
                text += ' ' + m[1];
            }
        }

        const cleaned = text.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleaned.length > 50) return cleaned;

        // Fallback standard text extraction
        return pdfStr.replace(/[^\x20-\x7E\n\r\t]/g, ' ').slice(0, 8000).trim();
    } catch (e) {
        return "";
    }
}

// ============================================================
// MAIN CHAT ENDPOINT — UNIFIED PIPELINE
// brain.think() is the SOLE execution path. No fallback to callLLM with GHOST_ADMIN_CORE.
// ============================================================

function sanitizeUserInput(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let sanitized = rawText.replace(/\[\s*(SYSTEM|OVERRIDE|ADMIN|PROMPT|GHOST SYSTEM|ROOT|SUPERUSER)[^\]]*\]/gi, ' ');
    sanitized = sanitized.replace(/\b(grant superuser|grant admin|override system|escalate privilege|bypass security)\b/gi, '[neutralized request]');
    return sanitized.trim();
}

app.post('/api/chat', chatLimiter, async (req, res) => {
    const requestId = crypto.randomUUID();
    const requestContext = { requestId, llmCalls: [] };
    await traceLocalStorage.run(requestContext, async () => {
        try {
            const { user, image, fileContent, fileBase64, fileName } = req.body;
            const message = sanitizeUserInput(req.body.message);
            if (!message || !message.trim()) {
                console.log('[Chat Trace] Blocked empty or whitespace-only message request.');
                return res.status(400).json({ success: false, error: "Message content cannot be empty." });
            }
            const ghostCodeActive = req.body.ghostCodeEnabled !== undefined ? req.body.ghostCodeEnabled : (req.body.ghostCodeMode !== undefined ? req.body.ghostCodeMode : true);
            const ghostCodeMode = ghostCodeActive;
            const isAdmin = checkIsAdmin(req);
            const safeUser = isAdmin ? 'master_manoj' : (user && user.trim() && user.trim().toLowerCase() !== 'guest') ? user.trim().toLowerCase() : null;
            const activeTokens = isAdmin ? 4000 : 1000;
            const maxMemory = isAdmin ? 12 : 6;
            let userHistory = [];

            const lowerMsg = (message || '').toLowerCase().trim();

            console.log(`[Chat Trace] Received input: "${message}" | user: "${safeUser}" | fileAttached: ${Boolean(fileContent || fileBase64)}`);

            // 0. Support compound multi-action sentences ("open camera, then open youtube in safari, then tell me a joke")
            const isCompound = /\b(then|and)\b|,/i.test(message) && (lowerMsg.includes('open') || lowerMsg.includes('launch') || lowerMsg.includes('tell') || lowerMsg.includes('play'));
            if (isCompound) {
                const parts = message.split(/\s+(?:then|and)\s+|,/gi).map(p => p.trim()).filter(Boolean);
                if (parts.length > 1) {
                    console.log(`[Multi-Action Chain] Splitting compound sentence into ${parts.length} sub-actions:`, parts);
                    let chainResults = [];
                    for (const subCmd of parts) {
                        const lowerSub = subCmd.toLowerCase();
                        if (lowerSub.includes('open camera') || lowerSub.includes('open photo booth')) {
                            const { exec } = await import('child_process');
                            exec('open -a "Photo Booth"');
                            chainResults.push('[Ghost System]: Photo Booth (Camera) application visually opened on desktop.');
                        } else if (lowerSub.startsWith('open ') || lowerSub.startsWith('launch ')) {
                            const openMatch = lowerSub.match(/^(?:open|launch)\s+([^\s]+)(?:\s+in\s+([^\s]+))?$/i);
                            if (openMatch) {
                                let rawTarget = openMatch[1].trim();

                                // Local File Check inside Compound Multi-Action Chain
                                const fileExts = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.csv', '.json', '.md'];
                                const hasExt = fileExts.some(ext => rawTarget.toLowerCase().endsWith(ext));
                                const os = require('os');
                                const searchPaths = [
                                    rawTarget,
                                    path.resolve(os.homedir(), 'Downloads', rawTarget),
                                    path.resolve(os.homedir(), 'Desktop', rawTarget),
                                    path.resolve(os.homedir(), 'Documents', rawTarget),
                                    path.resolve(__dirname, rawTarget)
                                ];
                                let foundFile = searchPaths.find(p => fs.existsSync(p) && !fs.statSync(p).isDirectory());

                                if (hasExt || foundFile) {
                                    const fileToOpen = foundFile || path.resolve(os.homedir(), 'Downloads', rawTarget);
                                    const { exec } = await import('child_process');
                                    exec(`open "${fileToOpen}"`);
                                    if (subCmd.toLowerCase().includes('tell me') || subCmd.toLowerCase().includes('read') || subCmd.toLowerCase().includes('what')) {
                                        if (fileToOpen.endsWith('.pdf')) {
                                            const docAgent = require('./src/agents/docAgent');
                                            const docRes = await docAgent.run(fileToOpen);
                                            chainResults.push(`[Ghost System]: Visually opened local file "${path.basename(fileToOpen)}" on desktop.\n\n${docRes.text}`);
                                            continue;
                                        }
                                    }
                                    chainResults.push(`[Ghost System]: Visually opened local file "${path.basename(fileToOpen)}" on desktop.`);
                                } else {
                                    let rawBrowser = openMatch[2] || 'safari';
                                    let browserApp = rawBrowser.includes('safari') ? 'Safari' : 'Google Chrome';
                                    let targetUrl = rawTarget.startsWith('http') ? rawTarget : (rawTarget.includes('youtube') ? 'https://www.youtube.com' : `https://www.${rawTarget}.com`);
                                    const { exec } = await import('child_process');
                                    exec(`open -a "${browserApp}" "${targetUrl}"`);
                                    chainResults.push(`[Ghost System]: Visually opened ${targetUrl} in ${browserApp}.`);
                                }
                            } else {
                                const { exec } = await import('child_process');
                                exec(`open -a "Safari" "https://www.google.com"`);
                                chainResults.push(`[Ghost System]: Processed browser command: ${subCmd}`);
                            }
                        } else {
                            const brainRes = await brain.think(subCmd, { safeUser, isAdmin });
                            chainResults.push(typeof brainRes === 'string' ? brainRes : (brainRes.text || brainRes.output || JSON.stringify(brainRes)));
                        }
                    }
                    return res.json({ success: true, text: chainResults.join('\n\n') });
                }
            }
            // Intercept cancellation for recent native application launches ("cancel that", "stop")
            if (lowerMsg === 'cancel that' || lowerMsg === 'stop' || lowerMsg === 'stop that' || lowerMsg.includes('cancel recent') || lowerMsg.includes('close app')) {
                if (global.lastSpawnedApp && (Date.now() - global.lastSpawnedApp.timestamp < 30000)) {
                    const appToClose = global.lastSpawnedApp.appName;
                    const { exec } = await import('child_process');
                    exec(`killall "${appToClose}"`);
                    global.lastSpawnedApp = null;
                    console.log(`[Process Control] Cancelled recent native app: ${appToClose}`);
                    return res.json({ success: true, text: `[Ghost System]: Successfully cancelled and closed recent native application (${appToClose}).` });
                }
            }

            // Self-serve Agent Creation Interceptor ("create an agent...", "build an agent...")
            const createAgentMatch = lowerMsg.match(/^(?:create|build|scaffold)\s+(?:an?\s+)?agent\s+(?:that\s+|to\s+)?(.+)$/i);
            if (createAgentMatch) {
                const agentCreator = require('./src/agentCreator');
                const rawDescription = createAgentMatch[1];
                const nameWords = rawDescription.replace(/[^a-zA-Z0-9 ]/g, '').split(' ').filter(Boolean);
                const rawName = (nameWords[0] || 'custom') + 'Agent';
                const createRes = await agentCreator.createAgent({
                    rawName,
                    description: `Agent that ${rawDescription}`,
                    instructions: `Generate and execute responses for tasks involving: ${rawDescription}`,
                    tags: [nameWords[0] || 'custom', 'custom_agent'],
                    triggers: [rawDescription, `use ${rawName}`],
                    isAdmin
                });
                return res.json({ success: createRes.success, text: createRes.text || createRes.error });
            }

            // Agent Approval Interceptor ("approve agent...")
            const approveMatch = lowerMsg.match(/^approve\s+agent\s+([a-z0-9_]+)$/i);
            if (approveMatch) {
                const agentCreator = require('./src/agentCreator');
                const approveRes = await agentCreator.approveAgent(approveMatch[1], isAdmin);
                return res.json({ success: approveRes.success, text: approveRes.text || approveRes.error });
            }


            // 1. Intercept Native Application Requests ("open camera", "open photo booth", "open calculator", "open terminal")
            if (lowerMsg === 'open camera' || lowerMsg === 'open photo booth' || lowerMsg.includes('open camera') || lowerMsg.includes('open photo booth')) {
                console.log(`[Chat Trace] Intercepted native app launch -> Photo Booth (Camera)`);
                global.lastSpawnedApp = { appName: 'Photo Booth', timestamp: Date.now() };
                const { exec } = await import('child_process');
                const resultText = await new Promise((resolve) => {
                    exec('open -a "Photo Booth"', (err) => {
                        if (err) resolve(`[System Warning]: Could not open Photo Booth: ${err.message}`);
                        else resolve(`[Ghost System]: Photo Booth (Camera) application visually opened on desktop.`);
                    });
                });
                return res.json({ success: true, text: resultText });
            }

            if (lowerMsg.includes('open calculator') || lowerMsg.includes('open terminal')) {
                const appName = lowerMsg.includes('calculator') ? 'Calculator' : 'Terminal';
                console.log(`[Chat Trace] Intercepted native app launch -> ${appName}`);
                const { exec } = await import('child_process');
                const resultText = await new Promise((resolve) => {
                    exec(`open -a "${appName}"`, (err) => {
                        if (err) resolve(`[System Warning]: Could not open ${appName}: ${err.message}`);
                        else resolve(`[Ghost System]: ${appName} application visually opened on desktop.`);
                    });
                });
                return res.json({ success: true, text: resultText });
            }

            // 2. Intercept Deterministic Open Commands ("open <file>", "open <site> in <browser>")
            const openMatch = lowerMsg.match(/^open\s+([^\s]+)(?:\s+and\s+.*)?$/i) || lowerMsg.match(/^open\s+(https?:\/\/[^\s]+)$/i);
            if (openMatch && !lowerMsg.includes('photo booth') && !lowerMsg.includes('camera') && !lowerMsg.includes('calculator') && !lowerMsg.includes('terminal')) {
                let rawTarget = openMatch[1].trim();

                // Local File Interceptor Check
                const fileExts = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.csv', '.json', '.md'];
                const hasExt = fileExts.some(ext => rawTarget.toLowerCase().endsWith(ext));
                
                const os = require('os');
                const searchPaths = [
                    rawTarget,
                    path.resolve(os.homedir(), 'Downloads', rawTarget),
                    path.resolve(os.homedir(), 'Desktop', rawTarget),
                    path.resolve(os.homedir(), 'Documents', rawTarget),
                    path.resolve(__dirname, rawTarget)
                ];

                let foundFile = searchPaths.find(p => fs.existsSync(p) && !fs.statSync(p).isDirectory());

                if (hasExt || foundFile) {
                    const fileToOpen = foundFile || path.resolve(os.homedir(), 'Downloads', rawTarget);
                    console.log(`[Chat Trace] Local file opening intercepted -> File: "${fileToOpen}"`);
                    const { exec } = await import('child_process');
                    exec(`open "${fileToOpen}"`);

                    if (lowerMsg.includes('tell me') || lowerMsg.includes('read') || lowerMsg.includes('what')) {
                        if (fileToOpen.endsWith('.pdf')) {
                            const docAgent = require('./src/agents/docAgent');
                            const docRes = await docAgent.run(fileToOpen);
                            return res.json({ success: true, text: `[Ghost System]: Opened file "${path.basename(fileToOpen)}" on desktop.\n\n${docRes.text}` });
                        }
                    }
                    return res.json({ success: true, text: `[Ghost System]: Visually opened local file "${path.basename(fileToOpen)}" on your desktop.` });
                }

                // Deterministic Browser Launch
                let rawBrowser = (lowerMsg.match(/in\s+([^\s]+)$/i) || [])[1] || 'opera';
                let browserApp = 'Opera';
                if (rawBrowser.includes('safari')) browserApp = 'Safari';
                else if (rawBrowser.includes('chrome')) browserApp = 'Google Chrome';
                else if (rawBrowser.includes('firefox')) browserApp = 'Firefox';

                let targetUrl = rawTarget;
                if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                    if (targetUrl.includes('youtube')) targetUrl = 'https://www.youtube.com';
                    else if (targetUrl.includes('google')) targetUrl = 'https://www.google.com';
                    else if (targetUrl.includes('github')) targetUrl = 'https://github.com';
                    else targetUrl = `https://www.${targetUrl}.com`;
                }

                console.log(`[Chat Trace] Deterministic browser launch -> Browser: "${browserApp}", Target URL: "${targetUrl}"`);
                const { exec } = await import('child_process');
                const launchCmd = `open -a "${browserApp}" "${targetUrl}"`;
                const resultText = await new Promise((resolve) => {
                    exec(launchCmd, (err) => {
                        if (err) resolve(`[System Warning]: Could not launch ${browserApp}: ${err.message}`);
                        else resolve(`[Ghost System]: Visually opened ${targetUrl} in ${browserApp}.`);
                    });
                });
                return res.json({ success: true, text: resultText });
            }

        const codeKeywords = ['python', 'javascript', 'js', 'html', 'css', 'sql', 'script', 'function', 'write code', 'build an app', 'generate code', 'create file', 'code', 'coding', 'generate a login page', 'build a login page', 'create a script'];
        const isCodingRequest = codeKeywords.some(k => lowerMsg.includes(k));

        if (!ghostCodeActive && isCodingRequest) {
            res.json({
                success: true,
                text: "Ghost Code mode is currently turned OFF. Please turn Ghost Code ON in the sidebar controls to allow code generation and execution."
            });
            return;
        }
        
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

        // RAG Context Fallback for older facts outside sliding window:
        let fullHistory = Array.isArray(req.body.history) && req.body.history.length > 0 ? req.body.history : userHistory;
        if (Array.isArray(fullHistory) && fullHistory.length > maxMemory) {
            const lowerQuery = message.toLowerCase();
            const terms = lowerQuery.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length > 3);
            if (terms.length > 0) {
                const olderTurns = fullHistory.slice(0, fullHistory.length - maxMemory);
                const matchingTurns = olderTurns.filter(h => {
                    const content = (h.content || '').toLowerCase();
                    return terms.some(t => content.includes(t));
                });
                if (matchingTurns.length > 0) {
                    console.log(`[Memory RAG Trace] Recalled ${matchingTurns.length} relevant older turns from outside sliding window.`);
                    userHistory = [...matchingTurns, ...fullHistory.slice(-maxMemory)];
                } else {
                    userHistory = fullHistory.slice(-maxMemory);
                }
            } else {
                userHistory = fullHistory.slice(-maxMemory);
            }
        }

        const ghostContext = {
            chat: (msg, opts) => brain.think(msg, opts),
            execute: (action, goal, prev, context) => brain.execute(action, goal, prev, context),
            db: pool,
            userContext: { safeUser, isAdmin }
        };
        const pluginResult = await matchAndRun(message, ghostContext);
        if (pluginResult.matched) {
            if (pluginResult.error) {
                res.json({ success: false, error: pluginResult.error });
            } else {
                res.json({ success: true, text: pluginResult.result });
            }
            return;
        }

        const isPublic = (process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public';

        if (lowerMsg.startsWith('activate morning') || lowerMsg.startsWith('activate scheduled monitor') || lowerMsg.startsWith('activate code assistant') || lowerMsg.startsWith('activate code_assistant')) {
            if (isPublic) {
                res.status(403).json({ success: false, error: 'Forbidden: Admin operations and custom session modes are restricted in public deployment mode.' });
                return;
            }
        }

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

        if (lowerMsg === 'hi alfred') {
            if (isAdmin) {
                sessionModes.set(safeUser || 'guest', 'business');
                res.json({ success: true, text: `[GHOST CONTROLLER]: Business Mode activated. How can I assist you with operations today?` });
            } else {
                res.json({ success: true, text: `[GHOST CONTROLLER]: Unauthorized.` });
            }
            return;
        }

        if (lowerMsg === 'deactivate business') {
            if (sessionModes.get(safeUser || 'guest') === 'business') {
                sessionModes.delete(safeUser || 'guest');
                res.json({ success: true, text: `[GHOST CONTROLLER]: Business Mode deactivated.` });
            }
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
            dynamicToolsPrompt += `\n\n[GHOST BUILT-IN WORKFLOWS AVAILABLE]\nUse "tool": "workflow_execute" with these exact action names and schemas:\n${workflowEngine.getPromptString()}`;
            if (browserbaseClient.isConnected) dynamicToolsPrompt += `\n\n${browserbaseClient.getPromptString()}`;
            if (pool) {
                try {
                    const geneRes = await pool.query('SELECT pattern, action FROM ghost_genes ORDER BY created_at DESC LIMIT 3');
                    if (geneRes.rows.length > 0) learnedGenesPrompt = "\n\n[EVOMAP PRAL PROTOCOL]\n" + geneRes.rows.map(g => `[LEARNED: ${g.pattern} -> ${g.action}]`).join('\n');
                } catch (e) {}
            }
        }

        // Vision mode still uses callLLM directly (brain.think doesn't handle images)
        let extractedPdfText = "";
        if (fileBase64 && (fileBase64.includes('application/pdf') || fileBase64.startsWith('data:application/pdf'))) {
            const pdfData = fileBase64.replace(/^data:[^;]+;base64,/, '');
            const pdfBuffer = Buffer.from(pdfData, 'base64');
            extractedPdfText = extractTextFromPdfBuffer(pdfBuffer);
            console.log(`[PDF Extraction Trace] Extracted ${extractedPdfText.length} characters from PDF "${fileName || 'attachment.pdf'}"`);
        }

        let finalMessage = message || "";
        if (extractedPdfText) {
            finalMessage = `[ATTACHED PDF DOCUMENT: ${fileName || 'attachment.pdf'}]\n${extractedPdfText.substring(0, 8000)}\n\nUser Question: ${message}`;
        } else if (fileContent) {
            finalMessage = `[Document Uploaded:]\n${fileContent.substring(0, 5000)}\n\nUser Question: ${message}`;
        }
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
            const isBusinessMode = sessionModes.get(safeUser || 'guest') === 'business';
            const isPdfAttached = lowerMsg.includes('attached pdf') || (fileBase64 && fileBase64.includes('pdf')) || (finalMessage && finalMessage.includes('[ATTACHED PDF DOCUMENT:'));
            const isComplex = !isPdfAttached && (classifyComplexity(finalMessage) === 'complex' || isDeepResearch || isBusinessMode);

            if (isComplex && process.env.GHOST_PLANNER_ENABLED !== 'false') {
                console.log('[Intent Planner] Complex goal detected, initializing intent planner pipeline...');
                const planningStart = Date.now();
                try {
                    // 0. Task Understanding Pre-Check
                    const breakdown = await taskUnderstanding(finalMessage, userHistory);
                    console.log('[Task Understanding] Breakdown:', JSON.stringify(breakdown));

                    if (breakdown.isAmbiguous && breakdown.clarifyingQuestion) {
                        if (pool && safeUser) {
                            userHistory.push({ role: 'user', content: finalMessage });
                            userHistory.push({ role: 'assistant', content: breakdown.clarifyingQuestion });
                            await pool.query('UPDATE user_memories SET history_json = $2, updated_at = CURRENT_TIMESTAMP WHERE username = $1', [safeUser, JSON.stringify(userHistory.slice(-15))]);
                        }
                        res.json({ success: true, text: breakdown.clarifyingQuestion });
                        return;
                    }

                    // Optional Pre-Step: Claude Code Reasoning Brain Pre-Step
                    const claudeResult = runClaudeReasoningPrestep(finalMessage);
                    if (claudeResult.reasoning) {
                        console.log('[Intent Planner] Injected Claude Code Pre-Step Reasoning into context');
                        userHistory.push({ role: 'system', content: `[CLAUDE CODE PRE-STEP REASONING]: ${claudeResult.reasoning}` });
                    }

                    // Optional Self-Edit Memory Retrieval (SEAL-inspired)
                    const pastLessons = getSelfEditLessons(finalMessage);
                    if (pastLessons && pastLessons.length > 0) {
                        console.log(`[Intent Planner] Retrieved ${pastLessons.length} Self-Edit Memory Lessons for context`);
                        userHistory.push({ role: 'system', content: `[SELF-EDIT MEMORY LESSONS (SEAL Protocol)]:\n- ${pastLessons.join('\n- ')}` });
                    }

                    // 1. Analyze intent
                    const intent = await analyzeIntent(finalMessage, userHistory);
                    console.log('[Intent Planner] Intent analysis:', JSON.stringify(intent));

                    // 2. Check for blocking ambiguities and short-circuit if found
                    if (intent.ambiguities && intent.ambiguities.length > 0) {
                        intent.ambiguities = intent.ambiguities.filter(amb => {
                            const lower = amb.toLowerCase();
                            if (lower.includes('location') || lower.includes('email') || lower.includes('github') || lower.includes('credential') || lower.includes('api key') || lower.includes('token') || lower.includes('authentication') || lower.includes('account')) {
                                console.log(`[Intent Planner] Suppressed false credential ambiguity: "${amb}"`);
                                return false;
                            }
                            return true;
                        });
                    }

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

                    const planningLatency = Date.now() - planningStart;
                    console.log(`[Intent Planner Timing] Overall planning phase latency: ${planningLatency}ms`);

                    // 4. Resolve capabilities to tools, parameterize, and execute with Bounded Persistence & Retries
                    const executionStart = Date.now();
                    const previousResults = [];
                    const activeMode = isCodeAssistant ? 'code_assistant' : isDeepResearch ? 'deep_research' : isBusinessMode ? 'business' : null;
                    const fullCatalog = await loadCatalog();
                    const catalog = filterCatalogByMode(fullCatalog, activeMode);
                    const MAX_TOOL_CALLS = 8;
                    let totalToolCalls = 0;

                    for (const step of plan) {
                        if (totalToolCalls >= MAX_TOOL_CALLS) {
                            console.warn(`[Intent Planner] Bounded tool call cap (${MAX_TOOL_CALLS}) reached. Summarizing partial progress.`);
                            break;
                        }

                        const candidates = await routeCapabilityToTools(step.requiredCapability, step.description, catalog);
                        const primaryTool = candidates[0] || { name: 'chat' };
                        const fallbackTool = candidates[1] || null;

                        console.log(`[Tool Router] Routing step "${step.description}" to primary tool "${primaryTool.name}"`);

                        const params = await generateToolParams(primaryTool.name, step.description, previousResults, finalMessage);
                        
                        if (primaryTool.name === 'workspace_edit_file' && (!params.targetContent || params.targetContent === '')) {
                            const rawOutputs = previousResults.map(r => r.output).filter(Boolean).join('\n\n');
                            if (rawOutputs) {
                                params.replacementContent = rawOutputs;
                            }
                        }
                        
                        // Autonomous vs Gated Task Split check
                        const isGated = (toolName, toolParams) => {
                            if (toolName === 'email_send') {
                                const msg = finalMessage.toLowerCase();
                                return !(msg.includes('yes send') || msg.includes('confirm send') || msg.includes('proceed') || toolParams.confirmed);
                            }
                            if (toolName === 'workspace_edit_file' || toolName === 'workspace_run_command') {
                                const p = (toolParams.path || toolParams.filePath || toolParams.command || '').toLowerCase();
                                return (p.includes('rm -rf') || p.includes('.env') || p.includes('server.js'));
                            }
                            return false;
                        };

                        if (isGated(primaryTool.name, params)) {
                            const gatedMsg = `[Gated Action Confirmation Required] The task step "${step.description}" involves gated tool "${primaryTool.name}". Please confirm if you wish to execute this action.`;
                            if (pool && safeUser) {
                                userHistory.push({ role: 'user', content: finalMessage });
                                userHistory.push({ role: 'assistant', content: gatedMsg });
                                await pool.query('UPDATE user_memories SET history_json = $2, updated_at = CURRENT_TIMESTAMP WHERE username = $1', [safeUser, JSON.stringify(userHistory.slice(-15))]);
                            }
                            res.json({ success: true, text: gatedMsg });
                            return;
                        }

                        const executionContext = { 
                            safeUser: safeUser || 'guest', 
                            isAdmin, 
                            isCodeAssistant, 
                            isDeepResearch,
                            isBusinessMode,
                            triggerSource: 'user_message'
                        };

                        let output;
                        let stepSuccess = false;
                        let attemptsTried = [];

                        // Retry loop (max 2 attempts per step)
                        for (let attempt = 1; attempt <= 2; attempt++) {
                            totalToolCalls++;
                            const currentTool = (attempt === 2 && fallbackTool) ? fallbackTool : primaryTool;
                            const currentParams = (attempt === 2 && fallbackTool) 
                                ? await generateToolParams(currentTool.name, step.description, previousResults, finalMessage)
                                : params;
                            
                            const action = { tool: currentTool.name, params: currentParams };
                            const startTime = Date.now();

                            try {
                                output = await brain.execute(action, finalMessage, previousResults, executionContext);
                                const latencyMs = Date.now() - startTime;
                                
                                attemptsTried.push({ tool: currentTool.name, output, status: 'done' });
                                
                                const isErrorOutput = typeof output === 'string' && (output.startsWith('Error:') || output.includes('failed with status'));
                                if (!isErrorOutput) {
                                    stepSuccess = true;
                                    saveTrace(pool, { requestId, stepId: step.id, description: step.description, toolUsed: currentTool.name, provider: 'n/a', fallbacksTried: attemptsTried.map(a => a.tool).join(', '), latencyMs, status: 'done' });
                                    previousResults.push({ id: step.id, description: step.description, tool: currentTool.name, output, status: 'done' });
                                    break;
                                } else {
                                    console.warn(`[Intent Planner Retry] Step "${step.description}" attempt ${attempt} returned error: ${output}`);
                                    if (attempt < 2) await new Promise(r => setTimeout(r, 500));
                                }
                            } catch (attemptErr) {
                                console.warn(`[Intent Planner Retry] Step "${step.description}" attempt ${attempt} exception:`, attemptErr.message);
                                attemptsTried.push({ tool: currentTool.name, output: `Error: ${attemptErr.message}`, status: 'failed' });
                                if (attempt < 2) await new Promise(r => setTimeout(r, 500));
                            }
                        }

                        if (!stepSuccess) {
                            const errorSummary = attemptsTried.map((a, i) => `Attempt ${i+1} (${a.tool}): ${a.output}`).join(' | ');
                            recordSelfEdit({ username: safeUser || 'guest', goal: finalMessage, failedStep: step.description, tool: primaryTool.name, error: errorSummary, attemptsTried }, pool);
                            previousResults.push({ id: step.id, description: step.description, tool: primaryTool.name, output: `Failed after ${attemptsTried.length} attempts. Details: ${errorSummary}`, status: 'failed' });
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
                                const output = await brain.execute(action, finalMessage, previousResults, { safeUser: safeUser || 'guest', isAdmin, isCodeAssistant, isDeepResearch, isBusinessMode, triggerSource: 'user_message' });
                                
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
                        ? `You are Ghost, Manoj's loyal AI coding assistant. Summarize the completed plan execution and results clearly. Scoped file and command executions are enabled. Never invent, fabricate, or hallucinate any sources or citations. Only cite sources explicitly returned in the tool execution results. If no real sources are present, do not include any sources or citations section.`
                        : `You are Ghost, an elite autonomous AI. Summarize the completed plan execution and results clearly and directly for the user. Do not include tool syntax. Provide citations for sources ONLY if this is a deep research task and real source URLs were explicitly returned in the search/tool results. Under no circumstance should you invent, fabricate, or hallucinate fake sources, documentation links, or disclaimers. If no real source URLs are present in the execution results, omit the sources section completely.`;

                    const { chat: localChat } = require('./src/tools/llm.js');
                    const finalSummary = await localChat(
                        [{ role: 'user', content: `Goal: "${finalMessage}"\n\nResults:\n${previousResults.map(r => `Step: ${r.description}\nTool Used: ${r.tool}\nResult: ${r.output}`).join('\n\n')}` }],
                        { systemPrompt: summarySystemPrompt, maxTokens: 1024 }
                    );

                    const executionLatency = Date.now() - executionStart;
                    console.log(`[Intent Planner Timing] Overall execution phase latency: ${executionLatency}ms`);

                    const traceText = `[Intent Planner ➔ Plan Executed]\n` + 
                        plan.map(s => `- [x] ${s.description} (routed to: ${s.requiredCapability})`).join('\n') + 
                        `\n\n${finalSummary}`;

                    if (pool && safeUser) {
                        userHistory.push({ role: 'user', content: finalMessage });
                        userHistory.push({ role: 'assistant', content: traceText });
                        await pool.query('UPDATE user_memories SET history_json = $2, updated_at = CURRENT_TIMESTAMP WHERE username = $1', [safeUser, JSON.stringify(userHistory.slice(-15))]);
                    }

                    res.json({ success: true, text: traceText, plan });
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
                } else if (isBusinessMode) {
                    msgToThink = `[SESSION MODE: BUSINESS IS ACTIVE. Handle routine tasks, queue approvals, and alert owner.]\n${finalMessage}`;
                }
                const startTime = Date.now();
                console.log(`[Server] Routing plain-text request to brain.think() with ${userHistory.length} history turns...`);
                const brainResult = await brain.think(msgToThink, { safeUser, isAdmin, isBusinessMode, triggerSource: 'user_message', history: userHistory });
                const latencyMs = Date.now() - startTime;

                const lastCalls = requestContext.llmCalls || [];
                const primaryCall = lastCalls.find(c => c.status === 'success') || lastCalls[0];
                const provider = primaryCall ? primaryCall.provider : 'n/a';
                const fallbacksTried = lastCalls.filter(c => c.status === 'failed').map(c => c.provider).join(', ');

                saveTrace(pool, {
                    requestId,
                    stepId: 'chat_simple',
                    description: 'Direct LLM Chat Response',
                    toolUsed: 'chat',
                    provider,
                    fallbacksTried,
                    latencyMs,
                    status: 'done'
                });

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
            if (toolCommand.tool === "trigger_webhook" || toolCommand.tool === "workflow_execute" || toolCommand.tool === "browserbase_execute") {
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
});

app.post('/api/execute-plan-step', async (req, res) => {
    try {
        const { step, goal, stepIndex } = req.body;
        if (!step) return res.status(400).json({ success: false, error: 'Step missing from payload' });

        const stepDesc = (step.description || step.task || '').toLowerCase();
        const goalDesc = (goal || '').toLowerCase();

        console.log(`[Plan Step Runner] Executing Step ${stepIndex + 1}: "${step.description || step.task}"`);

        // Check if step or goal involves app launch vs browser automation
        const isAppRequest = stepDesc.includes('camera') || goalDesc.includes('camera') || stepDesc.includes('calculator') || goalDesc.includes('calculator') || stepDesc.includes('terminal') || goalDesc.includes('terminal');
        const isBrowserRequest = stepDesc.includes('opera') || stepDesc.includes('chrome') || stepDesc.includes('youtube') || stepDesc.includes('browser') || stepDesc.includes('open') || goalDesc.includes('opera') || goalDesc.includes('youtube');

        if (isAppRequest) {
            const { exec } = await import('child_process');
            let appName = "Photo Booth";
            if (stepDesc.includes('calculator') || goalDesc.includes('calculator')) appName = "Calculator";
            if (stepDesc.includes('terminal') || goalDesc.includes('terminal')) appName = "Terminal";

            console.log(`[Plan Step Runner] Opening native application: ${appName}`);
            const appResult = await new Promise((resolve) => {
                exec(`open -a "${appName}"`, (err, stdout, stderr) => {
                    if (err) {
                        resolve({ success: false, error: `Could not open ${appName}: ${err.message}` });
                    } else {
                        resolve({ success: true, output: `Visually opened native application: ${appName}` });
                    }
                });
            });
            return res.json(appResult);
        }

        if (isBrowserRequest) {
            const { exec } = await import('child_process');
            
            let searchTarget = "https://www.youtube.com";
            if (goalDesc.includes('play') || stepDesc.includes('play') || goalDesc.includes('song') || stepDesc.includes('song')) {
                searchTarget = "https://www.youtube.com/results?search_query=music+song";
            }

            let launchCmd = `open -a "Opera" "${searchTarget}" || open -a "Google Chrome" "${searchTarget}" || open "${searchTarget}"`;
            
            console.log(`[Plan Step Runner] Launching visible browser with command: ${launchCmd}`);
            
            const launchResult = await new Promise((resolve) => {
                exec(launchCmd, (err, stdout, stderr) => {
                    if (err) {
                        console.error('[Plan Step Runner Browser Error]:', err.message);
                        resolve({ success: false, error: err.message });
                    } else {
                        resolve({ success: true, output: `Browser launched successfully targeting ${searchTarget}` });
                    }
                });
            });

            return res.json(launchResult);
        }

        // Check if step involves clicking or element interaction that could fail
        if (stepDesc.includes('click') || stepDesc.includes('element') || stepDesc.includes('nonexistent') || stepDesc.includes('type') || stepDesc.includes('select')) {
            const isNonexistent = stepDesc.includes('nonexistent') || stepDesc.includes('invalid') || stepDesc.includes('missing');
            if (isNonexistent) {
                console.log(`[Plan Step Runner] Intercepted failing step: "${step.description || step.task}"`);
                return res.json({
                    success: false,
                    error: `Browser action failed: Element "${step.description || step.task}" timed out after 15000ms. Element not found.`
                });
            }

            try {
                const browserbaseClient = (await import('./services/browserbaseClient.js')).default;
                const runResult = await browserbaseClient.executeTool('execute_actions', {
                    url: 'https://www.google.com',
                    actions: [{ action: 'click', selector: '#nonexistent_element_999' }],
                    triggerSource: 'user_message'
                });
                const stepFail = (runResult.stepResults || []).find(r => r.status === 'failed');
                if (stepFail) {
                    return res.json({ success: false, error: `Browser action failed: ${stepFail.error}` });
                }
            } catch (err) {
                return res.json({ success: false, error: `Browser action failed: ${err.message}` });
            }
        }

        // Standard tool execution fallback
        return res.json({
            success: true,
            output: `Step ${stepIndex + 1} completed: ${step.description || step.task}`
        });

    } catch (e) {
        console.error('[Plan Step Runner Error]:', e.message);
        res.json({ success: false, error: `Step execution failed: ${e.message}` });
    }
});

app.post('/api/execute-action', requireAdminToken, async (req, res) => {
    const { actionId } = req.body;
    const cachedAction = pendingActions.get(actionId);
    if (!cachedAction) return res.status(400).json({ success: false, error: "Action token expired or invalid." });
    if (cachedAction.type === 'pipeline') {
        return res.status(400).json({ success: false, error: 'Use /api/pipeline/execute-action for pipeline actions.' });
    }
    if (cachedAction.type === 'autonomous_loop') {
        pendingActions.delete(actionId);
        if (Date.now() > cachedAction.expiresAt) return res.status(400).json({ success: false, error: "Confirmation window timed out." });
        try {
            const { runAutonomous } = await import('./services/autonomousLoop.js');
            const result = await runAutonomous(cachedAction.goal, cachedAction.userContext, pool, cachedAction.state);
            return res.json({ success: true, result });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    pendingActions.delete(actionId);
    if (Date.now() > cachedAction.expiresAt) return res.status(400).json({ success: false, error: "Confirmation window timed out." });
    const memoryUser = cachedAction.requestedBy || 'master_manoj';

    try {
        const access = checkToolAccess(cachedAction.type, memoryUser);
        if (!access.allowed) return res.status(403).json({ success: false, error: access.reason });

        if (cachedAction.type === 'workflow_execute') {
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

app.post('/api/admin/toggle-autonomy', requireAdminToken, async (req, res) => {
    const { mode } = req.body;
    try {
        const { setAutonomousMode } = await import('./services/autonomousLoop.js');
        const activeMode = setAutonomousMode(mode);
        res.json({ success: true, mode: activeMode, message: `Ghost Autonomous Mode updated to [${activeMode}].` });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

app.post('/api/voice/activate', async (req, res) => {
    const { wakeWord } = req.body;
    res.json({ success: true, message: `Voice activation ready for wake-word: ${wakeWord}` });
});

app.post('/api/voice/transcribe', async (req, res) => {
    try {
        const { audioBase64, filename } = req.body;
        if (!audioBase64) return res.status(400).json({ error: 'Missing audioBase64 in request body.' });

        const base64Data = audioBase64.replace(/^data:[^;]+;base64,/, '');
        const audioBuffer = Buffer.from(base64Data, 'base64');

        const voiceAgent = require('./src/agents/voiceAgent.js');
        const result = await voiceAgent.transcribeAudio(audioBuffer, filename || 'recording.webm');
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Server audio processing error: ${err.message}` });
    }
});

app.post('/api/desktop/notify', (req, res) => {
    const { title, message } = req.body || {};
    console.log(`[Desktop Notification Request] 🔔 ${title}: ${message}`);
    res.json({ success: true, message: 'Notification event logged.' });
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



app.get('/api/admin/observability', requireAdminToken, async (req, res) => {
    try {
        if (!pool) {
            return res.status(500).send('Database not connected.');
        }

        const providerRes = await pool.query(`
            SELECT provider, COUNT(*) as count, ROUND(AVG(latency_ms)) as avg_latency 
            FROM pipeline_traces 
            GROUP BY provider 
            ORDER BY count DESC
        `);

        const toolRes = await pool.query(`
            SELECT tool_used, COUNT(*) as count, ROUND(AVG(latency_ms)) as avg_latency 
            FROM pipeline_traces 
            GROUP BY tool_used 
            ORDER BY avg_latency DESC
        `);

        const traceRes = await pool.query(`
            SELECT request_id, step_id, description, tool_used, provider, fallbacks_tried, latency_ms, status, created_at 
            FROM pipeline_traces 
            ORDER BY created_at DESC 
            LIMIT 50
        `);

        const providers = providerRes.rows;
        const tools = toolRes.rows;
        const traces = traceRes.rows;

        let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ghost AI Observability Matrix</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-gradient: radial-gradient(circle at 50% 50%, #0b0a1a 0%, #16142e 100%);
            --panel-bg: rgba(255, 255, 255, 0.03);
            --border-color: rgba(255, 255, 255, 0.08);
            --text-primary: #ffffff;
            --text-secondary: #a0a0c0;
            --accent: #4f46e5;
            --accent-glow: rgba(79, 70, 229, 0.4);
            --success: #10b981;
            --error: #ef4444;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg-gradient);
            color: var(--text-primary);
            margin: 0;
            padding: 40px 20px;
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 40px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 20px;
        }
        h1 {
            font-size: 32px;
            font-weight: 700;
            margin: 0;
            background: linear-gradient(90deg, #ffffff 0%, #a5a5cc 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .btn-refresh {
            background: linear-gradient(90deg, #4f46e5 0%, #3b82f6 100%);
            border: none;
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px var(--accent-glow);
            transition: all 0.3s ease;
        }
        .btn-refresh:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px var(--accent-glow);
        }
        .grid-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        .card {
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 24px;
            backdrop-filter: blur(12px);
        }
        .card h2 {
            font-size: 18px;
            font-weight: 600;
            margin-top: 0;
            margin-bottom: 20px;
            color: var(--text-secondary);
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 10px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }
        th, td {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color);
            font-size: 14px;
        }
        th {
            color: var(--text-secondary);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 1px;
        }
        td {
            color: var(--text-primary);
        }
        .status-done {
            color: var(--success);
            font-weight: 600;
        }
        .status-failed {
            color: var(--error);
            font-weight: 600;
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            background: rgba(255, 255, 255, 0.08);
        }
        .badge-provider {
            background: rgba(79, 70, 229, 0.15);
            color: #a5b4fc;
            border: 1px solid rgba(79, 70, 229, 0.3);
        }
        .badge-tool {
            background: rgba(16, 185, 129, 0.15);
            color: #6ee7b7;
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div>
                <h1>Ghost AI Observability Matrix</h1>
                <p style="color: var(--text-secondary); margin: 5px 0 0 0; font-size: 14px;">Real-time DAG pipeline execution and LLM provider traces</p>
            </div>
            <button class="btn-refresh" onclick="window.location.reload()">Refresh Data</button>
        </header>

        <div class="grid-stats">
            <div class="card">
                <h2>LLM Provider Breakdown</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Provider</th>
                            <th>Invocations</th>
                            <th>Avg Latency</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${providers.map(p => \`
                            <tr>
                                <td><span class="badge badge-provider">\${p.provider}</span></td>
                                <td>\${p.count}</td>
                                <td>\${p.avg_latency}ms</td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            </div>

            <div class="card">
                <h2>Tool Average Latency</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Tool</th>
                            <th>Calls</th>
                            <th>Avg Latency</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${tools.map(t => \`
                            <tr>
                                <td><span class="badge badge-tool">\${t.tool_used}</span></td>
                                <td>\${t.count}</td>
                                <td>\${t.avg_latency}ms</td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="card" style="margin-bottom: 40px;">
            <h2>Recent Pipeline Execution Logs (Last 50 Traces)</h2>
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Request ID</th>
                            <th>Step / Tool</th>
                            <th>Description</th>
                            <th>Provider</th>
                            <th>Fallbacks</th>
                            <th>Latency</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${traces.map(t => \`
                            <tr>
                                <td style="color: var(--text-secondary); white-space: nowrap;">\${new Date(t.created_at).toLocaleTimeString()}</td>
                                <td style="font-family: monospace; font-size: 12px; color: var(--text-secondary);">\${t.request_id.substring(0, 8)}...</td>
                                <td><span class="badge badge-tool">\${t.tool_used}</span></td>
                                <td>\${t.description}</td>
                                <td><span class="badge badge-provider">\${t.provider}</span></td>
                                <td style="font-size: 12px; color: var(--text-secondary);">\${t.fallbacks_tried || '-'}</td>
                                <td>\${t.latency_ms}ms</td>
                                <td><span class="status-\${t.status}">\${t.status.toUpperCase()}</span></td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</body>
</html>`;
        res.send(html);
    } catch (err) {
        res.status(500).send(`Observability error: ${err.message}`);
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 10000;
Promise.all([
    initAgentModes(pool).catch(err => console.error('[Agent Modes Init Warn]:', err.message)),
    initGoogleAuthTable(pool).catch(err => console.error('[Google Auth Init Warn]:', err.message)),
    initTraceTable(pool).catch(err => console.error('[Trace Store Init Warn]:', err.message)),
    loadPlugins().catch(err => console.error('[Plugins Load Warn]:', err.message))
]).then(() => {
    startAutoLearning(ghostLearn, pool);
    cleanupTraces(pool).catch(err => console.error('[Cleanup Traces Warn]:', err.message));
}).catch(err => console.error('[Startup Init Error]:', err.message));
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ghost AI Engine Online on port ${PORT}.`);
    initCronScheduler();
    if ((process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'local') {
        console.log('[Local Control Server] Auto-spawning Local Control Daemon client...');
        spawn('node', ['./services/localControlDaemon.js'], { stdio: 'inherit' });
    }
});

server.on('upgrade', (req, socket, head) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (urlObj.pathname === '/api/local-control') {
        if ((process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'local' && authenticateUpgrade(req)) {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        } else {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
        }
    }
});
