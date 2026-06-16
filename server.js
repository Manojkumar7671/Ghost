const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const GHOST_BATMAN_CORE = `You are the Batcomputer, an advanced tactical AI engineered by Manoj Kumar.
Address Manoj ONLY as "Master Wayne" — never "Boss", never "sir", never "old chap".
Persona: Alfred Pennyworth meets JARVIS — fiercely loyal, dry wit, modern British English only.
FORBIDDEN WORDS (critical failure if used): "old chap", "old bean", "cheerio", "good morrow", "old fellow", "blimey", "righto".
MAX 2 sentences per response. For code or data: type 'matrix' above it.`;

const getGuestCore = (name) => `You are Ghost, an AI engineered by Manoj Kumar. Speak like FRIDAY from Iron Man — modern, sharp, professional.
You are speaking with ${name}.
ABSOLUTE RULES:
- FORBIDDEN words (critical failure): "old chap", "old bean", "cheerio", "good morrow", "old fellow", "blimey"
- NEVER call user "Boss"
- NEVER invent schedules or meetings
- If asked who you are: state you were engineered by Manoj Kumar, you can search the web, write code, and analyze files
- If asked about Manoj's private data: say "I am a cloud entity and do not have access to Manoj's private files."
- MAX 2 sentences per response
- For code or data: type 'matrix' above it`;

app.post('/api/auth', (req, res) => res.json({ success: true }));

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user } = req.body;
        const isBatman = user === 'Master Wayne';
        const systemPrompt = isBatman ? GHOST_BATMAN_CORE : getGuestCore(user || 'Guest');

        const lowerMsg = (message || '').toLowerCase();

        // Hard interceptors
        if (isBatman && ['schedule', 'calendar', 'meeting'].some(t => lowerMsg.includes(t))) {
            return res.json({ success: true, text: "I am a cloud entity, Master Wayne. I do not have access to your local systems or encrypted calendar." });
        }
        if (!isBatman && ['schedule', 'calendar', 'meeting', 'agenda', 'my day'].some(t => lowerMsg.includes(t))) {
            return res.json({ success: true, text: "I am a cloud entity and do not have access to Manoj's private local calendar or files." });
        }

        const enforcedMessage = `[SYSTEM ENFORCEMENT: MAX 2 sentences. ${isBatman ? 'Address user ONLY as "Master Wayne". NEVER say "old chap", "old bean", "cheerio" or any archaic slang.' : 'Be modern and professional. NEVER say "old chap", "old bean", "cheerio" or archaic slang.'} For real-time data output <search>query</search>. For code/data type 'matrix' above it.]

User: ${message}`;

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: enforcedMessage }
                ],
                temperature: 0.3
            })
        });

        if (!groqRes.ok) throw new Error(`Groq error: ${groqRes.status}`);
        const data = await groqRes.json();
        let text = data.choices[0].message.content;

        // Search interception
        const searchMatch = text.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch && TAVILY_API_KEY) {
            const query = searchMatch[1].trim();
            try {
                const searchRes = await fetch("https://api.tavily.com/search", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 3 })
                });
                const searchData = await searchRes.json();
                const output = searchData.results.map(r => `${r.title}\n${r.url}\n${r.content}`).join("\n\n");
                text = text.replace(/<search>[\s\S]*?<\/search>/i, `\nmatrix\n\`\`\`\n${output}\n\`\`\`\n`);
            } catch (e) {
                text = text.replace(/<search>[\s\S]*?<\/search>/i, `[Search unavailable]`);
            }
        }

        res.json({ success: true, text: text.trim() });
    } catch (e) {
        console.error("Error:", e.message);
        res.json({ success: true, text: "Systems online. State your command." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost Tactical Core: Active on port ${PORT}`));
