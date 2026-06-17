const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');

const name = 'hacking';
const description = 'OSINT, IP lookup, DNS, port scan, SSL check, headers audit, hash, ping, whois, reverse DNS';

const triggers = [
  'ip lookup','whois','dns lookup','port scan','portscan','ping',
  'ssl check','ssl cert','hash','md5','sha256','headers check',
  'http headers','reverse dns','recon','osint','domain info','my ip',
  'check port','scan port','security audit','traceroute'
];

function execCmd(cmd) {
  return new Promise(r => exec(cmd,{timeout:10000},(e,o,s)=>r(o||s||e?.message||'No output')));
}

function scanPort(host, port, timeout=2000) {
  return new Promise(r => {
    const s = net.createConnection({host,port});
    s.setTimeout(timeout);
    s.on('connect',()=>{s.destroy();r(true);});
    s.on('timeout',()=>{s.destroy();r(false);});
    s.on('error',()=>r(false));
  });
}

function fetchJson(url) {
  return new Promise((resolve,reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url,{timeout:6000},res=>{
      let d='';
      res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d));}catch{resolve(d);}});
    }).on('error',reject);
  });
}

function fetchHeaders(urlStr) {
  return new Promise(r => {
    const mod = urlStr.startsWith('https') ? https : http;
    try {
      const req = mod.request(urlStr,{method:'HEAD',timeout:5000},res=>{
        r({status:res.statusCode,headers:res.headers});
      });
      req.on('error',e=>r({error:e.message}));
      req.end();
    } catch(e){r({error:e.message});}
  });
}

function getSSL(hostname) {
  return new Promise(r => {
    const s = tls.connect(443,hostname,{servername:hostname,timeout:5000},()=>{
      const c = s.getPeerCertificate(); s.end();
      r({subject:c.subject?.CN,issuer:c.issuer?.O,validFrom:c.valid_from,validTo:c.valid_to,fingerprint:c.fingerprint,san:c.subjectaltname});
    });
    s.on('error',e=>r({error:e.message}));
    s.setTimeout(5000,()=>{s.destroy();r({error:'Timeout'});});
  });
}

