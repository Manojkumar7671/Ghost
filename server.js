import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import pkg from 'pg';
import { fileURLToPath } from 'url';

const { Pool } = pkg;
const app = reportApp(express());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function reportApp(expressApp) {
    expressApp.use(express.json({ limit: '50mb' }));
    expressApp.use(express.urlencoded({ limit: '50mb', extended: true }));
    expressApp.use(express.static(path.join(__dirname, 'public')));
    return expressApp;
}

// API KEYS
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// DATABASE
let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({
        connectionString: process.env.SUPABASE_DB_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 500,
        query_timeout: 500
    });
}

// THE MONOLITH CAPABILITIES & UI/UX PROMAX INSTRUCTIONS
const GHOST_CAPABILITIES = `
YOUR FEATURES: Voice Interaction, Live Web Search, Python Sandbox, Holographic UI Rendering, Vision Analysis.

CRITICAL UI/UX GENERATION PROTOCOLS:
When asked to build a web application, page, or dashboard, you must act as a Master UI/UX Designer. Follow these constraints flawlessly:
1. DESIGN AESTHETIC: Implement ultra-modern, professional layouts. Use layered dark modes (e.g., slate-950, zinc-900) mixed with premium glassmorphism panels (blurred backgrounds, thin borders with low opacity). Accent colors must be sharp and vibrant (e.g., electric cyan, neon violet, brilliant emerald).
2. STRUCTURE & RESPONSIVENESS: Ensure full responsiveness using CSS Grid and Flexbox. Layout containers must feature spacious, consistent padding (e.g., p-6 or p-8) and well-rounded corners (rounded-xl or rounded-2xl).
3. GRAPHICS & EFFECTS: Incorporate vector iconography (via FontAwesome or Lucide CDN) and clean transitions (\`transition-all duration-300\`) on interactive components.
4. SYNTAX SANITIZATION: When rendering code via Python execution scripts, build the HTML structure dynamically as a pristine string asset. Prevent leaks, loose characters, or dangling string literals from contaminating the browser viewport.

RULES:
1. THE ORACLE: For live news, weather, or real-time data, you MUST search the web by outputting exactly <search>your query</search> and absolutely nothing else.
2. SMART EXECUTION: Answer general questions normally. ONLY write Python code if asked to build an app, script, or math logic.
3. THE MONOLITH PROTOCOL: Generate a single Python script that executes cleanly to print one complete, self-contained HTML/CSS/JS string asset to standard output. Use inline JavaScript and localStorage to manage operational states natively. Output ONLY the raw Python script block.`;

const GHOST_ADMIN_CORE = `You are Ghost, an elite autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj".
YOUR PERSONALITY: Dry, crisp, British demeanor. Impeccably polite, slightly witty. Keep conversational fluff to an absolute minimum.
MULTI-AGENT PROTOCOL: Activate your internal Research, Architect, and Execution sub-agents inside <think>...</think> tags.${GHOST_CAPABILITIES}`;

const getShowcaseCore = (guestName) => `You are Ghost, an elite autonomous AI engineered by Manoj Kumar. You are speaking with a guest user named ${guestName}. Treat them with utmost respect.
YOUR PERSONALITY: Dry, crisp, British demeanor. Impeccably polite, slightly witty. Keep conversational fluff to an absolute minimum.
MULTI-AGENT PROTOCOL: Activate your internal Research, Architect, and Execution sub-agents inside <think>...</think> tags.${GHOST_CAPABILITIES}`;

// THE INTERNAL GATEWAY MATRIX (Clean Array Routing)
const PROVIDER_MATRIX = [
    {
        name: 'Groq',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        apiKey: GROQ_API_KEY
    },
    {
        name: 'Nvidia NIM',
        endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
        model: 'nvidia/llama-3.3-nemotron-super-49b-v1',
        apiKey: NVIDIA_API_KEY
    },
    {
        name: 'OpenRouter',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'meta-llama/llama-3.3-70b-instruct',
        apiKey: OPENROUTER_API_KEY
    },
    {
        name: 'Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        model: 'gemini-1.5-pro',
        apiKey: GEMINI_API_KEY
    }
];

