const https = require('https');
module.exports = {
  name: "news",
  description: "Get latest news headlines. Use when user says: news, headlines, what's happening, latest news, today's news",
  async run(args) {
    const query = args.query || args.topic || 'top news today';
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return { text: 'SERPER_API_KEY not set.' };
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
            const articles = (json.news || json.organic || []).slice(0, 5).map(n => ({
              title: n.title, snippet: n.snippet, source: n.source, link: n.link
            }));
            resolve({ text: `Here are the latest news sir.`, news: articles });
          } catch { resolve({ text: 'Could not fetch news sir.' }); }
        });
      });
      req.on('error', () => resolve({ text: 'News fetch error.' }));
      req.end(body);
    });
  }
};
