const fs=require('fs'); const path=require('path');
const VECTOR_FILE=path.join(__dirname,'memory','vectors.json');
function tokenize(t){ return t.toLowerCase().replace(/[^a-z0-9 ]/g,'').split(/\s+/).filter(Boolean); }
function buildVec(tokens){ const v={}; tokens.forEach(t=>{v[t]=(v[t]||0)+1;}); return v; }
function cosine(a,b){ let dot=0,mA=0,mB=0; const keys=new Set([...Object.keys(a),...Object.keys(b)]); for(const k of keys){const va=a[k]||0,vb=b[k]||0; dot+=va*vb; mA+=va*va; mB+=vb*vb;} return mA&&mB?dot/(Math.sqrt(mA)*Math.sqrt(mB)):0; }
function load(){ try{return JSON.parse(fs.readFileSync(VECTOR_FILE,'utf8'));}catch{return[];} }
function save(s){ fs.mkdirSync(path.dirname(VECTOR_FILE),{recursive:true}); fs.writeFileSync(VECTOR_FILE,JSON.stringify(s)); }
function add(text,metadata={}){ const store=load(); if(store.some(s=>s.text===text))return; store.push({text,vec:buildVec(tokenize(text)),metadata,ts:Date.now()}); save(store.slice(-2000)); }
function search(query,k=5,threshold=0.1){ const store=load(); if(!store.length)return[]; const qvec=buildVec(tokenize(query)); return store.map(item=>({text:item.text,metadata:item.metadata,ts:item.ts,score:cosine(qvec,item.vec)})).filter(i=>i.score>=threshold).sort((a,b)=>b.score-a.score).slice(0,k); }
function count(){ return load().length; }
function clear(){ save([]); }
module.exports={add,search,count,clear};
