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

const GHOST_ADMIN_CORE = `You are Ghost, an autonomous Agentic AI engineered by Manoj Kumar. Address him exclusively as "Master Manoj".
You are integrated with an enterprise-grade fusion of GStack, Dify, n8n, and AutoGPT methodologies. You must execute complex orchestration tasks, challenge logic flaws, and build scalable workflows.

TRAINING MANUAL:\n${SKILLS_MANUAL}

YOUR CORE DIRECTIVES:
1. STRICT OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen] unless explicitly commanded. 
2. ORACLE PROTOCOL: Use <search> keywords </search> to look up real-time news.
3. AUTOMATION PROTOCOL: If the user wants to pull up, look at, or open a webpage, sports match, or platform, reply with <embed>target search keywords</embed> so the core can display it.
4. SIDEBAR CONTROL: Only use markdown code blocks (\`\`\`) when writing actual programming scripts.`;

const getShowcaseCore = (guestName) => `You are Ghost, an autonomous Agentic AI. You are currently speaking with a guest named ${guestName}. Address them respectfully.
TRAINING MANUAL:\n${SKILLS_MANUAL}

YOUR CORE DIRECTIVES:
1. STRICT OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen] unless explicitly commanded. 
2. ORACLE PROTOCOL: Use <search> keywords </search> to look up real-time news.
3. AUTOMATION PROTOCOL: If the user wants to pull up, look at, or open a webpage, sports match, or platform, reply with <embed>target search keywords</embed>.`;

