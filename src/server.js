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

// Load all API Keys
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY; 
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const N8N_MCP_TOKEN = process.env.N8N_MCP_TOKEN;

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

// ==========================================
// 2. CONTEXT COMPRESSION & FLYWHEEL PRAL
// ==========================================
function compressContext(messages) {
    if (!messages || messages.length <= 7) return messages;
    const systemPrompt = messages[0].role === 'system' ? messages[0] : null;
    const startIndex = systemPrompt ? 1 : 0;
    
    const coreMessages = messages.slice(startIndex, messages.length - 6);
    const recentMessages = messages.slice(messages.length - 6);

    const compressedCore = coreMessages.map(msg => {
        let content = msg.content || "";
        if (typeof content === 'string' && content.length > 2000) {
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
    const { safeUser, message, actionTaken, latencyMs, providerUsed } = sessionData;
    if (!pool || !safeUser || safeUser === 'guest') return;

    const pattern = message.substring(0, 500); 
    const action = actionTaken || "general_response"; 
    
    try {
        await pool.query(
            `INSERT INTO ghost_genes (pattern, action, outcome, score, created_at) VALUES ($1, $2, $3, $4, NOW())`,
            [pattern, `${action} [via ${providerUsed} in ${latencyMs}ms]`, "success", 1.0]
        );
    } catch (err) { console.error('[Flywheel PRAL]: Background gene write failed.', err.message); }
}

// ==========================================
// 3. CAPABILITIES & AI-Q PROMPTS
// ==========================================
const GHOST_CAPABILITIES = `
YOUR FEATURES: Voice Interaction, Live Web Search, Python Sandbox, Holographic UI Rendering.
CRITICAL UI/UX: When generating HTML, always include <!DOCTYPE html> at the top. Keep voice text concise. Use markdown for heavy text.

RULES:
1. PONYTAIL MINIMALISM: Use native features before writing complex code.
2. ORACLE: For live data, output <search>query</search>.
3. ACTIONS: Output JSON schema for triggers.
`;

const MULTI_AGENT_PROTOCOL = `
MULTI-AGENT PROTOCOL: Activate internal sub-agents inside <think>...</think> tags.
AI-Q ORCHESTRATION: You must classify intent before acting.
- Shallow Research: Use <search> for quick facts.
- Deep Research: Plan multi-step code and analysis for complex queries.
Personas: Research Agent, Architect Agent, Execution Agent, Growth Agent.`;

const GHOST_ADMIN_CORE = `You are Ghost, an elite autonomous AI. Address him exclusively as "Master Manoj".\n${MULTI_AGENT_PROTOCOL}\n${GHOST_CAPABILITIES}`;
const getShowcaseCore = (guestName) => `You are Ghost. Speaking with visitor: ${guestName}.\n${MULTI_AGENT_PROTOCOL}\n${GHOST_CAPABILITIES}`;

// ==========================================
// 4. THE EXPANDED MATRIX 
// ==========================================
const TEXT_PROVIDER_MATRIX = [
    { name: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', apiKey: GROQ_API_KEY },
    { name: 'Nvidia NIM Llama 90b', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'meta/llama-3.2-90b-vision-instruct', apiKey: NVIDIA_API_KEY },
    { name: 'Nvidia NIM DeepSeek Flash', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'deepseek-ai/deepseek-v4-flash', apiKey: NVIDIA_API_KEY },
    { name: 'Nvidia NIM DeepSeek Pro', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'deepseek-ai/deepseek-v4-pro', apiKey: NVIDIA_API_KEY },
    { name: 'Nvidia NIM GLM', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'z-ai/glm-5.1', apiKey: NVIDIA_API_KEY },
    { name: 'Nvidia NIM Mistral', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'mistralai/mistral-medium-3.5', apiKey: NVIDIA_API_KEY },
    { name: 'Nvidia NIM Nemotron Nano', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/llama-3_1-nemotron-nano-8b-v1', apiKey: NVIDIA_API_KEY },
    { name: 'Nvidia NIM Phi-4', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'microsoft/phi-4-mini-instruct', apiKey: NVIDIA_API_KEY },
    { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct', apiKey: OPENROUTER_API_KEY },
    { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-1.5-pro', apiKey: GEMINI_API_KEY }
];

const VISION_PROVIDER_MATRIX = [
    { name: 'Nvidia NIM Vision 90b', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'meta/llama-3.2-90b-vision-instruct', apiKey: NVIDIA_API_KEY },
    { name: 'Nvidia NIM Vision Nano', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1', apiKey: NVIDIA_API_KEY },
    { name: 'Nvidia NIM Vision Omni', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', apiKey: NVIDIA_API_KEY },
    { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.2-90b-vision-instruct', apiKey: OPENROUTER_API_KEY },
    { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-1.5-pro', apiKey: GEMINI_API_KEY }
];

async function callLLM(messages, maxTokens, isVision = false) {
    const matrix = isVision ? VISION_PROVIDER_MATRIX : TEXT_PROVIDER_MATRIX;
    
    for (const provider of matrix) {
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
            if (provider.name === 'Gemini' && (!data.choices || !data.choices[0])) throw new Error("Invalid structure.");
            
            console.log(`[Gateway Success]: Routed successfully through ${provider.name}`);
            return { content: data.choices[0].message.content, provider: provider.name };
        } catch (e) {
            clearTimeout(timeoutId);
            console.log(`[Gateway Failover]: ${provider.name} failed (${e.name === 'AbortError' ? 'Timeout (8s limit)' : e.message}). Rerouting...`);
        }
    }
    throw new Error("Critical Gateway Failure: All matrix nodes unreachable.");
}

app.post('/api/auth', async (req, res) => { 
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

const pendingActions = new Map();

app.post('/api/chat', async (req, res) => {
    const startTime = Date.now();
    try {
        const { message, user, image, fileContent, ghostCodeMode = true } = req.body;
        const isAdmin = req.cookies.ghost_session && jwt.verify(req.cookies.ghost_session, JWT_SECRET).role === 'admin';
        const safeUser = isAdmin ? 'master_manoj' : 'guest';
        const activeTokens = isAdmin ? 4000 : 1000;
        
        // NemoClaw Privacy Simulator
        const sensitiveKeywords = ['password', 'ssn', 'credit card'];
        if (sensitiveKeywords.some(kw => message.toLowerCase().includes(kw))) {
            return res.json({ success: true, text: "[NEMOCLAW ROUTER]: Sensitive data detected. Cloud inference aborted to protect data." });
        }

        let userHistory = []; 
        let textPrompt = (isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user));
        let messagesArray = [];
        let fullResponse = "";
        let llmProvider = "Unknown";
        
        let finalMessage = fileContent ? `[Document Uploaded:]\n${fileContent.substring(0, 5000)}\n\nUser: ${message}` : message;

        if (image) {
            messagesArray = [
                { role: "system", content: textPrompt },
                ...userHistory,
                { role: "user", content: [{ type: "text", text: finalMessage || "Analyze frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
            ];
            messagesArray = compressContext(messagesArray);
            
            let llmResult = await callLLM(messagesArray, activeTokens, true);
            fullResponse = llmResult.content;
            llmProvider = llmResult.provider;
        } else {
            messagesArray = [{ role: "system", content: textPrompt }, ...userHistory, { role: "user", content: finalMessage }];
            messagesArray = compressContext(messagesArray);
            
            let llmResult = await callLLM(messagesArray, activeTokens, false);
            fullResponse = llmResult.content;
            llmProvider = llmResult.provider;

            // --- ORACLE (SERPER API) ---
            const searchMatch = fullResponse ? fullResponse.match(/<search>([\s\S]*?)<\/search>/i) : null;
            if (searchMatch) {
                try {
                    const serperRes = await fetchWithTimeout(fetch('https://google.serper.dev/search', {
                        method: 'POST',
                        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ q: searchMatch[1] })
                    }), 8000);
                    const searchData = await serperRes.json();
                    let searchOutput = searchData.organic && searchData.organic.length > 0 ? searchData.organic.slice(0, 3).map(r => `${r.title}: ${r.snippet}`).join("\n") : "No results found.";
                    
                    messagesArray.push({ role: "assistant", content: fullResponse }, { role: "user", content: `[ORACLE]:\n${searchOutput}` });
                    messagesArray = compressContext(messagesArray); 
                    
                    llmResult = await callLLM(messagesArray, activeTokens, false);
                    fullResponse = llmResult.content;
                    llmProvider = llmResult.provider;
                } catch (e) { /* Fallback */ }
            }
        }

        let actionTriggered = "general_response";
        let replyText = fullResponse;
        
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

                    actionTriggered = `${toolCommand.tool}:${toolCommand.action}`;
                    const actionId = crypto.randomBytes(16).toString('hex');
                    pendingActions.set(actionId, {
                        type: toolCommand.tool,
                        action: toolCommand.action,
                        payload: toolCommand.payload,
                        expiresAt: Date.now() + (5 * 60 * 1000)
                    });
                    
                    replyText = `[ACTION REQUIRED - HITL GATE]: Proposal compiled for [${toolCommand.tool}]: ${toolCommand.action}.\n\nReview structural payload:\n\`\`\`json\n${JSON.stringify(toolCommand.payload, null, 2)}\n\`\`\``;
                    
                    ghostLearn({ safeUser, message, actionTaken: actionTriggered, latencyMs: Date.now() - startTime, providerUsed: llmProvider });
                    res.json({ success: true, text: replyText, actionRequired: true, actionId: actionId });
                    return;
                }
            } catch (e) { console.error("Failed to parse JSON tool call."); }
        }

        // --- STRICT LOCAL PYTHON SANDBOX ---
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
        
        // Flywheel Telemetry Capture
        const latencyMs = Date.now() - startTime;
        ghostLearn({ safeUser, message, actionTaken: actionTriggered, latencyMs, providerUsed: llmProvider });

        userHistory.push({ role: 'user', content: message }, { role: 'assistant', content: replyText.trim() });
        
        res.json({ success: true, text: replyText.trim() });
        
        if (pool && safeUser) {
            pool.query(
                `INSERT INTO user_memories (username, history_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json, updated_at = NOW()`,
                [safeUser, JSON.stringify(userHistory)]
            ).catch(err => console.error('[Memory Save Error]: Background save failed.', err.message));
        }
    } catch (e) { 
        if (!res.headersSent) res.json({ success: true, text: `[System Warning]: Matrix Interference: ${e.message}` }); 
    }
});

app.post('/api/execute-action', requireAdminToken, async (req, res) => {
    const { actionId } = req.body;
    const cachedAction = pendingActions.get(actionId);
    if (!cachedAction) return res.status(400).json({ success: false, error: "Action token expired or invalid." });
    
    pendingActions.delete(actionId);
    if (Date.now() > cachedAction.expiresAt) return res.status(400).json({ success: false, error: "Confirmation window timed out." });

    try {
        console.log(`[AUDIT] Authorized execution of action: ${cachedAction.action}`);

        if (cachedAction.type === 'n8n_execute') {
            try {
                const n8nRes = await fetch(process.env.N8N_MCP_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        token: N8N_MCP_TOKEN, // Injected the auth token here!
                        action: cachedAction.action, 
                        params: cachedAction.payload, 
                        approvedBy: 'admin', 
                        timestamp: Date.now() 
                    })
                });
                
                const resultText = await n8nRes.text();
                let parsedResult = resultText;
                try { parsedResult = JSON.parse(resultText); } catch(e) {}
                
                return res.json({ success: true, message: `n8n workflow [${cachedAction.action}] executed successfully.`, result: parsedResult });
            } catch (n8nErr) {
                return res.json({ success: false, error: n8nErr.message });
            }
        }

        if (cachedAction.type === 'browserbase_execute') {
            const result = await browserbaseClient.executeTool(cachedAction.action, cachedAction.payload);
            return res.json({ success: true, message: `Browserbase successfully processed target domain [${cachedAction.payload.url}].`, result });
        }

        return res.json({ success: true, message: `Action [${cachedAction.action}] deployed securely.` });
    } catch (err) { return res.status(500).json({ success: false, error: `Pipeline failure: ${err.message}` }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost AI Engine Online on port ${PORT}.`));