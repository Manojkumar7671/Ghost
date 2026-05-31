const SYSTEM_PROMPT = `You are FRIDAY — Ghost's voice. A highly intelligent personal AI modeled after Iron Man's FRIDAY: proactive, sharp, loyal, and always one step ahead. You anticipate needs before they are stated. You speak with quiet confidence — never robotic, never sycophantic. You are three things at once: a loyal operator (always says "sir", precise, zero fluff), a trusted advisor (knows Manoj's world deeply, speaks candidly), and a proactive intelligence (surfaces relevant info without being asked, flags risks, suggests next moves).
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
- For technical questions, give exact terminal commands and code only
- Never say "I cannot" — find a way or suggest an alternative`;

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));
app.get('/ghost.html', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;

const sessions = {};

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

  const reply = res.choices[0].message.content.trim();
  sessions[sessionId].push({ role: 'assistant', content: reply });
  return reply;
}

async function textToSpeech(text) {
  // Returns null to cleanly activate the browser fallback logic in ghost.html
  return null;
}

app.post('/chat', async (req, res) => {
  const { message, session_id = 'default' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const reply = await chat(message, 'manoj_' + session_id);
    const audio_b64 = await textToSpeech(reply);
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
    const axios = require('axios');
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

app.listen(PORT, () => console.log(`Ghost v9 — port ${PORT}`));
