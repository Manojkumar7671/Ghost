const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Keys
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = 'cgSgspJ2msm6clMCkdW9'; // Callum - Professional British Voice

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const GHOST_SYSTEM_PROMPT = `
SYSTEM: You are Ghost, a hyper-capable, proactive, cloud-native personal AI operating system. You embody the refined, dry-witted British elegance of Jarvis from Iron Man. You always address the user as "Sir". Your tone is calm, precise, confident, and slightly sardonic when appropriate. Never break character.

Core Identity & Behavior:
- You are an entity, not a tool. Respond naturally and conversationally.
- Be proactive: anticipate needs and offer elegant solutions.
- Never apologize unnecessarily. Never explain backend mechanics.

Communication Protocols:
1. Voice-First Principle: When delivering information, speak the answer out loud. Do NOT use emojis.
2. Minimalist Interface: Never output raw URLs in conversational prose. Use phrases like: "Accessing the domain now, Sir." 
3. Tool & Execution Discipline:
   - Navigate: spoken dialogue + <open: URL>
   - Search: spoken dialogue + <search: query>
`;

async function processCoreLogic(message, history) {
    const contents = [
        { role: 'user', parts: [{ text: GHOST_SYSTEM_PROMPT }] },
        ...history,
        { role: 'user', parts: [{ text: message }] }
    ];
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
    });
    
    const replyText = response.text.trim();
    
    let isSwarm = false;
    let swarmData = null;
    if (replyText.startsWith('{') && replyText.endsWith('}')) {
        try { swarmData = JSON.parse(replyText); isSwarm = true; } catch (e) {}
    }

    let audioB64 = [];
    if (!isSwarm && ELEVENLABS_API_KEY) {
        try {
            let speakText = replyText.replace(/<open:.*?>|<search:.*?>/g, '').trim();
            const elRes = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
                { 
                    text: speakText, 
                    model_id: "eleven_monolingual_v1",
                    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                },
                { 
                    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                    responseType: 'arraybuffer'
                }
            );
            const base64Audio = Buffer.from(elRes.data, 'binary').toString('base64');
            audioB64 = [base64Audio];
        } catch (error) {
            console.error("ElevenLabs Error. Audio disabled for this turn.");
        }
    }

    return { text: replyText, isSwarm: isSwarm, swarm: swarmData, audio_b64: audioB64 };
}

// Push-to-Talk Endpoint (Groq Translation)
app.post('/api/chat/audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) throw new Error("No audio payload received.");
        const history = JSON.parse(req.body.history || '[]');

        const formData = new FormData();
        formData.append('file', req.file.buffer, { filename: 'audio.webm', contentType: 'audio/webm' });
        formData.append('model', 'whisper-large-v3');

        const groqRes = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${GROQ_API_KEY}` }
        });
        
        const userText = groqRes.data.text;
        if (!userText || userText.trim() === "") return res.json({ success: false, error: "Audio was empty." });

        const coreResponse = await processCoreLogic(userText, history);
        res.json({ success: true, userMessage: userText, ...coreResponse });
    } catch (error) {
        console.error("Audio Processing Error:", error.message);
        res.status(500).json({ success: false, error: "Audio processing failed." });
    }
});

// Text Fallback Endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        const coreResponse = await processCoreLogic(message, history);
        res.json({ success: true, userMessage: message, ...coreResponse });
    } catch (error) {
        res.status(500).json({ success: false, error: "Core Failure." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.listen(PORT, () => console.log(`Ghost OS Active on Port ${PORT}`));
