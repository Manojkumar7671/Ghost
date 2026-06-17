const https = require('https');
const { chat } = require('../tools/llm');

async function searchWeb(query) {
  const results = await new Promise((resolve) => {
    const url = `http://localhost:8080/search?q=${encodeURIComponent(query)}&format=json`;
    const http = require('http');
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve((json.results || []).slice(0, 5).map(r => ({ title: r.title, url: r.url, snippet: r.content })));
        } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });

  if (!results.length) return { error: `No results for: ${query}` };
  const context = results.map((r,i) => `${i+1}. ${r.title}\n${r.snippet}\n${r.url}`).join('\n\n');
  return { query, results, summary: context };
}

module.exports = { searchWeb };
