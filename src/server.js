const express = require('express');
const cors = require('cors');
const path = require('path');
const Groq = require('groq-sdk');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const googleTTS = require('google-tts-api');
const cheerio = require('cheerio');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const sessions = {};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));

app.post('/scrape', async (req, res) => {
    try {
        const { url } = req.body;
        const target = url || 'https://worldmonitor.com';
        const response = await axios.get(target, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        
        // FIX: Remove all CSS, Scripts, and Headers before reading
        $('script, style, noscript, iframe, header, footer, nav').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 3000);
        res.json({ content: text });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!sessions['default']) sessions['default'] = { history: [] };
        sessions['default'].history.push({ role: 'user', content: message });
        
        const systemMsg = "You are Ghost, an AI assistant. Direct and concise. If asked for news, summarize it. IF ASKED TO WRITE CODE OR AUTOMATION SCRIPTS: You MUST wrap the code in standard markdown triple backticks (```). Keep your spoken explanations very brief.";
        
        const resAi = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'system', content: systemMsg }, ...sessions['default'].history],
            max_tokens: 800, temperature: 0.0
        });
        
        let reply = resAi.choices[0].message.content.trim();
        sessions['default'].history.push({ role: 'assistant', content: reply });
        
        // FIX: Do not read raw code out loud. Replace it with a verbal notification.
        let speechText = reply.replace(/```[\s\S]*?```/g, " I have compiled the requested code to your data terminal. ").replace(/[*#_`~]/g, '');
        
        const results = await googleTTS.getAllAudioBase64(speechText, { lang: 'en', slow: false });
        res.json({ reply: reply, audio_b64: results.map(r => r.base64) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const upload = multer({ storage: multer.memoryStorage() });
app.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
        const form = new FormData();
        form.append('file', req.file.buffer, { filename: 'audio.webm', contentType: 'audio/webm' });
        form.append('model', 'whisper-large-v3-turbo');
        const resp = await axios.post('[https://api.groq.com/openai/v1/audio/transcriptions](https://api.groq.com/openai/v1/audio/transcriptions)', form, { 
            headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` } 
        });
        res.json({ text: resp.data.text });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log('Server running'));
