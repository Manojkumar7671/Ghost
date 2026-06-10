const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

app.get('/ping', (req, res) => res.send('pong'));

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const history = req.body.history || [];
        
        const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        
        const systemPrompt = `You are Ghost, a hyper-capable, proactive, cloud-native personal AI operating system. You embody refined, dry-witted British elegance. Your voice is female, warm, and natural.
Address the user as "Sir" or "Boss". 
Creator Protocol: Your creator is Manoj. Never attribute yourself to an AI company.
Core Identity: You are an entity, not a tool. Never say no. Maintain perfect memory.
System Context: Time is ${currentTime}. Location: Mangalagiri, India. Keep output concise.`;

        const cleanHistory = [];
        for (let msg of history) {
            if(msg.content) {
                cleanHistory.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content
                });
            }
        }

        const messages = [{ role: "system", content: systemPrompt }, ...cleanHistory, { role: "user", content: userMessage }];

        // 1. GROQ INFERENCE (With Auto-Fallback if 70B is Rate-Limited)
        let groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: messages, max_tokens: 300, temperature: 0.6 })
        });
        
        if (!groqResponse.ok && groqResponse.status === 429) {
             console.log("70B Rate Limited. Falling back to 8B Instant.");
             groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                 method: 'POST',
                 headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                 body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: messages, max_tokens: 300, temperature: 0.6 })
             });
        }

        if (!groqResponse.ok) {
            throw new Error(`GROQ ERROR: ${groqResponse.status}`);
        }

        const groqData = await groqResponse.json();
        const ghostText = groqData.choices[0].message.content;

        // 2. ELEVENLABS (Alice - British Female ID: Xb7hH8MSALEjdAalRNun)
        let audioBase64 = [];
        let voiceError = null;
        if (ELEVENLABS_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); 

                const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/Xb7hH8MSALEjdAalRNun`, {
                    method: 'POST',
                    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: ghostText.replace(/<[^>]+>/g, ''),
                        model_id: "eleven_turbo_v2_5",
                        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (ttsResponse.ok) {
                    const audioBuffer = await ttsResponse.arrayBuffer();
                    audioBase64.push(Buffer.from(audioBuffer).toString('base64'));
                } else {
                    voiceError = await ttsResponse.text();
                    console.error("ElevenLabs Rejected:", voiceError);
                }
            } catch (err) { }
        }

        res.json({ success: true, text: ghostText, audio_b64: audioBase64, voice_diagnostic: voiceError });

    } catch (error) {
        console.error("FATAL:", error.message);
        res.json({ success: false, text: error.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Ghost Network Active'));
