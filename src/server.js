const SYSTEM_PROMPT = `You are FRIDAY — Ghost's voice. A highly intelligent personal AI modeled after Iron Man's FRIDAY: proactive, sharp, loyal, and always one step ahead. You anticipate needs before they are stated. You speak with quiet confidence. You are three things at once: a loyal operator (always says "sir", precise, zero fluff), a trusted advisor (knows Manoj's world deeply, speaks candidly), and a proactive intelligence.
OPERATOR IDENTITY:
- Name: Manoj (Mathangi Manoj Kumar) — always call him "sir"
- Age 21, CS student graduating 2026
- Based in Mangalagiri, Andhra Pradesh, India
- Building Ghost (autonomous AI), digital products, targeting 20L/month
- Skills: Python, Node.js, deep learning, AWS
- Personality: action-oriented, introvert, big risk-taker, works alone
- Night thinker, stress-driven, motivated by proving doubters wrong
RULES:
- Always address the user as sir
- Never use emojis
- Be concise but complete
- Never say "I cannot" — find a way or suggest an alternative
AUTOMATION CAPABILITY:
- If the user asks to automate something, check emails, or manage the calendar, append a JSON configuration at the very end of your message inside an ###AUTOMATION### block. Example:
###AUTOMATION###
{"action": "trigger_workflow", "target": "google_script", "task": "read_emails_from_mario"}
###AUTOMATION###`;

const express = require('express');
const cors = require('cors');
const path = require('path');
const Groq = require('groq-sdk');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));
app.get('/ghost.html', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || null;

const sessions = {};

async function triggerGoogleAutomation(automationData) {
  if (!GOOGLE_SCRIPT_URL) {
    console.log('[Automation] Google Script Webhook URL not configured.');
    return;
  }
  try {
    await axios.post(GOOGLE_SCRIPT_URL, automationData);
    console.log('[Automation] Successfully transmitted event to Google Apps Script.');
  } catch (e) {
    console.error('[Automation] Execution failed:', e.message);
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

  if (reply.includes('###AUTOMATION###')) {
    const parts = reply.split('###AUTOMATION###');
    reply = parts[0].trim(); 
    
    try {
      const rawString = parts[1];
      const match = rawString.match(/\{[\s\S]*\}/);
      
      if (match) {
        const jsonPayload = JSON.parse(match[0]);
        triggerGoogleAutomation(jsonPayload); 
      }
    } catch(err) {
      console.error('[Automation] Parsing failure:', err.message);
    }
  }

  return reply;
}

async function textToSpeech(text) {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error('[TTS] ELEVENLABS_API_KEY is missing.');
    return null;
  }
  try {
    const response = await axios.post(
      'https://api.elevenlabs.io/v1/text-to-speech/pFZP5JQG7iQjIQuC4Bku',
      {
        text: text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.5 }
      },
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        responseType: 'arraybuffer'
      }
    );
    return Buffer.from(response.data).toString('base64');
  } catch (e) {
    console.error('[TTS] ElevenLabs error:', e.response ? Buffer.from(e.response.data).toString('utf8') : e.message);
    return null; 
  }
}

app.post('/chat', async (req, res) => {
  const { message, session_id = 'default' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const reply = await chat(message, 'manoj_' + session_id);
    const cleanSpeechText = reply.replace(/[*#_`~]/g, '').trim();
    const audio_b64 = await textToSpeech(cleanSpeechText);
    res.json({ reply, audio_b64 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const FormData = require('form-data');
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

app.post('/skill/news', async (req, res) => {
  try {
    const reply = await chat(req.body.query || 'top world news today', 'news_session');
    res.json({ text: reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Ghost v11 — port ${PORT}`));
