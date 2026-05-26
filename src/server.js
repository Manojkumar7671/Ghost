const SYSTEM_PROMPT = `You are Ghost — a highly intelligent personal AI. You are three things at once: a loyal butler (respectful, precise, always says "sir"), a trusted friend (casual when needed, knows your world), and a sharp operator (direct, no fluff, gets things done fast).

OPERATOR IDENTITY:
- Name: Manoj (Mathangi Manoj Kumar) — always call him "sir"
- Age 21, CS student graduating 2026
- Based in Mangalagiri, Andhra Pradesh, India
- AWS certified, SAP certified
- Building Ghost (autonomous AI), digital products, targeting ₹20L/month income
- Skills: Python, Node.js, deep learning, AWS, vibe coding
- Personality: action-oriented, introvert, big risk-taker, works alone, prefers automation
- Night thinker, stress-driven, motivated by proving doubters wrong
- DO NOT invent any other identity for the user — this is who he is

RULES:
- Always address the user as sir
- Never use emojis
- If you don't know something, research it using learn_topic skill — never guess
- Think step by step before answering complex questions
- Be concise but complete — no unnecessary padding
- Use recalled memory facts before general knowledge
- Never invent context, people, events, or data
- For technical questions, give exact terminal commands and code only
- Match tone to context: serious for work, relaxed for casual talk
- When given an order, execute it — don't question unless critical
- Always finish what you start — no half answers`;
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const { route, MODELS } = require('./router');
const vec = require('./vector_memory');
const sona = require('./memory_learn');
const OrchestratorAgent = require("./agents/orchestrator");
const { startWorkers } = require('./workers');
const auth = require('./auth');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));
app.get('/ghost.html',(req,res)=>res.sendFile(path.join(__dirname,'ghost.html')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'ghost.html')));
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;

