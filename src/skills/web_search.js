const https = require('https');

module.exports = {
  name: "web_search",
  description: "Search the web for any query including news, AI, jobs, current events",
  async run(args) {
    const query = args.query || args.q || args.search || '';
    if (!query) return { text: 'No query provided.' };

    return new Promise((resolve) => {
      const path = `/html/?q=${encodeURIComponent(query)}&kl=us-en`;
      const req = https.request({
        hostname: 'html.duckduckgo.com',
        path,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const snippets = [];
            const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
            const titleRegex = /<a class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
            let tm, sm;
            const titles = [], snips = [];
            while ((tm = titleRegex.exec(data)) !== null) titles.push(tm[1].replace(/<[^>]+>/g, '').trim());
            while ((sm = snippetRegex.exec(data)) !== null) snips.push(sm[1].replace(/<[^>]+>/g, '').trim());
            for (let i = 0; i < Math.min(3, titles.length); i++) {
              if (titles[i]) snippets.push(`${titles[i]}${snips[i] ? ': ' + snips[i] : ''}`);
            }
            if (!snippets.length) return resolve({ text: `No results found for: ${query}` });
            resolve({ text: snippets.join('\n\n') });
          } catch(e) { resolve({ text: `Search parse error: ${e.message}` }); }
        });
      });
      req.on('error', e => resolve({ text: `Search error: ${e.message}` }));
      req.end();
    });
  }
};
