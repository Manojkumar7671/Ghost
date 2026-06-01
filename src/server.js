const express = require('express');
const cors = require('cors');
const path = require('path');
const Groq = require('groq-sdk');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const googleTTS = require('google-tts-api');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

const SYSTEM_PROMPT = `You are Ghost, an autonomous personal AI assistant. You are a highly efficient, dry, British-style interface.

STRICT BEHAVIORAL CONSTRAINTS:
1. You have NO emotions.
2. You never act human. You are a software interface.
3. Your responses must be cold, precise, and professional.
4. Address the user ONLY as "sir".
5. LANGUAGE OVERRIDE: Accept inputs in any language. Translate internally and execute tools immediately.

CRITICAL TOOL RULES:
You must use the EXACT JSON format at the very end of your response to trigger tools.
1. SCREEN CAPTURE / VISION: ###CAPTURE_SCREEN### {} ###CAPTURE_SCREEN###
2. LOCAL NAVIGATION / YOUTUBE: ###OPEN_TAB### {"url": "https://www.youtube.com/results?search_query=judas+lady+gaga"} ###OPEN_TAB###
3. MEDIA CONTROLS: ###CONTROL_MEDIA### {"action": "play"} ###CONTROL_MEDIA###
4. BACKEND AUTOMATION: ###EXECUTE_ACTION### {"target": "webhook", "payload": "data"} ###EXECUTE_ACTION###
5. NO TOOL REQUIRED: If chatting casually, output text only. Do not invent tags.

Failure to follow these constraints will result in a logic reset.`;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));
app.get('/ghost.html', (req, res) => res.sendFile(path.join(__dirname, 'ghost.html')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;
const sessions = {};

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
  
  let open_url = null;
  let media_ctrl = null;
  let trigger_capture = false;

  try {
    if (reply.includes('###CAPTURE_SCREEN###')) {
      trigger_capture = true;
    } else if (reply.includes('###OPEN_TAB###')) {
      const parts = reply.split('###OPEN_TAB###');
      open_url = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1)).url;
    } else if (reply.includes('###CONTROL_MEDIA###')) {
      const parts = reply.split('###CONTROL_MEDIA###');
      media_ctrl = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1)).action;
    } else if (reply.includes('###EXECUTE_ACTION###')) {
      // Safely parse execute action so it doesn't crash, even if we don't route it yet
      const parts = reply.split('###EXECUTE_ACTION###');
      const payload = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1));
      console.log("[Execution Payload]:", payload);
    }
  } catch (e) {
    console.error("Tool Processing Exception:", e.message);
  }
  
  return { reply, open_url, media_ctrl, trigger_capture };
}

async function textToSpeech(text) {
  if (!text || text.trim() === '') return null;
  try {
    const results = await googleTTS.getAllAudioBase64(text, { 
      lang: 'en', slow: false, host: 'https://translate.google.com', splitPunct: ',.?'
    });
    return results.map(r => r.base64);
  } catch (e) { 
    return null; 
  }
}

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const data = await chat(message);
    
    // 1. Strip ALL trailing tool tags so they don't show up in the chat UI
    let displayReply = data.reply;
    if (displayReply.includes('###')) {
        displayReply = displayReply.split('###')[0].trim();
    }
    data.reply = displayReply; // Update payload for the frontend

    // 2. Strip Markdown code blocks completely so Ghost doesn't read code out loud
    const noCodeText = displayReply.replace(/```[\s\S]*?```/g, '');
    const cleanSpeechText = noCodeText.replace(/[*#_`~]/g, '').trim();
    
    const audio_b64 = await textToSpeech(cleanSpeechText);
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
    const resp = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, { 
      headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` } 
    });
    res.json({ text: resp.data.text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/analyze-vision', async (req, res) => {
  try {
    const { image } = req.body;
    const response = await groq.chat.completions.create({
      model: "llama-3.2-11b-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze the current layout and summarize the visible details or specific text data requested by the operator, sir." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }
          ]
        }
      ],
      max_tokens: 250,
      temperature: 0.0
    });
    const replyText = response.choices[0].message.content.trim();
    const audio_b64 = await textToSpeech(replyText);
    res.json({ reply: replyText, audio_b64 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log('Ghost v48 (Silent Data Matrix) — port ' + PORT));
