const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const { Pool } = require('pg');
const execPromise = util.promisify(exec);
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const { GROQ_API_KEY, OPENROUTER_API_KEY, SUPABASE_DB_URL, TAVILY_API_KEY, GEMINI_API_KEY } = process.env;

// --- DATABASE POOL CONFIGURATION ---
const pool = new Pool({
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
});

// --- TRIPLE-ENGINE ROUTING WITH FAILOVER ---
async function queryAIWithFallback(messages) {
    
    // --- MEMORY SANITIZER ---
    // Prevents 413 (Payload Too Large) errors by safely trimming massive chat histories
    const safeMessages = messages.map(msg => {
        let text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        text = text.replace(/data:image\/[a-zA-Z]*;base64,[^\s"']+/g, '[IMAGE_OMITTED]'); // Strip heavy image data
        if (text.length > 6000) text = text.substring(0, 6000) + '...[Truncated]';
        return { role: msg.role, content: text };
    });
    
    // Keep only the System Prompt (index 0) and the 6 most recent messages
    const trimmedMessages = [safeMessages[0], ...safeMessages.slice(-6)];

    // Tier 1: Primary Routing (Groq)
    if (GROQ_API_KEY) {
        try {
            console.log("Routing to Tier 1: Groq (llama-3.1-8b-instant)...");
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: trimmedMessages, temperature: 0.45 })
            });
            if (response.ok) {
                const data = await response.json();
                console.log("Tier 1 Execution Successful.");
                return data.choices[0].message.content;
            }
            console.warn(`Tier 1 throttled (Status ${response.status}). Dropping down to Tier 2...`);
        } catch (err) { console.warn(`Tier 1 network down. Dropping down to Tier 2...`); }
    }

    // Tier 2: Lightning Fast Fallback (Native Gemini REST API)
    if (GEMINI_API_KEY) {
        try {
            console.log("Routing to Tier 2: Gemini (gemini-1.5-flash)...");
            
            // Map history to Google's strict Native format to prevent 404 bugs
            let geminiContents = trimmedMessages.filter(m => m.role !== 'system').map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }));
            
            // Google strictly requires the first conversational message to be from the user
            if (geminiContents.length > 0 && geminiContents[0].role === 'model') {
                geminiContents.shift();
            }

            const systemInstruction = { parts: [{ text: trimmedMessages[0].content }] };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ system_instruction: systemInstruction, contents: geminiContents })
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log("Tier 2 Execution Successful.");
                return data.candidates[0].content.parts[0].text;
            }
            console.warn(`Tier 2 throttled (Status ${response.status}). Dropping down to Tier 3...`);
        } catch (err) { console.warn(`Tier 2 network down. Dropping down to Tier 3...`); }
    }

    // Tier 3: Last Resort Fallback (OpenRouter Auto-Router Free Tier)
    if (OPENROUTER_API_KEY) {
        try {
            console.log("Routing to Tier 3: OpenRouter (Auto Free Router)...");
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://ghost-hu5t.onrender.com',
                    'X-Title': 'Ghost OS'
                },
                body: JSON.stringify({ model: 'openrouter/free', messages: trimmedMessages, temperature: 0.5 })
            });
            if (response.ok) {
                const data = await response.json();
                console.log("Tier 3 Fallback Execution Successful.");
                return data.choices[0].message.content;
            }
            throw new Error(`OpenRouter API rejected request with status ${response.status}`);
        } catch (err) { throw new Error(`Tier 3 Execution Fault: ${err.message}`); }
    }

    throw new Error("Pipeline Execution Exception: No functional API keys are configured.");
}

// --- CORE CHAT API ROUTE ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        const tripleTick = String.fromCharCode(96, 96, 96);
        
        // SYSTEM PROMPT UPDATE: Zero emojis allowed, strict formatting.
        const systemPrompt = "You are Ghost. Speak with a refined, warm, female voice. Boss is Manoj. Address him as 'Boss'. Never use lists, bullet points, or markdown asterisks in your voice layer. Max 3 sentences in voice. Put all data in matrix layer. NEVER use emojis. Strictly no emojis, emoticons, or symbols under any circumstances. Tools: Only use <sql> query </sql> for database, <bash> command </bash> for terminal, or <search> query </search> for real-time web data IF explicitly requested by the user to solve a complex task. NEVER use any tools for casual conversation, greetings, or when the user just says 'hi'.";
        
        const formattedMessages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: message }];
        
        let text = await queryAIWithFallback(formattedMessages);

        // --- WEB SEARCH PARSER (TAVILY) ---
        const searchMatch = text.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const query = searchMatch[1].trim();
            try {
                if (!TAVILY_API_KEY) throw new Error("Tavily API key is unconfigured.");
                const searchRes = await fetch("https://api.tavily.com/search", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, max_results: 3 })
                });
                
                if (!searchRes.ok) throw new Error(`Tavily API Fault: Status ${searchRes.status}`);
                const searchData = await searchRes.json();
                
                text = text.replace(/<search>[\s\S]*?<\/search>/ig, '');
                let searchOutput = searchData.results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSummary: ${r.content}`).join("\n\n---\n\n");
                text += "\n\n" + tripleTick + "text\n[Web Oracle Execution: Success]\n" + searchOutput + "\n" + tripleTick;
            } catch (err) {
                text = text.replace(/<search>[\s\S]*?<\/search>/ig, '');
                text += "\n\n[Web Oracle Fault: " + err.message + "]";
            }
        }

        // --- ORACLE SQL PARSER & EXECUTION ---
        const sqlMatch = text.match(/<sql>([\s\S]*?)<\/sql>/i);
        if (sqlMatch) {
            const query = sqlMatch[1].trim();
            try {
                if (!SUPABASE_DB_URL) throw new Error("Database link is unconfigured.");
                const dbResult = await pool.query(query);
                text = text.replace(/<sql>[\s\S]*?<\/sql>/ig, '');
                
                let outputData;
                if (Array.isArray(dbResult)) {
                    outputData = dbResult.map(res => res.rows || { command: res.command, rowCount: res.rowCount });
                } else {
                    outputData = dbResult.rows || { command: dbResult.command, rowCount: dbResult.rowCount };
                }
                text += "\n\n" + tripleTick + "text\n[Supabase Oracle Execution: Success]\n" + JSON.stringify(outputData, null, 2) + "\n" + tripleTick;
            } catch (err) {
                text = text.replace(/<sql>[\s\S]*?<\/sql>/ig, '');
                text += "\n\n[Supabase Oracle Fault: " + err.message + "]";
            }
        }

        // --- TERMINAL BASH PARSER & EXECUTION ---
        const bashMatch = text.match(/<bash>([\s\S]*?)<\/bash>/);
        if (bashMatch) {
            try {
                const { stdout } = await execPromise(bashMatch[1].trim(), { timeout: 10000 });
                text = text.replace(/<bash>[\s\S]*?<\/bash>/, '');
                const safeOutput = stdout.length > 2000 ? stdout.substring(0, 2000) + "\n\n...[Terminal Output Truncated to prevent memory overload]" : stdout;
                text += "\n\n" + tripleTick + "text\n[Terminal Output]:\n" + safeOutput + "\n" + tripleTick;
            } catch (err) { text += "\n\n[Terminal Fault: " + err.message + "]"; }
        }

        res.json({ success: true, text: text.trim() });
    } catch (e) {
        res.json({ success: false, text: "Core Engine Fault: " + e.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('Ghost OS Core: Active (Triple-Engine, Zero Emoji Mode)'));
