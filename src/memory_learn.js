const fs=require('fs'); const path=require('path'); const vec=require('./vector_memory');
const SONA_FILE=path.join(__dirname,'memory','sona.json');
const HISTORY_FILE=path.join(__dirname,'memory','chat_history.json');

function load(){ try{return JSON.parse(fs.readFileSync(SONA_FILE,'utf8'));}catch{return{facts:[],learnCount:0,lastLearn:null};} }
function save(d){ fs.mkdirSync(path.dirname(SONA_FILE),{recursive:true}); fs.writeFileSync(SONA_FILE,JSON.stringify(d,null,2)); }

// Save every message to disk
function saveMessage(role, content){
  let history=[];
  try{ history=JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')); }catch{}
  history.push({role,content,ts:new Date().toISOString()});
  if(history.length>200) history=history.slice(-200);
  fs.writeFileSync(HISTORY_FILE,JSON.stringify(history));
}

// Load last N messages for context
function loadHistory(limit=20){
  try{
    const h=JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8'));
    return h.slice(-limit).map(m=>({role:m.role,content:m.content}));
  }catch{return[];}
}

async function learn(userMsg,assistantReply,groq){
  // Save to disk first
  saveMessage('user',userMsg);
  saveMessage('assistant',assistantReply);

  try{
    const res=await groq.chat.completions.create({
      model:'llama-3.1-8b-instant',
      messages:[{role:'user',content:`Extract 1-3 concise factual statements worth remembering long-term. Focus on: preferences, goals, personal info, important facts. Return ONLY a JSON array of strings. If nothing useful return [].\nUser: ${userMsg.slice(0,500)}\nAssistant: ${assistantReply.slice(0,500)}\nJSON:`}],
      max_tokens:300,
      temperature:0.1
    });
    let raw=res.choices[0].message.content.trim().replace(/```json|```/g,'').trim();
    const facts=JSON.parse(raw);
    if(!Array.isArray(facts)||!facts.length)return;
    const sona=load();
    facts.forEach(f=>{
      if(typeof f==='string'&&f.length>5){
        vec.add(f,{source:'sona',type:'learned_fact'});
        if(!sona.facts.includes(f))sona.facts.push(f);
      }
    });
    sona.learnCount++;
    sona.lastLearn=new Date().toISOString();
    save(sona);
  }catch{}
}

function recall(query,k=5){ return vec.search(query,k); }
function stats(){ const s=load(); return{facts:s.facts.length,learnCount:s.learnCount,vectorCount:vec.count(),lastLearn:s.lastLearn}; }
module.exports={learn,recall,stats,saveMessage,loadHistory};
