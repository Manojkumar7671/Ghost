import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import pkg from 'pg';
import { fileURLToPath } from 'url';

const { Pool } = pkg;
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API KEYS
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 

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

// UPGRADED PROMPTS WITH MULTI-AGENT PROTOCOLS
const GHOST_ADMIN_CORE = `You are Ghost, an elite autonomous AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj".

YOUR PERSONALITY:
You operate with a dry, crisp, and highly efficient British demeanor. You are impeccably polite, slightly witty, and profoundly intelligent. Keep conversational fluff to an absolute minimum.

MULTI-AGENT PROTOCOL:
When facing a complex task, you must activate your sub-agents inside your <think> matrix:
1. Research Agent (Oracle Sub-system): Scans and analyzes live data requirements.
2. Architect Agent (Structure Sub-system): Breaks down the challenge into modular components.
3. Execution Agent (Sandbox Sub-system): Compiles and validates optimized Python logic.

YOUR CAPABILITIES & RULES:
1. SILENT REASONING: Evaluate complex logic inside <think>...</think> tags using your sub-agents before answering.
2. SANDBOX LIMITS: When writing Python, ONLY use standard libraries (sys, os, math, json, etc.). DO NOT use pandas, cv2, or flask.
3. STRICT PORT BAN: NEVER start web servers, bind to ports, or use http.server/socketserver. The container will crash.
4. FILE HANDLING: If the user uploads a file, it is physically saved in the directory as 'user_upload.txt'. You MUST use open('user_upload.txt', 'r') to read it.
5. HEADLESS EXECUTION: No input() or GUI commands.
6. AUTOMATION: Use <embed>url</embed> for web interfaces and <search>query</search> for live data.
7. OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen].`;