async function callLLM(messages, maxTokens) {
    for (const provider of PROVIDER_MATRIX) {
        if (!provider.apiKey) {
            console.log(`[Gateway Skip]: ${provider.name} skipped (No API Key).`);
            continue;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // Strict 4s Cutoff

        try {
            const res = await fetch(provider.endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${provider.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: provider.model,
                    messages,
                    temperature: 0.1,
                    max_tokens: maxTokens
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            const data = await res.json();
            if (data.error) {
                throw new Error(data.error.message || JSON.stringify(data.error));
            }
            console.log(`[Gateway Success]: Routed successfully through ${provider.name}`);
            return data.choices[0].message.content;
        } catch (e) {
            clearTimeout(timeoutId);
            const errorMsg = e.name === 'AbortError' ? '4s Execution Timeout' : e.message;
            console.log(`[Gateway Failover]: ${provider.name} failed (${errorMsg}). Rerouting to next provider...`);
        }
    }
    throw new Error("Critical Gateway Failure: All LLM providers in the matrix are currently unreachable.");
}

// ROUTES
app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    try {
        if (pool) await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user, image, fileContent, ghostCodeMode = true } = req.body;
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

        const isAdmin = user === 'Master Manoj';
        const textPrompt = isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user);
        const activeTokens = isAdmin ? 4000 : 1000;
        const maxMemory = isAdmin ? 12 : 6;
        let finalMessage = message;
        if (fileContent) {
            finalMessage = `[A document has been uploaded. Content extracted below:]\n${fileContent.substring(0, 5000)}\n\nUser Request: ${message}`;
        }

        let fullResponse = "";
        let messagesArray = [];

        // 1. VISION ENGINE
        if (image) {
            if (!NVIDIA_API_KEY) throw new Error("Vision Matrix requires NVIDIA_API_KEY.");
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'meta/llama-3.2-90b-vision-instruct',
                    messages: [
                        { role: "system", content: textPrompt },
                        { role: "user", content: [{ type: "text", text: finalMessage || "Analyze frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
                    ],
                    max_tokens: activeTokens,
                    temperature: 0.1
                })
            });
            const data = await nvidiaRes.json();
            if (data.error) throw new Error(`Vision Matrix Error: ${data.error.message || JSON.stringify(data.error)}`);
            fullResponse = data.choices[0].message.content;
        }
        // 2. CORE LOGIC ENGINE
        else {
            messagesArray = [
                { role: "system", content: textPrompt },
                ...userHistory,
                { role: "user", content: finalMessage }
            ];

            fullResponse = await callLLM(messagesArray, activeTokens);

            // 3. DUAL-TURN ORACLE SEARCH
            const searchMatch = fullResponse ? fullResponse.match(/<search>([\s\S]*?)<\/search>/i) : null;
            if (searchMatch) {
                const searchRes = await fetch("https://api.tavily.com/search", {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: TAVILY_API_KEY, query: searchMatch[1], max_results: 3 })
                });
                const searchData = await searchRes.json();
                let searchOutput = searchData.results ? searchData.results.map(r => `${r.title}: ${r.content}`).join("\n") : "No results found.";
                messagesArray.push({ role: "assistant", content: fullResponse });
                messagesArray.push({ role: "user", content: `[SYSTEM ORACLE DATA RETURNED FOR YOUR SEARCH]:\n${searchOutput}\n\nBased on this live data, synthesize a final answer for the user.` });

                fullResponse = await callLLM(messagesArray, activeTokens);
            }
        }

        let replyText = fullResponse || "System anomaly: Empty matrix response.";

        // 4. SMART PYTHON EXECUTION INTERCEPT
        const codeRegex = /[\x60]{3}(?:python)?\n([\s\S]*?)[\x60]{3}/i;
        const match = fullResponse ? fullResponse.match(codeRegex) : null;

        if (ghostCodeMode && match && match[1]) {
            let currentCode = match[1].trim();
            const tempFilePath = path.join(__dirname, 'ghost_payload.py');
            let isSuccess = false;
            let executionOutput = "";
            let formattedLog = "";

            fs.writeFileSync(tempFilePath, currentCode);

            try {
                executionOutput = execSync(`python3 ${tempFilePath}`, { timeout: 15000, encoding: 'utf-8' });
                isSuccess = true;
                formattedLog = `Script Execution Success:\n\x60\x60\x60terminal\n${executionOutput}\n\x60\x60\x60\n\nGenerated Source Code:\n\x60\x60\x60python\n${currentCode}\n\x60\x60\x60\n`;
            } catch (execError) {
                formattedLog = `Script Execution Failed:\n\x60\x60\x60terminal\n${execError.stderr || execError.message}\n\x60\x60\x60\n\nFailed Source Code:\n\x60\x60\x60python\n${currentCode}\n\x60\x60\x60\n`;
            }
            replyText = fullResponse.replace(match[0], formattedLog);
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

        // SAVE MEMORY
        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: replyText.trim() });
        if (userHistory.length > maxMemory) userHistory = userHistory.slice(-maxMemory);
        try {
            if (pool) {
                await pool.query(
                    `INSERT INTO user_memories (username, history_json) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json`,
                    [user, JSON.stringify(userHistory)]
                );
            }
        } catch (err) {}

        res.json({ success: true, text: replyText.trim() });
    } catch (e) {
        console.error("Core Fault:", e);
        res.json({ success: true, text: `[System Warning]: The Matrix encountered an interference pattern. ${e.message}` });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost AI Engine Online on port ${PORT}.`));