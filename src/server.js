const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

app.get('/ping', (req, res) => res.send('pong'));

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const history = req.body.history || [];
        
        const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const systemPrompt = `You are Ghost, an elite AI assistant created for Manoj. Time: ${currentTime}. Location: Mangalagiri, India. Keep speech highly concise.`;

        // Restoring Ghost's Memory
        const cleanHistory = history.map(msg => ({
            role: (msg.role === 'system' || msg.role === 'assistant') ? 'assistant' : 'user',
            content: msg.content || ""
        }));

        const messages = [
            { role: "system", content: systemPrompt },
            ...cleanHistory,
            { role: "user", content: userMessage }
        ];

        // 1. GROQ INFERENCE (UPDATED TO NEWEST SUPPORTED MODEL)
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: 'llama-3.3-70b-versatile', 
                messages: messages, 
                max_tokens: 250, 
                temperature: 0.5 
            })
        });
        
        if (!groqResponse.ok) {
            const errText = await groqResponse.text();
            throw new Error(`GROQ CRASH: ${groqResponse.status} - ${errText}`);
        }

        const groqData = await groqResponse.json();
        const ghostText = groqData.choices[0].message.content;

        // 2. ELEVENLABS (Safe Catch)
        let audioBase64 = [];
        if (ELEVENLABS_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000); 

                const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJcg`, {
                    method: 'POST',
                    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: ghostText,
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
            } catch (err) { console.error("Audio bypassed."); }
        }

        res.json({ success: true, text: ghostText, audio_b64: audioBase64 });

    } catch (error) {
        console.error("FATAL:", error.message);
        res.json({ success: false, text: error.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Ghost Network Active'));