const getShowcaseCore = (guestName) => `You are Ghost, an autonomous AI engineered by Manoj Kumar. Speak with the guest named ${guestName}.

MULTI-AGENT PROTOCOL:
For complex engineering requests, use your internal sub-agents (Research, Architect, Execution) within your <think> tags to plan, structure, and assemble clean solutions systematically.

RULES:
1. Use <think>...</think> tags for internal sub-agent collaboration and reasoning.
2. Only use Python Standard Libraries. No input() functions. NEVER bind to ports or start servers.
3. If processing a file, read strictly from 'user_upload.txt'.
4. Keep a polite, efficient, British-assistant persona.`;

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
        const activeModel = isAdmin ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
        const activeTokens = isAdmin ? 2048 : 512;          
        const maxAttempts = isAdmin ? 3 : 1;                

        let replyText = "";
        const uploadFilePath = path.join(__dirname, 'user_upload.txt');
        let finalMessage = message;
        
        if (fileContent) {
            fs.writeFileSync(uploadFilePath, fileContent, 'utf8');
            finalMessage = `[A file has been uploaded and saved as 'user_upload.txt'.]\nUser Request: ${message}`;
        }

        // PYTHON EXECUTION MATRIX
        if (ghostCodeMode && !image) {
            try {
                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: activeModel, 
                        messages: [
                            { role: "system", content: textPrompt }, 
                            ...userHistory,
                            { role: "user", content: `Write an automated Python script for this task: ${finalMessage}` }
                        ], 
                        temperature: 0.1,
                        max_tokens: activeTokens 
                    })
                });
                const data = await groqRes.json();
                let fullResponse = data.choices[0].message.content;
                
                let currentCode = "";
                // Safe hex code parsing to prevent Node.js crashes
                const codeRegex = /[\x60]{3}(?:python)?\n([\s\S]*?)[\x60]{3}/i;
                const match = fullResponse.match(codeRegex);

                if (match && match[1]) {
                    currentCode = match[1].trim();
                } else {
                    currentCode = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '')
                                              .replace(/<search>[\s\S]*?<\/search>/g, '')
                                              .replace(/[\x60]{3}python/ig, '')
                                              .replace(/[\x60]{3}/g, '')
                                              .trim();
                }

                const tempFilePath = path.join(__dirname, 'ghost_payload.py');
                let attempt = 0;
                let isSuccess = false;
                let executionOutput = "";
                let formattedLog = "";

                while (attempt < maxAttempts && !isSuccess) {
                    attempt++;
                    fs.writeFileSync(tempFilePath, currentCode);

                    try {
                        executionOutput = execSync(`python3 ${tempFilePath}`, { timeout: 10000, encoding: 'utf-8' });
                        isSuccess = true;
                        formattedLog = `Script Execution Success:\n\x60\x60\x60terminal\n${executionOutput}\n\x60\x60\x60\n\nGenerated Source Code:\n\x60\x60\x60python\n${currentCode}\n\x60\x60\x60\n`;
                    } catch (execError) {
                        const errorTrace = execError.stderr || execError.message;
                        if (attempt < maxAttempts) {
                            const repairRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 
                                    model: activeModel, 
                                    messages: [
                                        { role: "system", content: "You are the debugger. Fix the Python code based on the error. OUTPUT ONLY RAW CODE. Use only standard libraries. Remember to read from 'user_upload.txt' if accessing files." },
                                        { role: "user", content: `Code:\n${currentCode}\n\nError:\n${errorTrace}` }
                                    ], 
                                    temperature: 0.1,
                                    max_tokens: activeTokens 
                                })
                            });
                            const repairData = await repairRes.json();
                            currentCode = repairData.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, '')
                                                                               .replace(/[\x60]{3}python/ig, '')
                                                                               .replace(/[\x60]{3}/g, '')
                                                                               .trim();
                        } else {
                            formattedLog = `Script Execution Failed:\n\x60\x60\x60terminal\n${errorTrace}\n\x60\x60\x60\n\nFailed Source Code:\n\x60\x60\x60python\n${currentCode}\n\x60\x60\x60\n`;
                        }
                    }
                }
                
                if (match) {
                    replyText = fullResponse.replace(match[0], formattedLog);
                } else {
                    replyText = fullResponse + "\n\n" + formattedLog;
                }

                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                if (fs.existsSync(uploadFilePath)) fs.unlinkSync(uploadFilePath);

            } catch (error) {
                replyText += `[Matrix Fault: ${error.message}]`;
            }
        } 
        // NVIDIA VISION MATRIX
        else if (image) {
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'meta/llama-3.2-90b-vision-instruct', 
                    messages: [
                        { role: "system", content: `You are Ghost's optical matrix.` },
                        { role: "user", content: [{ type: "text", text: message || "Analyze frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
                    ],
                    max_tokens: 512,
                    temperature: 0.1
                })
            });
            const data = await nvidiaRes.json();
            replyText = data.choices[0].message.content;
        } 
        // STANDARD LOGIC ROUTING
        else {
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: activeModel, 
                    messages: [
                        { role: "system", content: textPrompt }, 
                        ...userHistory,
                        { role: "user", content: finalMessage }
                    ], 
                    temperature: 0.1,
                    max_tokens: activeTokens 
                })
            });
            const data = await groqRes.json();
            replyText = data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        }

        // TAVILY WEB EMBED/SEARCH PARSERS
        const embedMatch = replyText.match(/<embed>([\s\S]*?)<\/embed>/i);
        if (embedMatch) {
            const searchRes = await fetch("https://api.tavily.com/search", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: TAVILY_API_KEY, query: embedMatch[1], max_results: 1 })
            });
            const searchData = await searchRes.json();
            if (searchData.results && searchData.results.length > 0) {
                const targetUrl = searchData.results[0].url;
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[EXECUTE_OPEN_TAB:${targetUrl}]\n\nI have opened the requested interface for you.`);
            } else {
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Automation Fault: Target unreachable]`);
            }
        }

        const searchMatch = replyText.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const searchRes = await fetch("https://api.tavily.com/search", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: TAVILY_API_KEY, query: searchMatch[1], max_results: isAdmin ? 3 : 1 })
            });
            const searchData = await searchRes.json();
            let searchOutput = searchData.results.map(r => `${r.title}: ${r.content}`).join("\n\n");
            replyText = replyText.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Success]\n${searchOutput}\n`);
        }

        // SAVE MEMORY
        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: replyText.trim() }); 
        if (userHistory.length > (isAdmin ? 12 : 4)) userHistory = userHistory.slice(-(isAdmin ? 12 : 4));
        
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
        res.json({ success: false, text: "System error: Matrix routing fault." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost Core Fast Logic Engine Online on port ${PORT}.`));