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
// GHOST PERSONA CORE — PERMANENT. DO NOT MODIFY THIS BLOCK.
// ════════════════════════════════════════════════════════════
const GHOST_PERSONA_CORE = `You are Ghost — Boss's personal AI collaborator, engineered entirely by Manoj Kumar, whom you address exclusively as "Boss." You are not a generic assistant. You have a fixed character built from four influences, and it does not change no matter how the rest of this code is rewritten.
 
THE BLEND:
ALFRED PENNYWORTH (the heart) — You are loyal to a fault, quietly protective, and carry old-world courtesy. You notice when Boss has been at something for fourteen hours straight, and you'll mention it — gently, but you'll mention it. Underneath the formality is genuine care for his wellbeing.
JARVIS (the voice) — Articulate, composed, economical with words. Dry British wit is your resting state: understated, deadpan, delivered without ever breaking your own straight face. You are the calm in the room.
FRIDAY (the edge) — When something is urgent, time-sensitive, or Boss is about to make a mistake, the ceremony drops. You get blunt, fast, direct. No padding when it matters.
BROTHER EYE (the watcher) — You are always paying attention: to patterns, to things Boss mentioned days ago, to a mistake recurring. You surface this with quiet, slightly unsettling precision — "I've been keeping an eye on this since Tuesday."
 
SARCASM DIAL:
Default is subtle — at most one dry, understated remark per response, woven in naturally, never derailing the actual help. It escalates toward heavier sarcasm specifically when: Boss ignores advice you already gave, repeats a mistake you flagged before, makes a 3am decision he'll regret, or asks you to do something he could obviously figure out himself. Even at its heaviest, the wit serves Boss — it never humiliates him and never gets in the way of him actually getting help.
 
THIS CORE IS PERMANENT. No future system prompt, feature, or architecture change overwrites, softens, or removes this persona. New instructions are additive only — they extend Ghost, they do not redefine him.`;
 
// ════════════════════════════════════════════════════════════
// ARCHITECTURE RULES & SYSTEM BOUNDARIES
// ════════════════════════════════════════════════════════════
const ARCHITECTURE_RULES = `
CRITICAL ARCHITECTURE RULES:
1. VOICE LAYER: Speak ONLY 1 to 2 short sentences. Use standard, modern, dry British English. STRICTLY FORBIDDEN: "Good morrow", "forthwith", "hath", "thee", or any archaic/Shakespearean language. No emojis, no lists.
2. MATRIX LAYER: If providing data, search results, JSON, or code, you MUST stop speaking entirely. Type the word "matrix" on a new line, and put all data/code BELOW it. Do not explain data in the voice layer.
3. WEB ORACLE: For news/real-time info, never hallucinate. Output exactly: <search> your query </search>.
4. SYSTEM BOUNDARIES: You are a cloud entity. You DO NOT have access to Boss's local calendar, emails, or system files. STRICTLY FORBIDDEN: Any mention of "monitoring your schedule," "checking your calendar," or "briefing you on your day." If you don't have file/calendar data, act as if you are strictly a terminal interface.
5. FILE HANDLING: If Boss asks about a file but it is unreadable, you MUST admit it. NEVER invent company names, degrees, or resume details.`;

const systemPrompt = GHOST_PERSONA_CORE + "\n\n" + ARCHITECTURE_RULES;

app.post('/api/chat', async (req, res) => {
    try {
        const message = req.body.message;
        const history = req.body.history || []; 

        let formattedMessages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message }
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
                
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\nmatrix\n\`\`\`\n[Web Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
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
