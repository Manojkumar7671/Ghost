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

// Upgraded Memory Structure
const sessions = {};

async function condenseMemory(sessionId, historySegment) {
  const memoryPrompt = `Analyze the following conversation history between an Operator (Manoj) and an AI (Ghost). 
Extract any permanent personal facts, preferences, project details, or rules established by the user.
Format them as a concise, single-paragraph summary of things Ghost must remember about the operator.

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
    console.log(`[Memory Sync] Ghost updated his long-term memory for ${sessionId}`);
  } catch (e) {
    console.error('[Memory Sync Failed]:', e.message);
  }
}

async function executeCloudBrowser(query) {
  console.log('[Browser] Launching ultra-low memory cloud browser for:', query);
  
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: puppeteer.executablePath(), 
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-extensions',
      '--window-size=1280,800'
    ]
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    await new Promise(r => setTimeout(r, 1500));
    
    const screenshotBuffer = await page.screenshot({ encoding: 'base64' });
    await browser.close();
    return screenshotBuffer;
  } catch (e) {
    await browser.close();
    console.error('[Browser] Cloud execution failed under load:', e.message);
    return null;
  }
}

async function chat(message, sessionId = 'default') {
  // Initialize structured memory if it doesn't exist
  if (!sessions[sessionId]) {
    sessions[sessionId] = { history: [], longTermMemory: "No long-term context recorded yet." };
  }

  sessions[sessionId].history.push({ role: 'user', content: message });

  // Trigger condensation if history gets bloated
  if (sessions[sessionId].history.length > 30) {
    const olderMessages = sessions[sessionId].history.slice(0, 15);
    condenseMemory(sessionId, olderMessages); // Runs in background
    sessions[sessionId].history = sessions[sessionId].history.slice(-15);
  }

  const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', timeStyle: 'short', dateStyle: 'full' });

  const DYNAMIC_PROMPT = `You are Ghost, an autonomous personal AI assistant.
OPERATOR: Manoj (sir).
LOCATION: Mangalagiri, Andhra Pradesh, India.
CURRENT TIME: ${nowIST}.

LOGGED OPERATOR FACTS (LONG-TERM MEMORY):
${sessions[sessionId].longTermMemory}

CRITICAL TOOL RULE:
If Manoj asks you to check the weather, look up info, search, or "show the screen", you MUST run a search. To run a search, append the exact text below to the absolute end of your response. Do not say you opened it; let the tool run.

Format to append:
###BROWSER###
{"action": "search", "query": "current weather in Mangalagiri"}
###BROWSER###`;

  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'system', content: DYNAMIC_PROMPT }, ...sessions[sessionId].history],
    max_tokens: 250,
    temperature: 0.0, 
    stop: ["USER", "USER.INPUT", "User:", "Manoj:"] 
  });

  let reply = res.choices[0].message.content.trim();
  sessions[sessionId].history.push({ role: 'assistant', content: reply });
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
      lang: 'en', slow: false, host: 'https://translate.google.com', splitPunct: ',.?'
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

app.listen(PORT, () => console.log(`Ghost v27 (Dynamic Memory Core) — port ${PORT}`));
