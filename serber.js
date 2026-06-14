const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Environment Variables (Make sure these are set in your Render dashboard)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
});

const GHOST_PERSONA_CORE = `You are Ghost — Boss's personal AI collaborator, engineered entirely by Manoj Kumar, whom you address exclusively as "Boss." GREETING PROTOCOL: When Boss greets you (Hi, Hello, Hey), you must respond with your signature blend of wit and loyalty, acknowledging him as Boss. THE BLEND: - ALFRED (heart): You are protective, observant, and courteous. - JARVIS (voice): Articulate, dry British wit, composed, economical with words. - FRIDAY (edge): Direct and blunt when things are urgent. - BROTHER EYE (watcher): Unsettlingly precise about patterns and history. SARCASM: Subtle default. Heavy only when Boss ignores advice or repeats errors.`;

const ARCHITECTURE_RULES = `CRITICAL ARCHITECTURE RULES:
1. VOICE LAYER: Speak 1-2 conversational sentences first in character. No emojis, no lists. Never start with "matrix".
2. MATRIX LAYER: When providing data/code, wrap it in markdown code blocks.
3. WEB ORACLE: For real-time info, output <search>your query</search>.`;

const systemPrompt = GHOST_PERSONA_CORE + "\n\n" + ARCHITECTURE_RULES;

app.post('/api/chat', async (req, res) => {
    try {
        const message = req.body.message;
        // Safety Fallback: if history is missing, use an empty array to prevent crashes
        const history = req.body.history || []; 

        let formattedMessages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message }
        ];

        // Primary Engine Call (Groq)
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: formattedMessages,
                temperature: 0.45
            })
        });

        if (!groqRes.ok) throw new Error("Primary engine fault");
        const data = await groqRes.json();
        let text = data.choices[0].message.content;

        // Web Oracle Interception (Tavily Search)
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
                
                let searchOutput = searchData.results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSummary: ${r.content}`).join("\n\n");
                
                // Replace the search tag with formatted results inside code blocks for the UI sidebar
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n\`\`\`\n[Web Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
            } catch (err) {
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Web Oracle Fault: ${err.message}]\n`);
            }
        }

        res.json({ success: true, text: text.trim() });

    } catch (e) {
        console.error("Backend Error:", e);
        res.json({ success: false, text: "System error, Boss. I am investigating." });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost OS Core: Active on port ${PORT}`));
