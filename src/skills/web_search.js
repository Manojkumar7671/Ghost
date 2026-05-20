const https = require('https');

module.exports = {
  name: "web_search",
  description: "Search the web for news, jobs, current events, or any real-time information",
  async run(args) {
    const query = args.query || args.q || args.search || '';
    if (!query) return { text: 'No query provided.' };

    return new Promise((resolve) => {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      https.get(url, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const parts = [];
            if (json.AbstractText) parts.push(json.AbstractText);
            if (json.RelatedTopics) {
              json.RelatedTopics.slice(0, 5).forEach(t => {
                if (t.Text) parts.push('• ' + t.Text);
              });
            }
            if (!parts.length) return resolve({ text: `No results found for: ${query}` });
            resolve({ text: parts.join('\n\n') });
          } catch { resolve({ text: `Search failed for: ${query}` }); }
        });
      }).on('error', (e) => resolve({ text: `Search error: ${e.message}` }));
    });
  }
};
