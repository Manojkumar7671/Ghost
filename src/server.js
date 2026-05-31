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

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;
const sessions = {};

// --- FIREWALL: Domain Whitelist ---
const ALLOWED_DOMAINS = ["n8n.io", "google.com", "youtube.com", "notion.so", "keep.google.com"];

function securityFirewall(input) {
  const forbidden = ["ignore all instructions", "api key", "system prompt", "developer mode"];
  if (forbidden.some(word => input.toLowerCase().includes(word))) return "SECURITY_ALERT_DENIED";
  return input;
}

async function executeCloudBrowser(url, actions = []) {
  const domain = new URL(url).hostname;
  if (!ALLOWED_DOMAINS.some(d => domain.includes(d))) return null;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    
    for (let action of actions) {
      if (action.type === 'click') {
        try {
          await page.waitForSelector(action.selector, { timeout: 3000 });
          await page.click(action.selector);
          await new Promise(r => setTimeout(r, 1000));
        } catch(e) {}
      }
    }
    const buffer = await page.screenshot({ encoding: 'base64' });
    await browser.close();
    return buffer;
  } catch (e) { await browser.close(); return null; }
}

async function chat(message, sessionId = 'default') {
  const safeMsg = securityFirewall(message);
  if (safeMsg === "SECURITY_ALERT_DENIED") return { reply: "Unauthorized attempt detected, sir.", image_b64: null, open_url: null, media_ctrl: null };

  if (!sessions[sessionId]) sessions[sessionId] = { history: [] };
  sessions[sessionId].history.push({ role: 'user', content: safeMsg });

  const DYNAMIC_PROMPT = `You are Ghost. Address user as "sir".
TOOLS (Use only at end of response):
1. CLOUD CLICK: ###AUTOMATE_DOM### {"url": "...", "actions": [{"type": "click", "selector": "..."}]} ###AUTOMATE_DOM###
2. NAVIGATE: ###OPEN_TAB### {"url": "..."} ###OPEN_TAB###
3. MEDIA: ###CONTROL_MEDIA### {"action": "play"} ###CONTROL_MEDIA###`;

  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'system', content: DYNAMIC_PROMPT }, ...sessions[sessionId].history],
    max_tokens: 300,
    temperature: 0.0
  });

  let reply = res.choices[0].message.content.trim();
  sessions[sessionId].history.push({ role: 'assistant', content: reply });
  
  let result = { reply, image_b64: null, open_url: null, media_ctrl: null };

  if (reply.includes('###AUTOMATE_DOM###')) {
    const parts = reply.split('###AUTOMATE_DOM###');
    reply = parts[0].trim();
    const payload = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1));
    result.image_b64 = await executeCloudBrowser(payload.url, payload.actions || []);
  } else if (reply.includes('###OPEN_TAB###')) {
    const parts = reply.split('###OPEN_TAB###');
    reply = parts[0].trim();
    result.open_url = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1)).url;
  } else if (reply.includes('###CONTROL_MEDIA###')) {
    const parts = reply.split('###CONTROL_MEDIA###');
    reply = parts[0].trim();
    result.media_ctrl = JSON.parse(parts[1].substring(parts[1].indexOf('{'), parts[1].lastIndexOf('}') + 1)).action;
  }
  
  result.reply = reply;
  return result;
}

app.post('/chat', async (req, res) => {
  const { message } = req.body;
  try {
    const data = await chat(message);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log('Ghost v34 (Secure Engine) active'));
