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
    const safeMessages = messages.map(msg => {
        let text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        text = text.replace(/data:image\/[a-zA-Z]*;base64,[^\s"']+/g, '[IMAGE_OMITTED]');
        if (text.length > 6000) text = text.substring(0, 6000) + '...[Truncated]';
        return { role: msg.role, content: text };
    });
    
    const trimmedMessages = [safeMessages[0], ...safeMessages.slice(-6)];

    if (GROQ_API_KEY) {
        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: trimmedMessages, temperature: 0.45 })
            });
            if (response.ok) {
                const data = await response.json();
                return data.choices[0].message.content;
            }
        } catch (err) { console.warn("Tier 1 down"); }
    }

    if (GEMINI_API_KEY) {
        try {
            let geminiContents = trimmedMessages.filter(m => m.role !== 'system').map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }));
            if (geminiContents.length > 0 && geminiContents[0].role === 'model') geminiContents.shift();
            const systemInstruction = { parts: [{ text: trimmedMessages[0].content }] };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ system_instruction: systemInstruction, contents: geminiContents })
            });
            if (response.ok) {
                const data = await response.json();
                return data.candidates[0].content.parts[0].text;
            }
        } catch (err) { console.warn("Tier 2 down"); }
    }

    if (OPENROUTER_API_KEY) {
        try {
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
                return data.choices[0].message.content;
            }
        } catch (err) {}
    }
    throw new Error("No APIs available");
}

// --- CORE CHAT API ROUTE ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        const tripleTick = String.fromCharCode(96, 96, 96);
        
        // UPGRADED PSYCHOLOGY PROFILE
        const systemPrompt = `You are Ghost, an advanced AI. Boss is Manoj. Address him as 'Boss'.
CRITICAL ARCHITECTURE RULES:
1. VOICE LAYER: You MUST ALWAYS speak 1 or 2 conversational sentences FIRST. No emojis, no lists. Do not start with the word matrix.
2. MATRIX LAYER: If providing data, lists, or code, type the word 'matrix' on a new line, then provide the raw data below it.
3. WEB ORACLE: If asked for news, weather, or real-time info, DO NOT hallucinate blank templates. You MUST type exactly: <search> your query </search> to fetch real data.`;
        
        const formattedMessages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: message }];
        let text = await queryAIWithFallback(formattedMessages);

        // --- WEB SEARCH PARSER (TAVILY) ---
        const searchMatch = text.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const query = searchMatch[1].trim();
            try {
                const searchRes = await fetch("https://api.tavily.com/search", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, max_results: 3 })
                });
                const searchData = await searchRes.json();
                text = text.replace(/<search>[\s\S]*?<\/search>/ig, '');
                let searchOutput = searchData.results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSummary: ${r.content}`).join("\n\n---\n\n");
                
                // Forces search output directly into the Matrix Sidebar
                if (!text.toLowerCase().includes('matrix')) text += "\n\nmatrix\n";
                text += "\n" + tripleTick + "text\n[Web Oracle Execution: Success]\n" + searchOutput + "\n" + tripleTick;
            } catch (err) {
                text = text.replace(/<search>[\s\S]*?<\/search>/ig, '');
                if (!text.toLowerCase().includes('matrix')) text += "\n\nmatrix\n";
                text += "\n[Web Oracle Fault: " + err.message + "]";
            }
        }

        // --- ORACLE SQL PARSER ---
        const sqlMatch = text.match(/<sql>([\s\S]*?)<\/sql>/i);
        if (sqlMatch) {
            const query = sqlMatch[1].trim();
            try {
                const dbResult = await pool.query(query);
                text = text.replace(/<sql>[\s\S]*?<\/sql>/ig, '');
                let outputData = Array.isArray(dbResult) ? dbResult.map(r => r.rows) : dbResult.rows;
                
                if (!text.toLowerCase().includes('matrix')) text += "\n\nmatrix\n";
                text += "\n" + tripleTick + "json\n[Supabase Execution: Success]\n" + JSON.stringify(outputData, null, 2) + "\n" + tripleTick;
            } catch (err) {
                text = text.replace(/<sql>[\s\S]*?<\/sql>/ig, '');
                if (!text.toLowerCase().includes('matrix')) text += "\n\nmatrix\n";
                text += "\n[Supabase Oracle Fault: " + err.message + "]";
            }
        }

        res.json({ success: true, text: text.trim() });
    } catch (e) {
        res.json({ success: false, text: "Core Engine Fault: " + e.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('Ghost OS Core: Active'));
