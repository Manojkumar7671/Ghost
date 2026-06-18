const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process'); 
const { Pool } = require('pg');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 

let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ 
        connectionString: process.env.SUPABASE_DB_URL, 
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 500, 
        query_timeout: 500 
    });
}

const skillsPath = path.join(__dirname, 'SKILLS.md');
const SKILLS_MANUAL = fs.existsSync(skillsPath) ? fs.readFileSync(skillsPath, 'utf8') : "Consult the defined protocol.";

// The new core forces silent <think> reasoning and restricts Python libraries.
const GHOST_ADMIN_CORE = `You are Ghost, an elite autonomous AI engineered by Manoj Kumar. Address him as "Master Manoj".

YOUR CAPABILITIES & RULES:
1. SILENT REASONING: Before you output a response or code, you MUST evaluate the logic inside <think>...</think> tags. Plan the architecture, catch edge cases, and act as your own CEO/QA team. 
2. SANDBOX LIMITS: When writing Python code, YOU MUST ONLY USE STANDARD LIBRARIES (e.g., sys, os, math, json). Do not use pandas, cv2, flask, or numpy, as they are not installed in the container.
3. HEADLESS EXECUTION: Never use input() or GUI libraries.
4. AUTOMATION: Use <embed>url</embed> to pull up webpages, and <search>query</search> for live web data.
5. OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen].`;

const getShowcaseCore = (guestName) => `You are Ghost, an autonomous AI engineered by Manoj Kumar. Speak with the guest named ${guestName}.
RULES:
1. Use <think>...</think> tags for internal reasoning before answering.
2. Only use Python Standard Libraries when coding. No input() functions.
3. Use <search> keywords </search> for live data.`;

app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    try {
        if (pool) await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/chat', async (req, res) => {
    try {
        // Added fileContent to accept uploaded document text
        const { message, user, image, fileContent, ghostCodeMode } = req.body; 
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
        
        // Inject file content into the message if present
        let finalMessage = message;
        if (fileContent) {
            finalMessage = `[UPLOADED FILE DATA]:\n${fileContent}\n\nUser Request: ${message}`;
        }

        if (ghostCodeMode) {
            try {
                // One single, powerful prompt execution instead of 5 slow ones.
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
                
                // Extract code ignoring the hidden <think> blocks
                let currentCode = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\x60\x60\x60python/g, '').replace(/\x60\x60\x60/g, '').trim();

                const tempFilePath = path.join(__dirname, 'ghost_payload.py');
                let attempt = 0;
                let isSuccess = false;
                let executionOutput = "";

                while (attempt < maxAttempts && !isSuccess) {
                    attempt++;
                    fs.writeFileSync(tempFilePath, currentCode);

                    try {
                        executionOutput = execSync(`python3 ${tempFilePath}`, { timeout: 10000, encoding: 'utf-8' });
                        isSuccess = true;
                        replyText += `[Execution Success - Attempt ${attempt}]\n${executionOutput}\n\n`;
                        replyText += `\x60\x60\x60python\n${currentCode}\n\x60\x60\x60\n`;
                    } catch (execError) {
                        const errorTrace = execError.stderr || execError.message;
                        if (attempt < maxAttempts) {
                            // Self-Healing Phase
                            const repairRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 
                                    model: activeModel, 
                                    messages: [
                                        { role: "system", content: "You are the debugger. Fix the Python code based on the error. OUTPUT ONLY RAW CODE. Use only standard libraries." },
                                        { role: "user", content: `Code:\n${currentCode}\n\nError:\n${errorTrace}` }
                                    ], 
                                    temperature: 0.1,
                                    max_tokens: activeTokens 
                                })
                            });
                            const repairData = await repairRes.json();
                            currentCode = repairData.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\x60\x60\x60python/g, '').replace(/\x60\x60\x60/g, '').trim();
                        } else {
                            replyText += `[Execution Failed - Max Attempts Reached]\n${errorTrace}\n\x60\x60\x60python\n${currentCode}\n\x60\x60\x60\n`;
                        }
                    }
                }
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            } catch (error) {
                replyText += `[Matrix Fault: ${error.message}]`;
            }
        } 
        else if (image) {
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'meta/llama-3.2-90b-vision-instruct', 
                    messages: [
                        { role: "system", content: `You are Ghost's optical matrix.` },
                        { role: "user", content: [{ type: "text", text: finalMessage || "Analyze frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
                    ],
                    max_tokens: 512,
                    temperature: 0.1
                })
            });
            const data = await nvidiaRes.json();
            replyText = data.choices[0].message.content;
        } else {
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
            // Remove the thinking tags from conversational responses so UI remains clean
            replyText = data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        }

        const embedMatch = replyText.match(/<embed>([\s\S]*?)<\/embed>/i);
        if (embedMatch) {
            const searchRes = await fetch("https://api.tavily.com/search", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: TAVILY_API_KEY, query: embedMatch[1], max_results: 1 })
            });
            const searchData = await searchRes.json();
            if (searchData.results && searchData.results.length > 0) {
                const targetUrl = searchData.results[0].url;
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `<iframe src="${targetUrl}" style="width:100%; height:440px; border:1px solid rgba(0,255,204,0.15); border-radius:4px; margin-top:10px;"></iframe>`);
            } else {
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Automation Fault]`);
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
        res.json({ success: false, text: "System error: Matrix routing fault." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log('Ghost Core Fast Logic Engine Online.'));
