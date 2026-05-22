const https = require('https');

module.exports = {
  name: "web_search",
  description: "Search the web for news, AI, jobs, current events, prices",
  async run(args) {
    const query = args.query || args.q || args.search || '';
    if (!query) return { text: 'No query provided.' };

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return { text: 'SERPER_API_KEY not set.' };

    return new Promise((resolve) => {
      const body = JSON.stringify({ q: query, num: 3 });
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
          try {
            const json = JSON.parse(data);
            const results = (json.organic || []).slice(0, 3);
            if (!results.length) return resolve({ text: 'No results found.' });
            const text = results.map(r => `${r.title}: ${r.snippet}`).join('\n\n');
            resolve({ text });
          } catch(e) { resolve({ text: `Parse error: ${e.message}` }); }
        });
      });
      req.on('error', e => resolve({ text: `Search error: ${e.message}` }));
      req.end(body);
    });
  }
};
