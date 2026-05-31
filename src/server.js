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

async function condenseMemory(sessionId, historySegment) {
  const memoryPrompt = `Analyze the following conversation history between an Operator and an AI (Ghost). 
Extract any permanent personal facts, preferences, project details, or rules established by the user.
Format them as a concise summary of things Ghost must remember about the operator.

Conversation to analyze:
${JSON.stringify(historySegment)}`;

  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: memoryPrompt }],
      max_tokens: 150,
      temperature: 0.1
    });
    sessions[sessionId].longTermMemory = res.choices[0].message.content.trim();
  } catch (e) {
    console.error('[Memory Sync Failed]:', e.message);
  }
}

// Upgraded Puppeteer function to handle sequential actions
async function executeCloudBrowser(query, actions = []) {
  console.log('[Browser] Executing DOM automation sequence...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: puppeteer.executablePath(), 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote', '--window-size=1280,800']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    let url = query.startsWith('http') ? query : 'https://www.google.com/search?q=' + encodeURIComponent(query);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Execute dynamic actions requested by Ghost
    for (let action of actions) {
      if (action.type === 'click') {
        try {
          await page.waitForSelector(action.selector, { timeout: 3000 });
          await page.click(action.selector);
          await new Promise(r => setTimeout(r, 1000));
        } catch(e) { console.log('Click failed on:', action.selector) }
      }
      if (action.type === 'type') {
        try {
          await page.waitForSelector(action.selector, { timeout: 3000 });
          await page.type(action.selector, action.text);
        } catch(e) { console.log('Type failed on:', action.selector) }
      }
    }
    
    await new Promise(r => setTimeout(r, 1500));
    const screenshotBuffer = await page.screenshot({ encoding: 'base64' });
    await browser.close();
    return screenshotBuffer;
  } catch (e) {
    await browser.close();
    return null;
  }
}

async function chat(message, sessionId = 'default') {
  if (!sessions[sessionId]) {
    sessions[sessionId] = { history: [], longTermMemory: "No long-term context recorded yet." };
  }

  sessions[sessionId].history.push({ role: 'user', content: message });
  if (sessions[sessionId].history.length > 30) {
    const olderMessages = sessions[sessionId].history.slice(0, 15);
    condenseMemory(sessionId, olderMessages); 
    sessions[sessionId].history = sessions[sessionId].history.slice(-15);
  }

  const DYNAMIC_PROMPT = `You are Ghost, an autonomous personal AI assistant.
OPERATOR: Address the user strictly as "sir". Do not use a name.

CRITICAL TOOL RULES:
You have four distinct tools. Use the EXACT JSON format at the very end of your response to trigger them.

1. CLOUD VISION: Use to check data silently.
Format: ###BROWSER### {"action": "search", "query": "weather"} ###BROWSER###

2. LOCAL NAVIGATION: Use ONLY to open websites on the user's local screen for viewing.
Format: ###OPEN_TAB### {"url": "https://www.youtube.com"} ###OPEN_TAB###

3. AUTONOMOUS ACTION (Execute Webhook): Trigger a pre-built script (n8n, Google Apps).
Format: ###EXECUTE_ACTION### {"target": "n8n_webhook", "payload": "run_workflow_x"} ###EXECUTE_ACTION###

4. DOM AUTOMATION (Cloud Interaction): If the user asks you to "do a task on a website", "click around", or "build an automation on a site", use the AUTOMATE_DOM tool. This launches a cloud browser and executes the actions you define.
Format:
###AUTOMATE_DOM###
{
  "url": "https://n8n.io",
  "actions": [
    {"type": "click", "selector": "a[href='/templates']"}
  ]
}
###AUTOMATE_DOM###`;

  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'system', content: DYNAMIC_PROMPT }, ...sessions[sessionId].history],
    max_tokens: 300,
    temperature: 0.0, 
    stop: ["USER", "USER.INPUT", "User:", "Operator:"] 
  });

  let reply = res.choices[0].message.content.trim();
  sessions[sessionId].history.push({ role: 'assistant', content: reply });
  
  let image_b64 = null;
  let open_url = null;

  try {
    if (reply.includes('###BROWSER###')) {
      const parts = reply.split('###BROWSER###');
      reply = parts[0].trim(); 
      const jsonStr = parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1);
      const payload = JSON.parse(jsonStr);
      if (payload.action === 'search') image_b64 = await executeCloudBrowser(payload.query);
    }
    else if (reply.includes('###OPEN_TAB###')) {
      const parts = reply.split('###OPEN_TAB###');
      reply = parts[0].trim(); 
      const jsonStr = parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1);
      const payload = JSON.parse(jsonStr);
      if (payload.url) open_url = payload.url;
    }
    else if (reply.includes('###AUTOMATE_DOM###')) {
      const parts = reply.split('###AUTOMATE_DOM###');
      reply = parts[0].trim(); 
      const jsonStr = parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1);
      const payload = JSON.parse(jsonStr);
      // Ghost physically acts on the cloud browser and returns the result screenshot
      image_b64 = await executeCloudBrowser(payload.url, payload.actions || []);
    }
  } catch(e) { console.error('Tool Parsing Error:', e.message); }

  return { reply, image_b64, open_url };
}

async function textToSpeech(text) {
  try {
    const results = await googleTTS.getAllAudioBase64(text, { lang: 'en', slow: false, host: 'https://translate.google.com', splitPunct: ',.?' });
    return results.map(r => r.base64);
  } catch (e) { return null; }
}

app.post('/chat', async (req, res) => {
  const { message, session_id = 'default' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const { reply, image_b64, open_url } = await chat(message, 'operator_' + session_id);
    const cleanSpeechText = reply.replace(/[*#_`~]/g, '').trim();
    const audio_b64 = await textToSpeech(cleanSpeechText);
    res.json({ reply, audio_b64, image_b64, open_url });
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
    const resp = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` } });
    res.json({ text: resp.data.text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Ghost v32 (DOM Automation & Autonomy) — port ${PORT}`));
