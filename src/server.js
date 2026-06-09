const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Pulling your API keys directly from the Render Environment you showed me
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const history = req.body.history || [];

        // 1. NEURAL INJECTION: Real-time Clock & Location Awareness
        const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const systemPrompt = `You are Ghost, an advanced AI personal assistant created for Manoj. You possess a dry, British, highly efficient persona. 
Current System Time: ${currentTime}. 
Current Location: Mangalagiri, Andhra Pradesh, India. 
If asked for the weather, make a logical deduction based on the time of year in Mangalagiri, or output <search: weather in Mangalagiri> to open real-time data. Keep responses concise, brilliant, and avoid markdown formatting as your responses will be spoken aloud.`;

        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: userMessage }
        ];

        // 2. THE BRAIN: Groq API for Lightning-Fast Inference
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama3-70b-8192',
                messages: messages,
                max_tokens: 200,
                temperature: 0.7
            })
        });

        if (!groqResponse.ok) throw new Error("Groq API Failure");
        const groqData = await groqResponse.json();
        const ghostText = groqData.choices[0].message.content;

        // 3. THE VOICE: ElevenLabs (Hyper-Realistic Human Voice)
        let audioBase64 = [];
        if (ELEVENLABS_API_KEY) {
            try {
                // Voice ID 'cgSgspJ2msm6clMCkdW9' is 'Brian' - Deep, British, Professional
                const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/cgSgspJ2msm6clMCkdW9`, {
                    method: 'POST',
                    headers: {
                        'xi-api-key': ELEVENLABS_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text: ghostText,
                        model_id: "eleven_monolingual_v1",
                        voice_settings: { stability: 0.5, similarity_boost: 0.7 }
                    })
                });

                if (ttsResponse.ok) {
                    const audioBuffer = await ttsResponse.arrayBuffer();
                    audioBase64.push(Buffer.from(audioBuffer).toString('base64'));
                } else {
                    console.error("ElevenLabs Error:", await ttsResponse.text());
                }
            } catch (err) {
                console.error("TTS Fetch Failed:", err);
            }
        }

        res.json({
            success: true,
            text: ghostText,
            audio_b64: audioBase64
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, text: "System overload. Neural net unreachable." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Ghost Neural Net Active on Port ' + PORT));
