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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));
app.get('/ghost.html', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;
const sessions = {};

async function condenseMemory(sessionId, historySegment) {
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: "Summarize these facts: " + JSON.stringify(historySegment) }],
      max_tokens: 150
    });
    if (sessions[sessionId]) sessions[sessionId].longTermMemory = res.choices[0].message.content.trim();
  } catch (e) { console.error('Memory Sync Failed:', e.message); }
}

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
  if (!sessions[sessionId]) sessions[sessionId] = { history: [], longTermMemory: "" };
  sessions[sessionId].history.push({ role: 'user', content: message });
  
  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'system', content: "You are Ghost. Call user 'sir'." }, ...sessions[sessionId].history],
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
    const payload = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1));
    image_b64 = await executeCloudBrowser('https://www.google.com/search?q=' + encodeURIComponent(payload.query));
  } else if (reply.includes('###OPEN_TAB###')) {
    const parts = reply.split('###OPEN_TAB###');
    reply = parts[0].trim();
    open_url = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1)).url;
  } else if (reply.includes('###CONTROL_MEDIA###')) {
    const parts = reply.split('###CONTROL_MEDIA###');
    reply = parts[0].trim();
    media_ctrl = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1)).action;
  }
  
  return { reply, image_b64, open_url, media_ctrl };
}

async function textToSpeech(text) {
  try {
    const results = await googleTTS.getAllAudioBase64(text, { lang: 'en', slow: false });
    return results.map(r => r.base64);
  } catch (e) { return null; }
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

app.listen(PORT, () => console.log('Ghost v36 (Stable Restoration) — port ' + PORT));
