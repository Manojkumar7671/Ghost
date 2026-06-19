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
                const codeRegex = /
http://googleusercontent.com/immersive_entry_chip/0

Once the Render build is green, attach the text file as outlined above and run the `Omni-Matrix System Diagnostic` command. You will finally hear Ghost speak the confirmation to you clearly while executing the most complex task possible. Ensure you have your system volume up!