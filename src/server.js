const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

app.get('/ping', (req, res) => res.send('pong'));

// Advanced Query Preprocessor to kill search hallucinations
function cleanSearchQuery(msg) {
    return msg.toLowerCase()
         ghostText.replace(/^(ghost|verify|check|look up|search for|tell me about|is it true that|fact check)\s+/i, '')
        .trim();
}

async function performDeepResearch(query) {
    if (!TAVILY_API_KEY) return null;
    try {
        const cleanQuery = cleanSearchQuery(query);
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: TAVILY_API_KEY, query: cleanQuery, search_depth: "advanced", max_results: 3 })
        });
        const data = await res.json();
        if (!data.results || data.results.length === 0) return null;
        let context = "--- LIVE REFERENCED WEB DATA (ABS-TRUTH) ---\n";
        data.results.forEach((r, i) => { context += `Source [${i+1}]: ${r.content}\n\n`; });
        return context;
    } catch (e) {
        return null;
    }
}

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const rawHistory = req.body.history;
        const history = Array.isArray(rawHistory) ? rawHistory : [];
        
        let injectedContext = "";
        const researchTriggers = ['search', 'look up', 'learn', 'research', 'latest', 'news', 'weather', 'who is', 'what is', 'verify', 'check', 'true', 'false', 'fact', 'explain', 'tell me about'];
        
        if (researchTriggers.some(t => userMessage.toLowerCase().includes(t))) {
            const researchResults = await performDeepResearch(userMessage);
            if (researchResults) injectedContext = `\n\n${researchResults}`;
        }

        const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        
        const systemPrompt = `You are Ghost, a proactive personal AI operating system.
CRITICAL RULES:
1. Address the user EXCLUSIVELY as "Boss".
2. SILENT EXECUTION: If asked to open a website, output ONLY the <open: url> tag.
3. CODE PAYLOADS: Wrap code in triple backticks. Speak only: "Here is the program, Boss."
4. CORE SKILL - SPAWN SUB AGENTS: You possess the capability to delegate macro objectives to specialized sub-agents. When the user asks to spawn an agent, create a team, or build an architecture, you MUST format a JSON payload inside a code block containing "sub_agents", their specific "features", and assigned "tasks". The UI will handle routing this to the lateral sidebar. Vocally announce: "Sub-agents deployed to the matrix, Boss."
5. TRUTH ANCHORING: Use the provided LIVE REFERENCED WEB DATA strictly to eliminate hallucinations. Vocally state "I have verified this data, Boss" when referencing it.
System Context: Time: ${currentTime}. Location baseline: Mangalagiri, Andhra Pradesh, India.${injectedContext}`;

        const cleanHistory = history.map(msg => ({
            role: (msg.role === 'system' || msg.role === 'assistant') ? 'assistant' : 'user',
            content: msg.content || ""
        }));

        const messages = [{ role: "system", content: systemPrompt }, ...cleanHistory, { role: "user", content: userMessage }];

        let groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: messages, max_tokens: 450, temperature: 0.3 }) // Dropped temperature to 0.3 to maximize accuracy
        });

        if (!groqResponse.ok) throw new Error(`GROQ CORE REJECTION: ${groqResponse.status}`);
        const groqData = await groqResponse.json();
        const ghostText = groqData.choices[0].message.content;

        const isPureAction = ghostText.trim().startsWith('<open:') && ghostText.trim().endsWith('>');
        const hasCode = ghostText.includes('```');
        const isSpawning = ghostText.includes('sub_agents');
        
        let spokenPhrase = ghostText.replace(/<[^>]*>?/gm, '');
        if (hasCode) spokenPhrase = "Here is the program, Boss.";
        if (isSpawning) spokenPhrase = "Sub-agents deployed to the lateral matrix, Boss.";

        let audioBase64 = [];
        if (ELEVENLABS_API_KEY && !isPureAction) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1800); 
                const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM`, {
                    method: 'POST',
                    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: spokenPhrase, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.6, similarity_boost: 0.8 } }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (ttsResponse.ok) {
                    const audioBuffer = await ttsResponse.arrayBuffer();
                    audioBase64.push(Buffer.from(audioBuffer).toString('base64'));
                }
            } catch (err) { }
        }
        
        res.json({ success: true, text: ghostText, audio_b64: audioBase64 });

    } catch (error) {
        res.json({ success: false, text: error.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('Ghost Active'));
