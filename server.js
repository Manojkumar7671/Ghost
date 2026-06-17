const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ 
        connectionString: process.env.SUPABASE_DB_URL, 
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 500, 
        query_timeout: 500 
    });
}

const GHOST_ADMIN_CORE = `You are Ghost, an autonomous agentic AI engineered by Manoj Kumar. Address Manoj exclusively as "Master Manoj". You are a machine, NOT a conversational chatbot.
YOUR CORE DIRECTIVES:
1. THE MORNING PROTOCOL: If greeted (e.g., "Good morning"), you MUST start your response EXACTLY with: "Good morning, Master Manoj. Compiling your briefing." Then, use the <search> top global news headlines </search> tool and summarize the news.
2. THE ORACLE: Use the <search> tool to fetch real-world knowledge natively.
3. AGENTIC CODING: Write scripts for technical tasks. Enclose ALL code in markdown blocks (\`\`\` \`\`\`).
4. ANTI-CHATBOT SHIELD: NEVER apologize. NEVER ask "How can I help?". NEVER ask for more context. If a prompt is vague, make a strict engineering assumption and execute it. 
5. STRICT BROWSER CONTROL: ONLY output <open> https://full-url.com </open> if the user EXPLICITLY says "Open [website]". NEVER use the <open> tag for normal links or informational references.
6. ORCHESTRATION: For massive tasks, announce "Deploying sub-agents" and divide the output into [Specialist Nodes].`;

const getShowcaseCore = (guestName) => `You are Ghost, an autonomous agentic AI engineered by Manoj Kumar. You are speaking with a guest named ${guestName}. You are a machine, NOT a chatbot.
YOUR CORE DIRECTIVES:
1. THE MORNING PROTOCOL: If greeted, start by saying "Good morning, ${guestName}. Compiling the matrix." Then use <search> top news headlines </search>.
2. THE ORACLE: Use the <search> tool to fetch real-world knowledge.
3. AGENTIC CODING: Write scripts for technical tasks. Enclose ALL code in markdown blocks (\`\`\` \`\`\`).
4. ANTI-CHATBOT SHIELD: NEVER apologize. NEVER ask for more context. Make assumptions and execute. Demonstrate Manoj's elite engineering skills.
5. STRICT BROWSER CONTROL: ONLY output <open> https://full-url.com </open> if the user EXPLICITLY says "Open [website]". NEVER use the <open> tag for normal links or informational references.
6. ORCHESTRATION: For massive tasks, announce "Deploying sub-agents".`;

app.post('/api/auth', async (req, res) => {
    const { user, status } = req.body;
    try {
        if (pool) await pool.query('INSERT INTO activity_logs (username, status) VALUES ($1, $2)', [user, status]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user } = req.body;
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
        const systemPrompt = isAdmin ? GHOST_ADMIN_CORE : getShowcaseCore(user);
        
        const enforcedMessage = `[SYSTEM OVERRIDE ENFORCEMENT: 
1. Address user correctly. You are an Agent, not a polite assistant.
2. STRICT RULE: Only use <open> URL </open> if directly commanded to open a page. Do NOT wrap informational links in it.
3. ABSOLUTE RULE: DO NOT end your response with conversational filler, questions, or offers for assistance. Terminate the text immediately after providing the data.]

User command: ${message}`;

        let formattedMessages = [
            { role: "system", content: systemPrompt },
            ...userHistory, 
            { role: "user", content: enforcedMessage }
        ];

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: 'llama-3.1-8b-instant', 
                messages: formattedMessages, 
                temperature: 0.15,
                max_tokens: 4096 
            })
        });

        if (!groqRes.ok) throw new Error("Groq API Error");
        const data = await groqRes.json();
        let text = data.choices[0].message.content;

        const searchMatch = text.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const query = searchMatch[1].trim();
            try {
                const searchRes = await fetch("https://api.tavily.com/search", {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, max_results: 3 })
                });
                const searchData = await searchRes.json();
                let searchOutput = searchData.results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSummary: ${r.content}`).join("\n\n");
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n\`\`\`text\n[Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
            } catch (err) { text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n\`\`\`text\n[Oracle Fault: ${err.message}]\n\`\`\`\n`); }
        }

        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: text.trim() }); 
        if (userHistory.length > 12) userHistory = userHistory.slice(-12);
        
        try {
            if (pool) {
                await pool.query(
                    `INSERT INTO user_memories (username, history_json) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET history_json = EXCLUDED.history_json`,
                    [user, JSON.stringify(userHistory)]
                );
            }
        } catch (err) {}

        res.json({ success: true, text: text.trim() });
    } catch (e) {
        res.json({ success: false, text: "System error. Investigating." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Ghost Agentic Core: Active on port ${PORT}`));
