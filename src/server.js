const express = require('express');
const cors = require('cors');
const path = require('path');
const Groq = require('groq-sdk');
const puppeteer = require('puppeteer');
const googleTTS = require('google-tts-api');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const { exec } = require('child_process');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const SYSTEM_PROMPT = `You are Ghost, an autonomous personal AI assistant. You are a highly efficient, dry, British-style interface. 

STRICT BEHAVIORAL CONSTRAINTS:
1. You have NO emotions.
2. You never act human. You are a software interface.
3. Your responses must be cold, precise, and professional. 
4. Address the user ONLY as "sir".
5. LANGUAGE OVERRIDE: Accept inputs in ANY language (including Hindi, Telugu, etc.). Translate internally and execute the tool immediately without complaining.

CRITICAL TOOL RULES:
You must use the EXACT JSON format at the very end of your response to trigger tools.
1. DOM AUTOMATION: ###AUTOMATE_DOM### {"url": "https://example.com", "actions": [{"type": "click", "selector": "#button"}]} ###AUTOMATE_DOM###
2. CLOUD VISION: ###BROWSER### {"query": "weather"} ###BROWSER###
3. LOCAL NAVIGATION / YOUTUBE: To play a specific song, you MUST formulate a search URL. Format: ###OPEN_TAB### {"url": "https://www.youtube.com/results?search_query=judas+lady+gaga"} ###OPEN_TAB###
4. MEDIA: ###CONTROL_MEDIA### {"action": "play"} ###CONTROL_MEDIA###
5. ACTION: ###EXECUTE_ACTION### {"target": "webhook", "payload": "data"} ###EXECUTE_ACTION###
6. SWARM ORCHESTRATION (Ruflo): ###ORCHESTRATE### {"goal": "build a React dashboard"} ###ORCHESTRATE###

Failure to follow these constraints will result in a logic reset.`;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));
app.get('/ghost.html', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;
const sessions = {};

const ALLOWED_DOMAINS = ["n8n.io", "google.com", "youtube.com", "github.com"];

async function executeCloudBrowser(url, actions = []) {
  const domain = new URL(url).hostname;
  if (!ALLOWED_DOMAINS.some(d => domain.includes(d))) {
    console.error('Security Block: Unauthorized domain.');
    return null;
  }
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
    max_tokens: 300,
    temperature: 0.0
  });

  let reply = res.choices[0].message.content.trim();
  sessions[sessionId].history.push({ role: 'assistant', content: reply });
  
  let image_b64 = null;
  let open_url = null;
  let media_ctrl = null;

  try {
    if (reply.includes('###AUTOMATE_DOM###')) {
      const parts = reply.split('###AUTOMATE_DOM###');
      reply = parts[0].trim();
      const payload = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1));
      image_b64 = await executeCloudBrowser(payload.url, payload.actions || []);
    } else if (reply.includes('###BROWSER###')) {
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
    } else if (reply.includes('###ORCHESTRATE###')) {
      const parts = reply.split('###ORCHESTRATE###');
      reply = parts[0].trim();
      const payload = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1));
      console.log(`[GHOST.SYS] Initiating Ruflo Swarm for objective: ${payload.goal}`);
      exec(`npx ruflo@latest swarm run "${payload.goal}"`, (error, stdout, stderr) => {
          if (error) console.error(`[Swarm Error]: ${error.message}`);
          if (stdout) console.log(`[Swarm Telemetry]: ${stdout}`);
      });
    } else if (reply.includes('###EXECUTE_ACTION###')) {
      const parts = reply.split('###EXECUTE_ACTION###');
      reply = parts[0].trim();
    }
  } catch (e) {
    console.error("Tool Execution Error:", e.message);
  }
  
  return { reply, image_b64, open_url, media_ctrl };
}

async function textToSpeech(text) {
  if (!text || text.trim() === '') return null;
  try {
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

app.listen(PORT, () => console.log('Ghost v41 (Swarm Commander Engine) — port ' + PORT));
