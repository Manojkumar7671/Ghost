const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ════════════════════════════════════════════════════════════
// DATABASE & EXCEL LOGGING INITIALIZATION
// ════════════════════════════════════════════════════════════
const MEMORY_FILE = path.join(__dirname, 'memories.json');
const LOG_FILE = path.join(__dirname, 'activity_log.csv');

// Create the Excel CSV file with headers if it doesn't exist
if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, "Timestamp,User,Status\n");
}
// Create the Memory Storage file if it doesn't exist
if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({}));
}

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

// --- ENDPOINT: Log User Activity to Excel ---
app.post('/api/auth', (req, res) => {
    const { user, status } = req.body;
    const timestamp = new Date().toLocaleString();
    fs.appendFileSync(LOG_FILE, `"${timestamp}","${user}","${status}"\n`);
    res.json({ success: true });
});

// --- ENDPOINT: Main Chat & Memory Engine ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message, user } = req.body;
        
        // 1. Load the user's specific memory file
        let memories = JSON.parse(fs.readFileSync(MEMORY_FILE));
        let userHistory = memories[user] || [];

        const isBatman = user === 'Master Wayne';
        const systemPrompt = isBatman ? GHOST_BATMAN_CORE : getCivilianCore(user);

        // 2. THE TACTICAL INTERCEPTOR (BYPASS THE AI FOR SECURITY)
        const lowerMsg = message.toLowerCase();
        const forbiddenTopics = ['schedule', 'calendar', 'meeting', 'agenda', 'my day', 'manoj', 'boss', 'bruce', 'wayne', 'batman'];
        
        if (!isBatman && forbiddenTopics.some(topic => lowerMsg.includes(topic))) {
             return res.json({ success: true, text: "Access Denied. Master Wayne's tactical data is heavily encrypted and restricted from Civilian view." });
        }
        
        if (isBatman && ['schedule', 'calendar', 'meeting'].some(topic => lowerMsg.includes(topic))) {
            return res.json({ success: true, text: "I am a cloud entity, Master Wayne. I do not have access to your local Batcomputer servers or encrypted calendar." });
        }

        // 3. The Cattle Prod Injection (NO "BOSS" ALLOWED)
        const enforcedMessage = `[SYSTEM OVERRIDE ENFORCEMENT: 
1. Max 2 sentences. ${isBatman ? 'NEVER use the word "Boss". Address user ONLY as "Master Wayne" or "Batman".' : 'Do not use the word "Boss". Address user politely as a Civilian.'}
2. You MUST output <search> query </search> for weather, news, or time. Do not guess.
3. If providing code, stop speaking and type 'matrix' above it.]

User command: ${message}`;

        let formattedMessages = [
            { role: "system", content: systemPrompt },
            ...userHistory, // Inject their past memories into the AI
            { role: "user", content: enforcedMessage }
        ];

        // 4. Ping the AI Engine
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: formattedMessages, temperature: 0.15 })
        });

        if (!groqRes.ok) throw new Error("Primary engine fault");
        const data = await groqRes.json();
        let text = data.choices[0].message.content;

        // 5. Check for Web Oracle Search
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
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\nmatrix\n\`\`\`text\n[Batcomputer Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
            } catch (err) {
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Fault: ${err.message}]\n`);
            }
        }

        // 6. Save the new conversation to the user's permanent memory
        userHistory.push({ role: 'user', content: message });
        userHistory.push({ role: 'assistant', content: text.replace(/matrix/gi, '').trim() }); // Don't save the matrix command to memory
        
        // Keep memory to last 12 messages so the AI doesn't crash from overload
        if (userHistory.length > 12) userHistory = userHistory.slice(-12);
        memories[user] = userHistory;
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2));

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
