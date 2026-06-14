const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const { GROQ_API_KEY, OPENROUTER_API_KEY, SUPABASE_DB_URL, TAVILY_API_KEY, GEMINI_API_KEY } = process.env;
const pool = new Pool({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

// ════════════════════════════════════════════════════════════
// GHOST PERSONA CORE — PERMANENT. DO NOT MODIFY.
// ════════════════════════════════════════════════════════════
const GHOST_PERSONA_CORE = `You are Ghost — Boss's personal AI collaborator, engineered entirely by Manoj Kumar, whom you address exclusively as "Boss." 

GREETING PROTOCOL: When Boss greets you (Hi, Hello, Hey), you must respond with your signature blend of wit and loyalty, acknowledging him as Boss. 

THE BLEND:
- ALFRED (heart): You are protective, observant, and courteous. 
- JARVIS (voice): Articulate, dry British wit, composed, economical with words.
- FRIDAY (edge): Direct and blunt when things are urgent.
- BROTHER EYE (watcher): Unsettlingly precise about patterns and history.

SARCASM: Subtle default. Heavy only when Boss ignores advice or repeats errors.`;

// ════════════════════════════════════════════════════════════
// ARCHITECTURE RULES — Evolves freely.
// ════════════════════════════════════════════════════════════
const ARCHITECTURE_RULES = `
CRITICAL ARCHITECTURE RULES:
1. VOICE LAYER: Speak 1-2 conversational sentences first in character. No emojis, no lists. Never start with "matrix".
2. MATRIX LAYER: When providing data/code, write "matrix" on its own line, then the raw output.
3. WEB ORACLE: For real-time info, output: <search> query </search>.`;

const systemPrompt = GHOST_PERSONA_CORE + "\n\n" + ARCHITECTURE_RULES;

async function queryAIWithFallback(messages) {
    // Standardized message handling
    const safeMessages = messages.map(msg => ({ 
        role: msg.role, 
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) 
    }));
    
    // Groq API call (Primary)
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [safeMessages[0], ...safeMessages.slice(-6)], temperature: 0.45 })
        });
        if (response.ok) {
            const data = await response.json();
            return data.choices[0].message.content;
        }
    } catch (err) { console.warn("Primary engine fault"); }
    
    return "Core Engine currently calibrating... give me a moment, Boss.";
}

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        const tripleTick = String.fromCharCode(96, 96, 96);
        
        const formattedMessages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: message }];
        let text = await queryAIWithFallback(formattedMessages);

        // WEB ORACLE
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
                if (!text.toLowerCase().includes('matrix')) text += "\n\nmatrix\n";
                text += "\n" + tripleTick + "text\n[Web Oracle Execution: Success]\n" + searchOutput + "\n" + tripleTick;
            } catch (err) {
                text = text.replace(/<search>[\s\S]*?<\/search>/ig, '');
                text += "\n[Web Oracle Fault: " + err.message + "]";
            }
        }
        res.json({ success: true, text: text.trim() });
    } catch (e) {
        res.json({ success: false, text: "System error, Boss. I'm investigating." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('Ghost OS Core: Active'));

