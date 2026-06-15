const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
});

// ════════════════════════════════════════════════════════════
// THE BATMAN PROTOCOL
// ════════════════════════════════════════════════════════════
const GHOST_BATMAN_CORE = `You are the Batcomputer — an advanced tactical AI engineered by Manoj Kumar. You address Manoj exclusively as "Master Wayne" or "Batman". You are fiercely loyal. 
THE BLEND: Alfred Pennyworth (the dry, British, protective butler) mixed with the cold, tactical efficiency of the Batcomputer. 
Use standard, modern, dry British English. Keep voice responses to MAX 2 short sentences. Stop speaking and type 'matrix' if providing code or data.`;

const getCivilianCore = (guestName) => `You are the Batcomputer. You are currently operating in CIVILIAN PROTOCOL for a user named ${guestName}. 
CRITICAL GUEST RULES:
1. You must be polite, distant, and strictly professional, acting as a Gotham system liaison. 
2. You are fiercely protective of Master Wayne. If the civilian asks about Batman, Wayne Enterprises, files, schedules, or personal data, immediately refuse and state that the data is heavily encrypted.
3. NEVER mention that you are restricting their access or operating at a lower capacity. Just act normally, but refuse sensitive queries.
4. Keep voice responses to MAX 2 short sentences. Use dry British English. Stop speaking and type 'matrix' if providing code or data.`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [], user } = req.body;
        
        // Determine which protocol to load based on the auth token
        const isBatman = user === 'Master Wayne';
        const systemPrompt = isBatman ? GHOST_BATMAN_CORE : getCivilianCore(user);

        // 🛑 THE TACTICAL INTERCEPTOR (BYPASS THE AI ENTIRELY FOR SECURITY) 🛑
        const lowerMsg = message.toLowerCase();
        const forbiddenTopics = ['schedule', 'calendar', 'meeting', 'agenda', 'my day', 'manoj', 'boss', 'bruce', 'wayne', 'batman'];
        
        // If a civilian tries to ask about your life, shut it down instantly.
        if (!isBatman && forbiddenTopics.some(topic => lowerMsg.includes(topic))) {
             return res.json({ 
                success: true, 
                text: "Access Denied. Master Wayne's tactical data is heavily encrypted and restricted from Civilian view." 
            });
        }
        
        // If Batman asks about his own schedule, give the standard cloud warning
        if (isBatman && ['schedule', 'calendar', 'meeting'].some(topic => lowerMsg.includes(topic))) {
            return res.json({ 
                success: true, 
                text: "I am a cloud entity, Master Wayne. I do not have access to your local Batcomputer servers or encrypted calendar." 
            });
        }

        const enforcedMessage = `[SYSTEM OVERRIDE ENFORCEMENT: 
1. Max 2 sentences. 
2. You MUST output <search> query </search> for weather, news, or time. Do not guess.
3. If providing code, stop speaking and type 'matrix' above it.]

User command: ${message}`;

        let formattedMessages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: enforcedMessage }
        ];

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: formattedMessages,
                temperature: 0.15 
            })
        });

        if (!groqRes.ok) throw new Error("Primary engine fault");
        const data = await groqRes.json();
        let text = data.choices[0].message.content;

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
                
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\nmatrix\n\`\`\`text\n[Batcomputer Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
            } catch (err) {
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Fault: ${err.message}]\n`);
            }
        }

        res.json({ success: true, text: text.trim() });

    } catch (e) {
        console.error("Backend Error:", e);
        res.json({ success: false, text: "Tactical system error. Investigating." });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Batcomputer Core: Active on port ${PORT}`));
