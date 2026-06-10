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
            body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, search_depth: "basic", max_results: 2 })
        });
        const data = await res.json();
        if (!data.results) return null;
        let researchData = "--- LIVE WEB CONTEXT ---\n";
        data.results.forEach((r, i) => { researchData += `[${i+1}] ${r.content}\n`; });
        return researchData;
    } catch (e) {
        return null; // Fail silently so it doesn't crash the server
    }
}

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const history = req.body.history || [];
        
        let injectedContext = "";
        const researchTriggers = ['search', 'look up', 'learn', 'research', 'latest', 'news', 'weather'];
        if (researchTriggers.some(t => userMessage.toLowerCase().includes(t))) {
            const researchResults = await performDeepResearch(userMessage);
            if (researchResults) injectedContext = `\n${researchResults}`;
        }

        const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const systemPrompt = `You are Ghost, an elite AI assistant. Time: ${currentTime}. Location: Mangalagiri, India. Keep speech concise.${injectedContext}`;

        // SAFELY clean history to prevent API rejection
        const cleanHistory = history.map(msg => ({
            role: (msg.role === 'system' || msg.role === 'assistant') ? 'assistant' : 'user',
            content: msg.content || "Empty message"
        }));

        const messages = [{ role: "system", content: systemPrompt }, ...cleanHistory, { role: "user", content: userMessage }];

        // 1. GROQ INFERENCE
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama3-70b-8192', messages: messages, max_tokens: 250, temperature: 0.5 })
        });
        
        if (!groqResponse.ok) {
            const errText = await groqResponse.text();
            throw new Error(`GROQ FAILURE: ${groqResponse.status}`);
        }

        const groqData = await groqResponse.json();
        if (!groqData.choices || !groqData.choices[0]) throw new Error("GROQ RETURNED EMPTY BRAIN");
        const ghostText = groqData.choices[0].message.content;

        // 2. ELEVENLABS (With absolute safe catch)
        let audioBase64 = [];
        if (ELEVENLABS_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second max wait

                const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJcg`, {
                    method: 'POST',
                    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: ghostText.replace(/<open:[^>]+>/g, ''),
                        model_id: "eleven_turbo_v2_5",
                        voice_settings: { stability: 0.45, similarity_boost: 0.75 }
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (ttsResponse.ok) {
                    const audioBuffer = await ttsResponse.arrayBuffer();
                    audioBase64.push(Buffer.from(audioBuffer).toString('base64'));
                }
            } catch (err) {
                // Ignore audio failure, we will use Apple Voice
            }
        }

        // Send 200 OK SUCCESS
        res.json({ success: true, text: ghostText, audio_b64: audioBase64 });

    } catch (error) {
        console.error("SERVER CAUGHT FATAL ERROR:", error.message);
        // Send 200 OK but with success: false so the UI knows it's a controlled failure, not a crash
        res.json({ success: false, text: error.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Ghost Network Active'));
