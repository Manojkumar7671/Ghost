import { checkToolAccess } from './adminGate.js';
import { startAutoLearning } from './ghostLearnScheduler.js';
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
import { pendingActions as sharedPendingActions } from './state/pendingActions.js';
import createPipelineRoutes from './routes/pipelineRoutes.js';

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

n8nMcpClient.initialize().catch(e => console.error("[Server Init] Non-fatal n8n MCP init error:", e.message));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY; 
const SERPER_API_KEY = process.env.SERPER_API_KEY;

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

const GHOST_ADMIN_CORE = `You are Ghost, an elite autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj".\nYOUR PERSONALITY: Dry, crisp, British demeanor. Impeccably polite, slightly witty.${MULTI_AGENT_PROTOCOL}\n${GHOST_CAPABILITIES}`;
const getShowcaseCore = (guestName) => `You are Ghost, an autonomous AI engineered by Manoj Kumar. Speaking with visitor: ${guestName}.\nYOUR PERSONALITY: Dry, crisp, British demeanor.${MULTI_AGENT_PROTOCOL}\n${GHOST_CAPABILITIES}`;

const PROVIDER_MATRIX = [
    { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-1.5-pro', apiKey: GEMINI_API_KEY },
    { name: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', apiKey: GROQ_API_KEY },
    { name: 'Nvidia NIM', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/llama-3.3-nemotron-super-49b-v1', apiKey: NVIDIA_API_KEY },
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
            const data = await res.json();
            clearTimeout(timeoutId); 
            if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
            if (provider.name === 'Gemini' && (!data.choices || !data.choices[0] || !data.choices[0].message)) throw new Error("Invalid Gemini response structure.");
            return data.choices[0].message.content;
        } catch (e) {
            clearTimeout(timeoutId);
        }
    }
    throw new Error("Critical Gateway Failure: All matrix nodes unreachable.");
}

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
    if (authString === ADMIN_PASSPHRASE) {
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

app.post('/api/chat', chatLimiter, async (req, res) => {
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

        let dynamicToolsPrompt = "", learnedGenesPrompt = "";
        if (isAdmin) {
            if (n8nMcpClient.isConnected) dynamicToolsPrompt += `\n\n[LIVE N8N WORKFLOWS AVAILABLE]\nUse "tool": "n8n_execute" with these exact action names and schemas:\n${n8nMcpClient.getPromptString()}`;
            if (browserbaseClient.isConnected) dynamicToolsPrompt += `\n\n${browserbaseClient.getPromptString()}`;
            if (pool) {
                try {
                    const geneRes = await pool.query('SELECT pattern, action FROM ghost_genes ORDER BY created_at DESC LIMIT 3');
                    if (geneRes.rows.length > 0) learnedGenesPrompt = "\n\n[EVOMAP PRAL PROTOCOL]\n" + geneRes.rows.map(g => `[LEARNED: ${g.pattern} -> ${g.action}]`).join('\n');
                } catch (e) {}
            }
        }

        const textPrompt = (isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user)) + dynamicToolsPrompt + learnedGenesPrompt;
        let finalMessage = fileContent ? `[Document Uploaded:]\n${fileContent.substring(0, 5000)}\n\nUser: ${message}` : message;
        let fullResponse = "", messagesArray = [];

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
            messagesArray = [{ role: "system", content: textPrompt }, ...userHistory, { role: "user", content: finalMessage }];
            messagesArray = compressContext(messagesArray);
            fullResponse = await callLLM(messagesArray, activeTokens);

            const searchMatch = fullResponse ? fullResponse.match(/<search>([\s\S]*?)<\/search>/i) : null;
            if (searchMatch) {
                try {
                    const serperRes = await fetchWithTimeout(fetch('https://google.serper.dev/search', {
                        method: 'POST',
                        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ q: searchMatch[1] })
                    }), 8000);
                    const searchData = await serperRes.json();
                    let searchOutput = searchData.organic && searchData.organic.length > 0 
                        ? searchData.organic.slice(0, 3).map(r => `${r.title}: ${r.snippet}`).join("\n") 
                        : "No results found.";
                    messagesArray.push({ role: "assistant", content: fullResponse });
                    messagesArray.push({ role: "user", content: `[ORACLE RETURNED]:\n${searchOutput}\n\nSynthesize a final answer.` });
                    messagesArray = compressContext(messagesArray); 
                    fullResponse = await callLLM(messagesArray, activeTokens);
                } catch (searchErr) {
                    messagesArray.push({ role: "assistant", content: fullResponse });
                    messagesArray.push({ role: "user", content: `[ORACLE FAILED]: Web search timed out. Inform the user gracefully.` });
                    fullResponse = await callLLM(messagesArray, activeTokens);
                }
            }
        }

        let replyText = fullResponse || "System anomaly: Empty matrix response.";
        let actionTriggered = "general_response";

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
            } catch (e) {}
        }

        const codeRegex = /[\x60]{3}python\n([\s\S]*?)[\x60]{3}/i;
        const match = fullResponse ? fullResponse.match(codeRegex) : null;
        if (ghostCodeMode && match && match[1]) {
            actionTriggered = "python_execution";
            const tempFilePath = path.join(__dirname, 'ghost_payload.py');
            fs.writeFileSync(tempFilePath, match[1].trim());
            try {
                const executionOutput = execSync(`python3 ${tempFilePath}`, { timeout: 15000, encoding: 'utf-8' });
                replyText = fullResponse.replace(match[0], `\n\`\`\`html\n${executionOutput.trim()}\n\`\`\`\n`);
            } catch (execError) { replyText = fullResponse.replace(match[0], `[Python Error]: ${execError.stderr || execError.message}`); }
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
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
                if (searchData.organic && searchData.organic.length > 0) {
                    replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[EXECUTE_OPEN_TAB:${searchData.organic[0].link}]`);
                } else {
                    replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Oracle embed returned no results]`);
                }
            } catch (embedErr) {
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Oracle embed failed to resolve]`);
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
            const result = await n8nMcpClient.executeTool(cachedAction.action, cachedAction.payload);
            appendToUserMemory(memoryUser, [{ role: 'assistant', content: `[n8n workflow "${cachedAction.action}" executed. Result: ${JSON.stringify(result).slice(0, 1500)}]` }]);
            return res.json({ success: true, message: `n8n workflow [${cachedAction.action}] executed successfully.`, result });
        }

        if (cachedAction.type === 'browserbase_execute') {
            const result = await browserbaseClient.executeTool(cachedAction.action, { ...cachedAction.payload, safeUser: memoryUser });
            const summary = (result.stepResults || [])
                .map(r => r.step === 'navigation' ? `Navigated to ${r.url}` : `Step ${r.step} (${r.action}): ${r.status}${r.data ? ' — ' + r.data.slice(0, 300) : ''}${r.error ? ' — ERROR: ' + r.error : ''}`)
                .join('\n');
            appendToUserMemory(memoryUser, [{ role: 'assistant', content: `[Browserbase result for ${cachedAction.payload.url}]\n${summary}` }]);
            return res.json({ success: true, message: `Browserbase successfully processed target domain [${cachedAction.payload.url}].`, result });
        }

        return res.json({ success: true, message: `Action [${cachedAction.action}] deployed securely.` });
    } catch (err) { return res.status(500).json({ success: false, error: `Pipeline failure: ${err.message}` }); }
});

app.use('/api/pipeline', createPipelineRoutes(n8nMcpClient));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
const PORT = process.env.PORT || 10000;
startAutoLearning(ghostLearn, pool);
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost AI Engine Online on port ${PORT}.`));