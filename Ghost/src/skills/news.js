const https = require('https');
module.exports = {
  name: "news",
  description: "Get latest news headlines. Use when user says: news, headlines, what's happening, latest news, today's news",
  async run(args) {
    const query = args.query || args.topic || 'top news today';
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return { text: 'SERPER_API_KEY not set in Render environment.' };
    return new Promise((resolve) => {
      const body = JSON.stringify({ q: query, num: 5, type: 'news' });
      const req = https.request({
        hostname: 'google.serper.dev', path: '/news', method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const articles = (json.news || json.organic || []).slice(0, 5);
            if (!articles.length) return resolve({ text: 'No news found sir.' });
            const text = articles.map((n, i) =>
              `${i+1}. ${n.title}\n   ${n.snippet || ''}\n   Source: ${n.source || 'unknown'}`
            ).join('\n\n');
            resolve({ text: `Latest news sir:\n\n${text}`, news: articles });
          } catch { resolve({ text: 'Could not parse news response sir.' }); }
        });
      });
      req.on('error', (e) => resolve({ text: `News fetch error: ${e.message}` }));
      req.end(body);
    });
  }
};
