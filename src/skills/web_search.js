const https = require('https');
const http = require('http');

const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://search.bus-hit.me',
  'https://searxng.site',
];

async function fetchResults(query) {
  // Try local first
  const local = await new Promise((resolve) => {
    const path = `/search?q=${encodeURIComponent(query)}&format=json`;
    http.get({ hostname: 'localhost', port: 8080, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).results || []); }
        catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
  if (local.length) return local;

  // Fallback to public instances
  for (const base of SEARXNG_INSTANCES) {
    const result = await new Promise((resolve) => {
      const url = new URL(`/search?q=${encodeURIComponent(query)}&format=json`, base);
      https.get(url.toString(), { headers: { 'User-Agent': 'Ghost/9.0' } }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data).results || []); }
          catch { resolve([]); }
        });
      }).on('error', () => resolve([]));
    });
    if (result.length) return result;
  }
  return [];
}

module.exports = {
  name: "web_search",
  description: "Search the web for news, jobs, research, current info",
  async run(args) {
    const query = args.query || args.q || args.search || '';
    if (!query) return { text: 'No search query provided.' };

    const results = (await fetchResults(query)).slice(0, 5);
    if (!results.length) return { text: `No results found for: ${query}` };

    const context = results.map((r, i) => `${i+1}. ${r.title}\n${r.content || ''}\n${r.url}`).join('\n\n');

    const answer = await new Promise((resolve) => {
      const body = JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 500,
        messages: [
          { role: 'system', content: 'You are Ghost. Answer directly from search results. No emojis. Address as sir.' },
          { role: 'user', content: `Query: ${query}\n\nResults:\n${context}\n\nAnswer directly.` }
        ]
      });
      const req = https.request({
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d).choices[0].message.content.trim()); }
          catch { resolve(context); }
        });
      });
      req.on('error', () => resolve(context));
      req.write(body);
      req.end();
    });

    return { text: answer };
  }
};