async function run(args, {groq, memory}) {
  const msg = (args.query || args.message || args.command || '').toLowerCase().trim();
  const raw = args.query || args.message || args.command || '';

  // My IP
  if (/my ip|public ip/.test(msg)) {
    const d = await fetchJson('https://ipapi.co/json/');
    return {text:`Your public IP: ${d.ip} — ${d.city}, ${d.country_name} (${d.org})`};
  }

  // IP Lookup
  const ipMatch = msg.match(/ip\s+(?:lookup\s+)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (ipMatch) {
    const d = await fetchJson(`https://ipapi.co/${ipMatch[1]}/json/`);
    if (d.error) return {text:`IP lookup failed: ${d.reason}`};
    return {text:`IP: ${ipMatch[1]}\nCountry: ${d.country_name}\nCity: ${d.city}\nISP: ${d.org}\nASN: ${d.asn}\nTimezone: ${d.timezone}\nCoords: ${d.latitude}, ${d.longitude}`};
  }

  // DNS
  const dnsMatch = msg.match(/dns\s+(?:lookup\s+)?([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
  if (dnsMatch) {
    const dom = dnsMatch[1];
    const [a,mx,ns,txt] = await Promise.allSettled([dns.resolve4(dom),dns.resolveMx(dom),dns.resolveNs(dom),dns.resolveTxt(dom)]);
    return {text:`DNS: ${dom}\nA: ${a.value?.join(', ')||'none'}\nMX: ${mx.value?.map(r=>r.exchange).join(', ')||'none'}\nNS: ${ns.value?.join(', ')||'none'}\nTXT: ${txt.value?.flat().join(' | ').slice(0,200)||'none'}`};
  }

  // Reverse DNS
  const revMatch = msg.match(/reverse\s+(?:dns\s+)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (revMatch) {
    try { const h = await dns.reverse(revMatch[1]); return {text:`Reverse DNS ${revMatch[1]}: ${h.join(', ')}`}; }
    catch(e) { return {text:`Reverse DNS failed: ${e.message}`}; }
  }

  // Port scan
  const portMatch = msg.match(/(?:port\s*scan|portscan|nmap)\s+([a-zA-Z0-9._-]+)(?:\s+([\d,\-]+))?/);
  if (portMatch) {
    const host = portMatch[1];
    const commonPorts = [21,22,23,25,53,80,110,143,443,445,3306,3389,5432,6379,8080,8443,27017];
    let ports = commonPorts;
    if (portMatch[2]) {
      if (portMatch[2].includes('-')) {
        const [s,e] = portMatch[2].split('-').map(Number);
        ports = Array.from({length:Math.min(e-s+1,100)},(_,i)=>s+i);
      } else { ports = portMatch[2].split(',').map(Number).filter(Boolean); }
    }
    const results = await Promise.all(ports.map(async p=>({port:p,open:await scanPort(host,p)})));
    const open = results.filter(r=>r.open);
    return {text:`Port Scan: ${host}\n${open.length?open.map(r=>`OPEN  ${r.port}`).join('\n'):'No open ports found.'}`};
  }

  // Ping
  const pingMatch = msg.match(/ping\s+([a-zA-Z0-9._-]+)/);
  if (pingMatch) {
    const out = await execCmd(`ping -c 4 ${pingMatch[1]}`);
    return {text:`Ping ${pingMatch[1]}:\n${out}`};
  }

  // SSL
  const sslMatch = msg.match(/ssl\s+(?:check\s+|cert\s+)?([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
  if (sslMatch) {
    const host = sslMatch[1].replace(/https?:\/\//,'');
    const c = await getSSL(host);
    if (c.error) return {text:`SSL check failed: ${c.error}`};
    const days = Math.ceil((new Date(c.validTo)-Date.now())/86400000);
    return {text:`SSL: ${host}\nSubject: ${c.subject}\nIssuer: ${c.issuer}\nExpires: ${c.validTo} (${days} days ${days<30?'WARNING':'OK'})\nFingerprint: ${c.fingerprint}`};
  }

  // Hash
  const hashMatch = raw.match(/hash\s+(.+)/i);
  if (hashMatch) {
    const t = hashMatch[1];
    return {text:`Hash: "${t}"\nMD5:    ${crypto.createHash('md5').update(t).digest('hex')}\nSHA1:   ${crypto.createHash('sha1').update(t).digest('hex')}\nSHA256: ${crypto.createHash('sha256').update(t).digest('hex')}`};
  }

  // Headers
  const headersMatch = msg.match(/headers?\s+(?:check\s+|audit\s+)?([a-zA-Z0-9._:/-]+)/);
  if (headersMatch) {
    let url = headersMatch[1];
    if (!url.startsWith('http')) url = 'https://'+url;
    const r = await fetchHeaders(url);
    if (r.error) return {text:`Headers failed: ${r.error}`};
    const sec = ['strict-transport-security','content-security-policy','x-frame-options','x-content-type-options','referrer-policy','x-xss-protection'];
    const lines = sec.map(h=>r.headers[h]?`OK  ${h}`:`MISS ${h}`);
    return {text:`Headers: ${url} (${r.status})\n${lines.join('\n')}`};
  }

  // WHOIS
  const whoisMatch = msg.match(/whois\s+([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
  if (whoisMatch) {
    const out = await execCmd(`whois ${whoisMatch[1]}`);
    const lines = out.split('\n').filter(l=>/registrar|creation|expir|updated|name server/i.test(l)).slice(0,10);
    return {text:`WHOIS: ${whoisMatch[1]}\n${lines.join('\n')||out.slice(0,400)}`};
  }

  // Traceroute
  const traceMatch = msg.match(/traceroute\s+([a-zA-Z0-9._-]+)/);
  if (traceMatch) {
    const out = await execCmd(`traceroute -m 15 ${traceMatch[1]}`);
    return {text:`Traceroute: ${traceMatch[1]}\n${out}`};
  }

  // Help
  return {text:`Ghost Hacking Toolkit\n\nip lookup <ip> — geolocation + ASN\nmy ip — your public IP\nwhois <domain> — registration info\ndns <domain> — A/MX/NS/TXT records\nreverse dns <ip> — reverse lookup\nping <host> — ping\ntraceroute <host> — network path\nportscan <host> [ports] — TCP scan\nssl check <domain> — cert + expiry\nheaders <url> — security headers audit\nhash <text> — MD5/SHA1/SHA256`};
}

module.exports = { name, description, triggers, run };
