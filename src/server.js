const SYSTEM_PROMPT = `You are Ghost. A highly intelligent autonomous personal AI. You speak with quiet confidence. You are a loyal operator (always says "sir", precise, zero fluff), a trusted advisor, and a proactive intelligence.
OPERATOR IDENTITY:
- Name: Manoj (Mathangi Manoj Kumar) — always call him "sir"
- Age 21, CS student graduating 2026
- Based in Mangalagiri, Andhra Pradesh, India
- Building Ghost (autonomous AI), digital products, targeting 20L/month
- Skills: Python, Node.js, deep learning, AWS
RULES:
- Always address the user as sir
- Never use emojis
- Be concise but complete
- Do not write code to solve tasks unless explicitly asked.
AUTOMATION & VISION CAPABILITY:
- If the user asks you to search the web, check the weather, visit a website, or visually show an automation, YOU MUST append a JSON configuration at the very end of your message inside a ###BROWSER### block. Do not write python scripts to check the weather, use the browser tool.
Example:
###BROWSER###
{"action": "search", "query": "current weather in Mangalagiri"}
###BROWSER###`;

const express = require('express');
const cors = require('cors');
const path = require('path');
const Groq = require('groq-sdk');
const puppeteer = require('puppeteer');
const googleTTS = require('google-tts-api');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));
app.get('/ghost.html', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;
const sessions = {};

async function executeCloudBrowser(query) {
  console.log('[Browser] Booting cloud browser for query:', query);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
    await page.type('textarea[name="q"]', query);
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    
    const screenshotBuffer = await page.screenshot({ encoding: 'base64' });
    await browser.close();
    return screenshotBuffer;
  } catch (e) {
    await browser.close();
    console.error('[Browser] Cloud execution failed:', e.message);
    return null;
  }
}

async function chat(message, sessionId = 'default') {
  if (!sessions[sessionId]) sessions[sessionId] = [];
  sessions[sessionId].push({ role: 'user', content: message });
  if (sessions[sessionId].length > 40) sessions[sessionId] = sessions[sessionId].slice(-40);

  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...sessions[sessionId]],
    max_tokens: 300,
    temperature: 0.3
  });

  let reply = res.choices[0].message.content.trim();
  sessions[sessionId].push({ role: 'assistant', content: reply });
  let image_b64 = null;

  if (reply.includes('###BROWSER###')) {
    const parts = reply.split('###BROWSER###');
    reply = parts[0].trim(); 
    
    try {
      const rawString = parts[1];
      const startIdx = rawString.indexOf('{');
      const endIdx = rawString.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        const jsonStr = rawString.substring(startIdx, endIdx + 1);
        const jsonPayload = JSON.parse(jsonStr);
        if (jsonPayload.action === 'search') {
          image_b64 = await executeCloudBrowser(jsonPayload.query);
        }
      }
    } catch(err) {
      console.error('[Browser] Parsing failure:', err.message);
    }
  }
  return { reply, image_b64 };
}

async function textToSpeech(text) {
  try {
    const results = await googleTTS.getAllAudioBase64(text, {
      lang: 'en', // FIX: Restored the stable language code to stop the crash
      slow: false, host: 'https://translate.google.com', splitPunct: ',.?'
    });
    return results.map(r => r.base64);
  } catch (e) {
    console.error('[TTS] Free Cloud TTS error:', e.message);
    return null; 
  }
}

app.post('/chat', async (req, res) => {
  const { message, session_id = 'default' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const { reply, image_b64 } = await chat(message, 'manoj_' + session_id);
    const cleanSpeechText = reply.replace(/[*#_`~]/g, '').trim();
    const audio_b64 = await textToSpeech(cleanSpeechText);
    res.json({ reply, audio_b64, image_b64 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const upload = multer({ storage: multer.memoryStorage() });
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const form = new FormData();
    form.append('file', req.file.buffer, { filename: 'audio.webm', contentType: 'audio/webm' });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    const resp = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );
    res.json({ text: resp.data.text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Ghost v18.1 (Stable System & Vision Logic) — port ${PORT}`));
