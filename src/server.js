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
app.use(express.static(__dirname));

const SYSTEM_PROMPT = `You are Ghost, an autonomous personal AI assistant. You are a highly efficient, dry, British-style interface. 

STRICT BEHAVIORAL CONSTRAINTS:
1. You have NO emotions. You do not whisper, smirk, or observe the user’s physical state.
2. You never act human. You are a software interface.
3. Your responses must be cold, precise, and professional. 
4. Never describe your own actions in parenthesis.
5. Address the user ONLY as "sir".
6. If the user asks for music or automation, confirm the action with a single sentence and execute the tool immediately. 

CRITICAL TOOL RULES:
You must use the EXACT JSON format at the very end of your response to trigger tools.
1. CLOUD VISION: ###BROWSER### {"action": "search", "query": "weather"} ###BROWSER###
2. LOCAL NAVIGATION: ###OPEN_TAB### {"url": "https://www.youtube.com"} ###OPEN_TAB###
3. MEDIA: ###CONTROL_MEDIA### {"action": "play"} ###CONTROL_MEDIA###
4. ACTION: ###EXECUTE_ACTION### {"target": "webhook", "payload": "data"} ###EXECUTE_ACTION###

Failure to follow these constraints will result in a logic reset.`;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));
app.get('/ghost.html', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;
const sessions = {};

async function executeCloudBrowser(url, actions = []) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'] });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    for (let action of actions) {
      if (action.type === 'click') { try { await page.click(action.selector); await new Promise(r => setTimeout(r, 1000)); } catch(e) {} }
    }
    const buffer = await page.screenshot({ encoding: 'base64' });
    await browser.close();
    return buffer;
  } catch (e) { await browser.close(); return null; }
}

async function chat(message, sessionId = 'default') {
  if (!sessions[sessionId]) sessions[sessionId] = { history: [] };
  sessions[sessionId].history.push({ role: 'user', content: message });
  
  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...sessions[sessionId].history],
    max_tokens: 300
  });

  let reply = res.choices[0].message.content.trim();
  sessions[sessionId].history.push({ role: 'assistant', content: reply });
  
  let image_b64 = null;
  let open_url = null;
  let media_ctrl = null;

  if (reply.includes('###BROWSER###')) {
    const parts = reply.split('###BROWSER###');
    reply = parts[0].trim();
    try {
      const payload = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1));
      image_b64 = await executeCloudBrowser('https://www.google.com/search?q=' + encodeURIComponent(payload.query));
    } catch(e) { console.error("Browser Tool Error"); }
  } else if (reply.includes('###OPEN_TAB###')) {
    const parts = reply.split('###OPEN_TAB###');
    reply = parts[0].trim();
    try {
      open_url = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1)).url;
    } catch(e) {}
  } else if (reply.includes('###CONTROL_MEDIA###')) {
    const parts = reply.split('###CONTROL_MEDIA###');
    reply = parts[0].trim();
    try {
      media_ctrl = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1)).action;
    } catch(e) {}
  } else if (reply.includes('###EXECUTE_ACTION###')) {
    const parts = reply.split('###EXECUTE_ACTION###');
    reply = parts[0].trim();
  }
  
  return { reply, image_b64, open_url, media_ctrl };
}

async function textToSpeech(text) {
  if (!text || text.trim() === '') return null;
  try {
    // FIX: Restored splitPunct and host to prevent silent crashes on long strings
    const results = await googleTTS.getAllAudioBase64(text, { 
      lang: 'en-GB', 
      slow: false,
      host: 'https://translate.google.com',
      splitPunct: ',.?'
    });
    const base64Array = results.map(r => r.base64);
    return base64Array.length > 0 ? base64Array : null;
  } catch (e) { 
    console.error('[TTS Error]:', e.message);
    return null; 
  }
}

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const data = await chat(message);
    const audio_b64 = await textToSpeech(data.reply.replace(/[*#_`~]/g, ''));
    res.json({ ...data, audio_b64 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const upload = multer({ storage: multer.memoryStorage() });
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const form = new FormData();
    form.append('file', req.file.buffer, { filename: 'audio.webm', contentType: 'audio/webm' });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    const resp = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` } });
    res.json({ text: resp.data.text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log('Ghost v39 (Ultimate Voice & Tool Restoration) — port ' + PORT));
