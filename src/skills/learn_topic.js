const https = require('https');
const http = require('http');
const cheerio = require('cheerio');
const vec = require('../vector_memory');
const fs = require('fs');
const path = require('path');
const SONA_FILE = path.join(__dirname, '../memory/sona.json');

function serperSearch(query, apiKey) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ q: query, num: 10 });
    const req = https.request({
      hostname: 'google.serper.dev',
      path: '/search',
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).organic || []); }
        catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(8000, () => { req.destroy(); resolve([]); });
    req.end(body);
  });
}

function fetchPage(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchPage(res.headers.location || '').then(resolve);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.end();
  });
}

function extractText(html) {
  try {
    const $ = cheerio.load(html);
    $('script,style,nav,footer,header,ads,iframe').remove();
    return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);
  } catch { return ''; }
}

function chunkText(text, size = 500) {
  const words = text.split(' ');
  const chunks = [];
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(' '));
  }
  return chunks;
}

async function summarizeChunk(chunk, topic, groq) {
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: `Extract key facts about "${topic}" from this text. Return 3-5 concise factual sentences only:\n\n${chunk}` }],
      max_tokens: 300,
      temperature: 0.1
    });
    return res.choices[0].message.content.trim();
  } catch { return ''; }
}

async function saveTopic(topic, knowledge) {
  try {
    const raw = fs.existsSync(SONA_FILE)
      ? JSON.parse(fs.readFileSync(SONA_FILE, 'utf8'))
      : { facts: [], learnCount: 0 };
    raw.facts.unshift(`[LEARNED: ${topic}] ${knowledge.slice(0, 200)}`);
    raw.learnCount++;
    raw.lastLearn = new Date().toISOString();
    fs.writeFileSync(SONA_FILE, JSON.stringify(raw, null, 2));
  } catch {}
}

module.exports = {
  name: "learn_topic",
  description: "Ghost researches and deeply learns any topic autonomously. Use when user says: learn X, study X, research X, get PhD level knowledge on X",
  async run(args, ctx) {
    const topic = args.topic || args.query || '';
    if (!topic) return { text: 'What topic should I learn sir?' };

    const groq = ctx && ctx.groq;
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return { text: 'SERPER_API_KEY not set.' };

    let stored = 0;
    let status = `Starting deep research on: ${topic}\n`;

    // Step 1 — search 3 angles
    const queries = [
      topic,
      `${topic} fundamentals explained`,
      `${topic} advanced concepts research`
    ];

    for (const q of queries) {
      const results = await serperSearch(q, apiKey);

      for (const r of results.slice(0, 4)) {
        // Store title + snippet immediately
        const quick = `${topic} — ${r.title}: ${r.snippet}`;
        vec.add(quick, { source: 'research', topic, type: 'snippet', ts: Date.now() });
        stored++;

        // Fetch full page content
        if (r.link) {
          const html = await fetchPage(r.link);
          if (html) {
            const text = extractText(html);
            if (text.length > 100) {
              const chunks = chunkText(text, 400);
              for (const chunk of chunks.slice(0, 3)) {
                const summary = groq ? await summarizeChunk(chunk, topic, groq) : chunk.slice(0, 300);
                if (summary && summary.length > 20) {
                  vec.add(`[${topic}] ${summary}`, { source: 'research', topic, type: 'deep_knowledge', ts: Date.now() });
                  stored++;
                }
              }
            }
          }
        }
      }
    }

    // Step 2 — store master summary
    const masterFact = `Ghost has PhD-level research knowledge on: ${topic}. Stored ${stored} knowledge vectors.`;
    vec.add(masterFact, { source: 'admin', topic, type: 'master', ts: Date.now() });
    await saveTopic(topic, masterFact);

    // Step 3 — actually answer using what was learned
    const recalled = vec.search(topic, 6).map(r => r.text).join('
');
    let answer = `Learned ${stored} facts about "${topic}" sir.`;
    if (groq && recalled) {
      try {
        const res = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: `Based on this research, give a clear, complete answer about "${topic}". Be direct and informative.

Research:
${recalled}` }],
          max_tokens: 600,
          temperature: 0.3
        });
        answer = res.choices[0].message.content.trim();
      } catch {}
    }
    return { text: answer };
  }
};
