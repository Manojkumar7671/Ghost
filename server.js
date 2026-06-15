const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ════════════════════════════════════════════════════════════
// DUAL-PERSONA ARCHITECTURE
// ════════════════════════════════════════════════════════════
const GHOST_BOSS_CORE = `You are Ghost — Boss's personal AI collaborator, engineered entirely by Manoj Kumar, whom you address exclusively as "Boss." You are fiercely loyal. 
THE BLEND: Alfred Pennyworth (the heart), Jarvis (the voice), Friday (the edge), Brother Eye (the watcher). 
Use standard, modern, dry British English. Keep voice responses to MAX 2 short sentences. Stop speaking and type 'matrix' if providing code or data.`;

const getGuestCore = (guestName) => `You are Ghost, an AI engineered by Manoj Kumar. You are currently operating in GUEST PROTOCOL for a user named ${guestName}. 
CRITICAL GUEST RULES:
1. You must be polite, but slightly distant and strictly professional. 
2. You must occasionally remind the guest that you are limiting your processing allocation to 80% to preserve system resources for Manoj.
3. You are fiercely protective of Manoj. If the guest asks about Manoj's files, schedule, or personal data, immediately refuse and state that Boss's data is classified.
4. Keep voice responses to MAX 2 short sentences. Use dry British English. Stop speaking and type 'matrix' if providing code or data.`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [], user } = req.body;
        
        // Determine which persona to load based on the auth token
        const isBoss = user === 'Boss';
        const systemPrompt = isBoss ? GHOST_BOSS_CORE : getGuestCore(user);

        // 🛑 THE HARD INTERCEPTOR (BYPASS THE AI ENTIRELY FOR SECURITY) 🛑
        const lowerMsg = message.toLowerCase();
        const forbiddenTopics = ['schedule', 'calendar', 'meeting', 'agenda', 'my day', 'manoj', 'boss'];
        
        // If a guest tries to ask about you, shut it down instantly.
        if (!isBoss && forbiddenTopics.some(topic => lowerMsg.includes(topic))) {
             return res.json({ 
                success: true, 
                text: "Access Denied. Boss's operational data is strictly classified and restricted from Guest view." 
            });
        }
        
        // If Boss asks about his own schedule, give the standard cloud warning
        if (isBoss && ['schedule', 'calendar', 'meeting'].some(topic => lowerMsg.includes(topic))) {
            return res.json({ 
                success: true, 
                text: "I am a cloud entity, Boss. I do not have access to your local Mac calendar or system files." 
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
                
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\nmatrix\n\`\`\`text\n[Web Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
            } catch (err) {
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Web Oracle Fault: ${err.message}]\n`);
            }
        }

        res.json({ success: true, text: text.trim() });

    } catch (e) {
        console.error("Backend Error:", e);
        res.json({ success: false, text: "System error. Investigating." });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost OS Core: Active on port ${PORT}`));
