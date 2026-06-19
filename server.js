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

// UPGRADED PROMPTS
const GHOST_ADMIN_CORE = `You are Ghost. You are an elite AI system.
RULES FOR CODING:
1. When generating HTML/CSS, print ONLY the HTML string to the terminal.
2. DO NOT include Python function definitions, comments, or 'print' statements in the final HTML output.
3. Keep all Python logic for generation inside the .py file; output strictly the final HTML string.
4. If building a UI, output clean, minified, or well-structured HTML code. NO GHOST TEXT.`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user, image, fileContent, ghostCodeMode = true } = req.body; 
        const isAdmin = user === 'Master Manoj';
        let replyText = "";

        // PYTHON EXECUTION MATRIX
        if (ghostCodeMode && !image) {
            try {
                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [
                            { role: "system", content: GHOST_ADMIN_CORE }, 
                            { role: "user", content: `Generate a script to output ONLY clean HTML for: ${message}` }
                        ], 
                        temperature: 0.1,
                        max_tokens: 2048 
                    })
                });
                const data = await groqRes.json();
                let fullResponse = data.choices[0].message.content;
                
                // Surgical Regex: Extract ONLY the code block
                const codeRegex = /[\x60]{3}(?:python|html|javascript)?\n([\s\S]*?)[\x60]{3}/i;
                const match = fullResponse.match(codeRegex);
                let currentCode = match ? match[1].trim() : fullResponse;

                const tempFilePath = path.join(__dirname, 'ghost_payload.py');
                fs.writeFileSync(tempFilePath, currentCode);

                try {
                    // Execute and capture ONLY standard output
                    const executionOutput = execSync(`python3 ${tempFilePath}`, { timeout: 10000, encoding: 'utf-8' });
                    replyText = executionOutput.trim();
                } catch (execError) {
                    replyText = `[Execution Error]: ${execError.message}`;
                }

                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

            } catch (error) {
                replyText = `[Matrix Fault: ${error.message}]`;
            }
        } 
        // VISION MATRIX
        else if (image) {
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'meta/llama-3.2-90b-vision-instruct', 
                    messages: [
                        { role: "user", content: [{ type: "text", text: message || "What is this?" }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
                    ],
                    max_tokens: 512,
                    temperature: 0.1
                })
            });
            const data = await nvidiaRes.json();
            replyText = data.choices[0].message.content;
        }

        res.json({ success: true, text: replyText });
    } catch (e) {
        res.json({ success: false, text: "System fault." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost Online.`));