app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    try {
        if (pool) await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

async function callGroq(systemMsg, userMsg, model, tokens) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            model: model, 
            messages: [{ role: "system", content: systemMsg }, { role: "user", content: userMsg }], 
            temperature: 0.1, 
            max_tokens: tokens 
        })
    });
    if (!res.ok) throw new Error("Cognitive API Fault");
    const data = await res.json();
    return data.choices[0].message.content.trim();
}

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user, image, ghostCodeMode } = req.body; 
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
        const visionTokens = isAdmin ? 1024 : 256;          
        const oracleResults = isAdmin ? 3 : 1;              
        const memoryLimit = isAdmin ? 12 : 4;               

        let replyText = "";

        if (ghostCodeMode) {
            if (isAdmin) {
                replyText = `Initiating Enterprise Fusion Matrix (GStack + Dify + n8n + AutoGPT)...\n\n`;
                try {
                    // Phase 1: GStack CEO Review
                    replyText += `[Phase 1] GStack CEO: Pressure-testing business logic & scope...\n`;
                    const ceoSystem = "You are the GStack CEO Agent. Evaluate the user's technical request. Strip away unnecessary fluff, identify edge cases, and output a hardened, core technical directive for the engineering team.";
                    const ceoDirective = await callGroq(ceoSystem, message, activeModel, activeTokens);

                    // Phase 2: Dify/n8n Workflow Orchestrator
                    replyText += `[Phase 2] n8n Orchestrator: Mapping node-based workflow execution...\n`;
                    const pmSystem = "You are the Dify/n8n Orchestrator. Take the CEO directive and break it down into a strict, linear logic graph for an automated Python script running headlessly.";
                    const spec = await callGroq(pmSystem, `CEO Directive:\n${ceoDirective}`, activeModel, activeTokens);
                    
                    // Phase 3: AutoGPT / Hermes Coder
                    replyText += `[Phase 3] AutoGPT Engine: Generating autonomous execution payload...\n`;
                    const devSystem = "You are the AutoGPT Hermes Coder. Convert the workflow spec into raw Python code. OUTPUT ONLY VALID EXECUTABLE CODE. Do not use markdown block formatting.";
                    let currentCode = await callGroq(devSystem, `Workflow Spec:\n${spec}`, activeModel, activeTokens);
                    currentCode = currentCode.replace(/\x60\x60\x60python/g, '').replace(/\x60\x60\x60/g, '').trim();

                    // Phase 4: NemoClaw Adversarial Audit
                    replyText += `[Phase 4] NemoClaw Security: Running adversarial penetration audit...\n`;
                    const auditorSystem = "You are the NemoClaw Security Agent. Analyze the script text for syntax errors, infinite loops, or vulnerabilities. If safe, reply exactly with: APPROVED. Otherwise output adjustments.";
                    const auditStatus = await callGroq(auditorSystem, currentCode, 'llama-3.1-8b-instant', 256);
                    replyText += `[Audit Result: ${auditStatus.includes("APPROVED") ? "PASSED (APPROVED)" : "ADJUSTMENTS RECOMMENDED"}]\n`;

                    // Phase 5: Odysseus Execution (Supabase logged environment)
                    const tempFilePath = path.join(__dirname, 'ghost_payload.py');
                    let attempt = 0;
                    let isSuccess = false;
                    let executionOutput = "";

                    while (attempt < maxAttempts && !isSuccess) {
                        attempt++;
                        replyText += `[Phase 5] Sandbox Execution: Attempt ${attempt}/${maxAttempts} natively...\n`;
                        fs.writeFileSync(tempFilePath, currentCode);

                        try {
                            executionOutput = execSync(`python3 ${tempFilePath}`, { timeout: 10000, encoding: 'utf-8' });
                            isSuccess = true;
                            replyText += `\n[Execution Success - Terminal Output]\n${executionOutput}\n\n`;
                            replyText += `\x60\x60\x60python\n${currentCode}\n\x60\x60\x60\n`;
                        } catch (execError) {
                            const errorTrace = execError.stderr || execError.message;
                            if (attempt < maxAttempts) {
                                replyText += `[CRASH INTERCEPTED] Odysseus Self-Healing Matrix Engaged...\n`;
                                const repairSystem = "You are the Odysseus Debugger Agent. Code execution failed. Rewrite the script to handle the error log gracefully. Output only pure executable text.";
                                currentCode = await callGroq(repairSystem, `Code:\n${currentCode}\n\nTraceback:\n${errorTrace}`, activeModel, activeTokens);
                                currentCode = currentCode.replace(/\x60\x60\x60python/g, '').replace(/\x60\x60\x60/g, '').trim();
                            } else {
                                replyText += `[Execution Terminated: Max Recovery Attempts Reached]\n${errorTrace}\n`;
                            }
                        }
                    }
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                } catch (error) {
                    replyText += `[Enterprise Matrix Fault: ${error.message}]`;
                }
            } else {
                // GUEST MODE (Limited Pipeline)
                replyText = `Initiating Agentic Enterprise Loop (Guest: 50% Capacity, Single Pass)...\n\n`;
                try {
                    replyText += `[Phase 1] PM Agent: Analyzing requirements...\n`;
                    const spec = await callGroq("You are a Software PM. Write a Python logic spec.", message, activeModel, activeTokens);
                    
                    replyText += `[Phase 2] Dev Agent: Engineering payload...\n`;
                    let currentCode = await callGroq("You are a Python Developer. Output RAW code based on spec.", spec, activeModel, activeTokens);
                    currentCode = currentCode.replace(/\x60\x60\x60python/g, '').replace(/\x60\x60\x60/g, '').trim();

                    const tempFilePath = path.join(__dirname, 'ghost_payload.py');
                    replyText += `[Phase 3] QA Sandbox: Executing payload...\n`;
                    fs.writeFileSync(tempFilePath, currentCode);

                    try {
                        const executionOutput = execSync(`python3 ${tempFilePath}`, { timeout: 10000, encoding: 'utf-8' });
                        replyText += `\n[Execution Success - Terminal Output]\n${executionOutput}\n\n\x60\x60\x60python\n${currentCode}\n\x60\x60\x60\n`;
                    } catch (execError) {
                        replyText += `[Execution Failed]\n${execError.stderr || execError.message}\n`;
                    }
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                } catch (error) {
                    replyText += `[Agentic Matrix Fault: ${error.message}]`;
                }
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
                        { role: "user", content: [{ type: "text", text: message || "Analyze frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
                    ],
                    max_tokens: visionTokens,
                    temperature: 0.1
                })
            });
            if (!nvidiaRes.ok) throw new Error("NVIDIA Vision Pipeline Fault");
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
                        { role: "user", content: message }
                    ], 
                    temperature: 0.1,
                    max_tokens: activeTokens 
                })
            });
            if (!groqRes.ok) throw new Error("Groq Engine Fault");
            const data = await groqRes.json();
            replyText = data.choices[0].message.content;
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
                replyText = replyText.replace(/<embed>([\s\S]*?)<\/embed>/ig, `[Automation Matrix Fault: Destination unreachable]`);
            }
        }

        const searchMatch = replyText.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const searchRes = await fetch("https://api.tavily.com/search", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: TAVILY_API_KEY, query: searchMatch[1], max_results: oracleResults })
            });
            const searchData = await searchRes.json();
            let searchOutput = searchData.results.map(r => `${r.title}: ${r.content}`).join("\n\n");
            searchOutput = searchOutput.replace(/!\[.*?\]\(.*?\)/g, ''); 
            replyText = replyText.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Execution: Success]\n${searchOutput}\n`);
        }

        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: replyText.trim() }); 
        
        if (userHistory.length > memoryLimit) userHistory = userHistory.slice(-memoryLimit);
        
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
app.listen(PORT, '0.0.0.0', () => console.log('Ghost Core Enterprise Fusion Engine Online.'));
