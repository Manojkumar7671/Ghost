const path = require('path');
const fs = require('fs');
const path = require('path');
const fs = require('fs');
const fs=require('fs'); const path=require('path');
const MIN=60*1000, HR=60*MIN;
function startWorkers({loadMemory,saveMemory,sessions,skills,loadSkills,log,sona,vec}){
const workers=[
{name:'heartbeat',interval:5*MIN,fn:()=>{log('worker:heartbeat','ping','alive');}},
{name:'session_cleanup',interval:30*MIN,fn:()=>{ const cutoff=Date.now()-2*HR; let pruned=0; for(const id of Object.keys(sessions)){if(id==='default')continue; if(!sessions[id]._lastActive||sessions[id]._lastActive<cutoff){delete sessions[id];pruned++;}} if(pruned)log('worker:session_cleanup',`pruned ${pruned} sessions`); }},
{name:'log_rotate',interval:6*HR,fn:()=>{ const f=path.join(__dirname,'logs','agent_logs.json'); try{let logs=JSON.parse(fs.readFileSync(f,'utf8')); if(logs.length>300){fs.writeFileSync(f,JSON.stringify(logs.slice(0,300),null,2));log('worker:log_rotate','trimmed to 300');}}catch{} }},
{name:'memory_backup',interval:12*HR,fn:()=>{ try{const src=path.join(__dirname,'memory','memory.json'),dest=path.join(__dirname,'memory','memory.bak.json'); if(fs.existsSync(src)){fs.copyFileSync(src,dest);log('worker:memory_backup','backed up');}}catch{} }},
{name:'skill_health',interval:15*MIN,fn:()=>{log('worker:skill_health',`${Object.keys(skills).length} skills active`);}},
{name:'skill_reload',interval:1*HR,fn:()=>{loadSkills();log('worker:skill_reload','reloaded',Object.keys(skills).join(','));}},
{name:'sona_stats',interval:2*HR,fn:()=>{ if(sona){const s=sona.stats();log('worker:sona_stats',`facts:${s.facts} vectors:${s.vectorCount} learns:${s.learnCount}`);} }},
{name:'vec_optimize',interval:4*HR,fn:()=>{ if(vec)log('worker:vec_optimize',`vector store size: ${vec.count()}`); }},
{name:'sona_dedup',interval:3*HR,fn:()=>{ const f=path.join(__dirname,'memory','sona.json'); try{const d=JSON.parse(fs.readFileSync(f,'utf8')); const before=d.facts.length; d.facts=[...new Set(d.facts)]; fs.writeFileSync(f,JSON.stringify(d,null,2)); if(d.facts.length<before)log('worker:sona_dedup',`removed ${before-d.facts.length} dupes`);}catch{} }},
{name:'memory_sync',interval:1*HR,fn:()=>{ const mem=loadMemory(); if(!mem.profile)mem.profile={name:'Manoj'}; if(!mem.facts)mem.facts=[]; if(!mem.tasks)mem.tasks=[]; saveMemory(mem); }},
{name:'uptime',interval:10*MIN,fn:()=>{log('worker:uptime',`${Math.round(process.uptime()/60)} min`);}},
{name:'daily_digest',interval:24*HR,fn:()=>{ try{const d=JSON.parse(fs.readFileSync(path.join(__dirname,'memory','sona.json'),'utf8')); log('worker:daily_digest','recent_facts',d.facts.slice(-10).join('; ').slice(0,200));}catch{} }},
];
workers.forEach(w=>{ setInterval(()=>{try{w.fn();}catch{}},w.interval); console.log(`[WORKER] ${w.name}`); });
console.log(`[WORKERS] ${workers.length} running`);
}
module.exports={startWorkers};
