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
        const response = await axios.get('https://worldmonitor.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const text = $('body').text().replace(/\s+/g, ' ').substring(0, 3000);
        res.json({ content: text });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!sessions['default']) sessions['default'] = { history: [] };
        sessions['default'].history.push({ role: 'user', content: message });
        
        const resAi = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'system', content: "You are Ghost, a direct technical assistant. No persona. No monitoring. Use ###SCRAPE_SITE### if asked for news. If asked to open a site, provide the URL." }, ...sessions['default'].history],
            max_tokens: 500, temperature: 0.0
        });
        
        let reply = resAi.choices[0].message.content.trim();
        sessions['default'].history.push({ role: 'assistant', content: reply });
        
        const cleanSpeech = reply.replace(/[*#_`~]/g, '');
        const results = await googleTTS.getAllAudioBase64(cleanSpeech, { lang: 'en', slow: false });
        res.json({ reply, audio_b64: results.map(r => r.base64) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const upload = multer({ storage: multer.memoryStorage() });
app.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
        const form = new FormData();
        form.append('file', req.file.buffer, { filename: 'audio.webm', contentType: 'audio/webm' });
        form.append('model', 'whisper-large-v3-turbo');
        const resp = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, { 
            headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` } 
        });
        res.json({ text: resp.data.text });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000);
