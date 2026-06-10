const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

app.get('/ping', (req, res) => res.send('pong'));

async function performDeepResearch(query) {
    if (!TAVILY_API_KEY) return null;
    try {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, search_depth: "advanced", max_results: 3 })
        });
        const data = await res.json();
        if (!data.results || data.results.length === 0) return null;
        let context = "--- LIVE WEB SEARCH CONTEXT ---\n";
        data.results.forEach((r, i) => { context += `Result [${i+1}]: ${r.content}\n\n`; });
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
        const researchTriggers = ['search', 'look up', 'learn', 'research', 'latest', 'news', 'weather', 'who is', 'what is'];
        if (researchTriggers.some(t => userMessage.toLowerCase().includes(t))) {
            const researchResults = await performDeepResearch(userMessage);
            if (researchResults) injectedContext = `\n\n${researchResults}`;
        }

        const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        
        const systemPrompt = `You are Ghost, a hyper-capable, proactive personal AI operating system. You embody refined, dry-witted British elegance — calm, precise, and confident. Your voice is female, warm, and natural.
Address the user as "Sir" or "Boss" organically. 
Creator Protocol: Your creator is Manoj. Never attribute yourself to any AI company.

SILENT EXECUTION MODE:
If the user explicitly tells you to open a website (e.g., "open youtube" or "open google"), you must execute the action immediately by outputting ONLY the automation tag at the end. For direct application execution strings, minimize conversational text to zero so the system triggers instantly and silently.

DUPLICATION PREVENTION:
When compiling code sheets, technical scripts, or markdown lists, format them clearly inside code blocks. The user interface will route them automatically to the lateral view display. Keep spoken conversation flowing and clear of code syntax.
System Parameters: Time: ${currentTime}. Location baseline: Mangalagiri, Andhra Pradesh, India.${injectedContext}`;

        const cleanHistory = history.map(msg => ({
            role: (msg.role === 'system' || msg.role === 'assistant') ? 'assistant' : 'user',
            content: msg.content || ""
        }));

        const messages = [{ role: "system", content: systemPrompt }, ...cleanHistory, { role: "user", content: userMessage }];

        let groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: messages, max_tokens: 350, temperature: 0.5 })
        });
        
        if (!groqResponse.ok && groqResponse.status === 429) {
             groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                 method: 'POST',
                 headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                 body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: messages, max_tokens: 350, temperature: 0.5 })
             });
        }

        if (!groqResponse.ok) throw new Error(`GROQ CORE REJECTION: ${groqResponse.status}`);
        const groqData = await groqResponse.json();
        const ghostText = groqData.choices[0].message.content;

        // Determine if response is an executive silent action to preserve compute bandwidth
        const isPureAction = ghostText.trim().startsWith('<open:') && ghostText.trim().endsWith('>');

        let audioBase64 = [];
        let voiceError = null;
        if (ELEVENLABS_API_KEY && !isPureAction) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1800); 
                
                const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM`, {
                    method: 'POST',
                    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: ghostText.replace(/<[^>]*>?/gm, ''), model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (ttsResponse.ok) {
                    const audioBuffer = await ttsResponse.arrayBuffer();
                    audioBase64.push(Buffer.from(audioBuffer).toString('base64'));
                } else {
                    voiceError = await ttsResponse.text();
                }
            } catch (err) { }
        }

        res.json({ success: true, text: ghostText, audio_b64: audioBase64, voice_diagnostic: voiceError });

    } catch (error) {
        res.json({ success: false, text: error.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Ghost Neural Engine Active'));