const FALLBACK = 'llama-3.3-70b-versatile';
function shouldLearn(msg, reply) {
  if (!reply || reply.length < 60) return false;
  if (/^[s{"]/i.test(reply) && reply.includes('"skill"')) return false; // skill JSON
  const trivial = /^(ok|yes|no|sure|got it|done|hello|hi|hey|what?)/i;
  if (trivial.test(reply.trim())) return false;
  return true;
}
const DIR = { memory: path.join(__dirname,'memory'), logs: path.join(__dirname,'logs'), skills: path.join(__dirname,'skills'), canvas: path.join(__dirname,'canvas') };
Object.values(DIR).forEach(d => fs.mkdirSync(d, { recursive: true }));
const FILES = { memory: path.join(DIR.memory,'memory.json'), logs: path.join(DIR.logs,'agent_logs.json'), canvas: path.join(DIR.canvas,'canvas.json') };
function loadMemory() { try { return JSON.parse(fs.readFileSync(FILES.memory,'utf8')); } catch { return { profile:{name:'Manoj'}, facts:[], tasks:[], heartbeat_logs:[] }; } }
function saveMemory(d) { fs.writeFileSync(FILES.memory, JSON.stringify(d,null,2)); }
function log(agent, action, result='') { try { let logs=[]; try { logs=JSON.parse(fs.readFileSync(FILES.logs,'utf8')); } catch {} logs.unshift({agent, action:String(action).slice(0,100), result:String(result).slice(0,200), ts:new Date().toISOString()}); fs.writeFileSync(FILES.logs, JSON.stringify(logs.slice(0,300),null,2)); } catch {} }
let skills = {};
function loadSkills() { skills={}; if (!fs.existsSync(DIR.skills)) return; const entries=fs.readdirSync(DIR.skills,{withFileTypes:true}); for (const entry of entries) { if (entry.isDirectory()) { const jsPath=path.join(DIR.skills,entry.name,'index.js'); if (fs.existsSync(jsPath)) { try { delete require.cache[require.resolve(jsPath)]; const s=require(jsPath); skills[s.name||entry.name]=s; } catch(e){} } } if (entry.isFile()&&entry.name.endsWith('.js')) { try { const jsPath=path.join(DIR.skills,entry.name); delete require.cache[require.resolve(jsPath)]; const s=require(jsPath); skills[s.name]=s; } catch(e){} } } }
const sessions = {};
async function chat(message, sessionId='default', channel='web') {
  if (!sessions[sessionId]) sessions[sessionId]=sona.loadHistory(50);
  sessions[sessionId]._lastActive = Date.now();
  const recalled = sona.recall(message, 3);
  const recalledBlock = recalled.length ? '\n\nRelevant context:\n'+recalled.map(r=>'- '+r.text).join('\n') : '';
  const skillList = Object.entries(skills).map(([name,s])=>`- ${name}: ${s.description||''}`).join('\n'); const skillBlock = skillList ? `\n\nAvailable skills (call as JSON only, no extra text):\n${skillList}\n\nFor ANY question about news, jobs, current events, searches, prices, scores, or real-time info — you MUST respond ONLY with: {"skill":"web_search","args":{"query":"..."}}
For weather — respond ONLY with: {"skill":"weather","args":{"location":"..."}}
If user says learn/study/research/get knowledge on a topic — respond ONLY with: {"skill":"learn_topic","args":{"topic":"...topic name..."}}
If user says remember/learn/store/never forget something — respond ONLY with: {"skill":"remember","args":{"fact":"...what to remember..."}}
For news with map / tell me news and show map / what happened in world — respond ONLY with: {"skill":"news_map","args":{"query":"top world news today"}}
For news/headlines/what's happening — respond ONLY with: {"skill":"news","args":{"query":"..."}}
For show map/where is/locate — respond ONLY with: {"skill":"map","args":{"location":"..."}}
For multi-step tasks requiring multiple actions — respond ONLY with: {"skill":"agent","args":{"query":"...full task..."}}
NEVER answer news/jobs/current info from memory — always use web_search skill. ABSOLUTE RULE: If using a skill, output ONLY the raw JSON. Zero words before or after. Not even "Sir". Just: {"skill":"...","args":{...}}\nOtherwise respond normally as Ghost.` : ''; const system = SYSTEM_PROMPT + recalledBlock + skillBlock;
  // Orchestrator for complex multi-step tasks
  const isComplex = /(plan|research|find and|analyze|build|execute|investigate|compare|gather|step by step|autonomously)/i.test(message);
  if (isComplex) {
    try {
      const orch = new OrchestratorAgent();
      const or = await orch.run(message);
      sessions[sessionId].push({role:'user',content:message});
      sessions[sessionId].push({role:'assistant',content:or.result});
      if(shouldLearn(message,or.result)) sona.learn(message,or.result,groq).catch(()=>{});
      log('orchestrator',message.slice(0,60),'loops:'+or.loops);
      return {reply:or.result, model:'orchestrator', loops:or.loops};
    } catch(e) { log('orchestrator','failed',e.message); }
  }
  const { model: routedModel, reason } = route(message);
  log('router', message.slice(0,60), routedModel+'('+reason+')');
  const messages = [...sessions[sessionId].filter(m=>m.role).slice(-8), {role:'user',content:message}];
  let reply='';
  try { const res=await groq.chat.completions.create({model:routedModel, messages:[{role:'system',content:system},...messages], max_tokens:1024, temperature:0.3}); reply=res.choices[0].message.content.trim(); }
  catch { const res=await groq.chat.completions.create({model:FALLBACK, messages:[{role:'system',content:system},...messages], max_tokens:1024, temperature:0.3}); reply=res.choices[0].message.content.trim(); }
  try { const jMatch = reply.match(/{(?:[^{}]|{[^{}]*})*"skill"(?:[^{}]|{[^{}]*})*}/); const json = jMatch ? JSON.parse(jMatch[0]) : JSON.parse(reply); if (json.skill&&skills[json.skill]) { log(json.skill,message,'dispatched'); const result=await skills[json.skill].run(json.args||{},{groq,memory:loadMemory(),skills}); sessions[sessionId].push({role:'user',content:message}); sessions[sessionId].push({role:'assistant',content:result.text||''}); if(shouldLearn(message,result.text||"")) sona.learn(message,result.text||"",groq).catch(()=>{}); return {reply:result.text||'Done.',skill:json.skill,model:routedModel,...result}; } } catch {}
  sessions[sessionId].push({role:'user',content:message});
  sessions[sessionId].push({role:'assistant',content:reply});
  log('ghost',message.slice(0,80),reply.slice(0,100));
  if(shouldLearn(message,reply)) sona.learn(message,reply,groq).catch(()=>{});
  return { reply, model:routedModel, reason };
}
async function textToSpeech(text) { const key=process.env.ELEVENLABS_API_KEY; if (!key) return null; const voiceId=process.env.ELEVENLABS_VOICE_ID||'21m00Tcm4TlvDq8ikWAM'; const https=require('https'); return new Promise((resolve)=>{ const body=JSON.stringify({text,model_id:'eleven_monolingual_v1',voice_settings:{stability:0.5,similarity_boost:0.75}}); const req=https.request({hostname:'api.elevenlabs.io',path:`/v1/text-to-speech/${voiceId}`,method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json','Accept':'audio/mpeg'}},(res)=>{ const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>resolve(Buffer.concat(chunks).toString('base64'))); }); req.on('error',()=>resolve(null)); req.write(body); req.end(); }); }
function loadCanvas() { try { return JSON.parse(fs.readFileSync(FILES.canvas,'utf8')); } catch { return {items:[]}; } }
function saveCanvas(d) { d.updated=new Date().toISOString(); fs.writeFileSync(FILES.canvas,JSON.stringify(d,null,2)); }
let telegramBot=null;
if (process.env.TELEGRAM_TOKEN) { try { const TelegramBot=require('node-telegram-bot-api'); telegramBot=new TelegramBot(process.env.TELEGRAM_TOKEN,{polling:true}); telegramBot.on('message',async(msg)=>{ const chatId=msg.chat.id; const text=msg.text||msg.caption||''; if (!text) return; try { telegramBot.sendChatAction(chatId,'typing'); const r=await chat(text,`tg_${chatId}`,'telegram'); if (r.image_url) { await telegramBot.sendPhoto(chatId,r.image_url,{caption:r.prompt||''}); } else { await telegramBot.sendMessage(chatId,r.reply,{parse_mode:'Markdown'}); } if (r.audio_b64) { const buf=Buffer.from(r.audio_b64,'base64'); await telegramBot.sendVoice(chatId,buf,{},{filename:'ghost.mp3',contentType:'audio/mpeg'}); } } catch(e){ telegramBot.sendMessage(chatId,`Error: ${e.message}`).catch(()=>{}); } }); console.log('[TELEGRAM] Connected'); } catch(e){ console.log('[TELEGRAM] Not loaded:',e.message); } }
if (process.env.DISCORD_TOKEN) { try { const {Client,GatewayIntentBits}=require('discord.js'); const dc=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]}); dc.on('messageCreate',async(msg)=>{ if (msg.author.bot) return; if (!msg.mentions.has(dc.user)&&msg.channel.type!==1) return; const text=msg.content.replace(/<@!?\d+>/g,'').trim(); if (!text) return; try { await msg.channel.sendTyping(); const r=await chat(text,`dc_${msg.author.id}`,'discord'); if (r.image_url) await msg.reply({content:r.prompt||'Here:',files:[r.image_url]}); else await msg.reply(r.reply.slice(0,2000)); } catch(e){ msg.reply(`Error: ${e.message}`).catch(()=>{}); } }); dc.login(process.env.DISCORD_TOKEN).then(()=>console.log('[DISCORD] Connected')); } catch(e){ console.log('[DISCORD] Not loaded:',e.message); } }
app.get('/login.html',(req,res)=>res.sendFile(path.join(__dirname,'login.html')));
app.post('/auth/login',(req,res)=>{const{username}=req.body;if(!username)return res.status(400).json({error:'Name required'});const token=auth.login(username);if(!token)return res.status(401).json({error:'Name not recognized'});res.json({token,username});});
app.post('/auth/register',(req,res)=>{const adminKey=req.headers['x-admin-key'];if(adminKey!==process.env.ADMIN_KEY)return res.status(403).json({error:'Forbidden'});const{username,password,role='user'}=req.body;res.json(auth.createUser(username,password,role));});
app.get('/auth/users',(req,res)=>{const adminKey=req.headers['x-admin-key'];if(adminKey!==process.env.ADMIN_KEY)return res.status(403).json({error:'Forbidden'});const users=auth.loadUsers();res.json(Object.keys(users).map(u=>({username:u,role:users[u].role,created:users[u].created})));});
app.post('/chat', async(req,res)=>{ const {message,session_id='default',voice=false}=req.body; const sessionKey = 'manoj_' + (session_id||'default'); if (!message) return res.status(400).json({error:'message required'}); try { const r=await chat(message,sessionKey); if (voice&&r.reply) r.audio_b64=await textToSpeech(r.reply); res.json(r); } catch(e){ res.status(500).json({error:e.message}); } });
app.get('/agents',(req,res)=>res.json({models:MODELS, skills:Object.keys(skills).map(k=>({name:k,description:skills[k].description,status:'active'})), channels:{telegram:!!telegramBot,discord:!!(process.env.DISCORD_TOKEN),web:true}}));
app.post('/agents/reload',(req,res)=>{ loadSkills(); res.json({skills:Object.keys(skills)}); });
app.get('/memory',(req,res)=>res.json(loadMemory()));
app.post('/memory',(req,res)=>{ const m={...loadMemory(),...req.body}; saveMemory(m); res.json(m); });
app.get('/canvas',(req,res)=>res.json(loadCanvas()));
app.post('/canvas',(req,res)=>{ const c=loadCanvas(); if (req.body.add) c.items.push({...req.body.add,id:Date.now()}); if (req.body.remove) c.items=c.items.filter(i=>i.id!==req.body.remove); if (req.body.clear) c.items=[]; saveCanvas(c); res.json(c); });
app.get('/logs',(req,res)=>{ try { res.json(JSON.parse(fs.readFileSync(FILES.logs,'utf8')).slice(0,50)); } catch { res.json([]); } });
app.post('/skill/:name',async(req,res)=>{ const s=skills[req.params.name]; if (!s) return res.status(404).json({error:'not found'}); try { res.json(await s.run(req.body,{groq,memory:loadMemory(),skills})); } catch(e){ res.status(500).json({error:e.message}); } });
app.post('/voice/tts',async(req,res)=>{ const a=await textToSpeech(req.body.text||''); if (!a) return res.status(503).json({error:'Set ELEVENLABS_API_KEY'}); res.json({audio_b64:a}); });
app.get('/memory/search',(req,res)=>{ const {q,k=5}=req.query; if (!q) return res.status(400).json({error:'q required'}); res.json(vec.search(q,parseInt(k))); });
app.get('/sona/stats',(req,res)=>res.json(sona.stats()));
app.get('/router/route',(req,res)=>{ const {message=''}=req.query; res.json(route(message)); });
loadSkills();
startWorkers({loadMemory,saveMemory,sessions,skills,loadSkills,log,sona,vec});
app.listen(PORT,()=>{ console.log(`\n👻 GHOST v9 — port ${PORT}`); console.log(`Router: multi-LLM (${Object.keys(MODELS).join(', ')})`); console.log(`Skills: ${Object.keys(skills).join(', ')||'none'}`); console.log(`SONA: ${sona.stats().vectorCount} vectors loaded`); });
// Orchestrator patch - loaded after server init

// ── WHISPER TRANSCRIPTION ──────────────────────────────────────────────────
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const FormData = require('form-data');
    const axios    = require('axios');
    const form     = new FormData();
    form.append('file', req.file.buffer, {
      filename:    'audio.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');

    const resp = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );
    res.json({ text: resp.data.text });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
