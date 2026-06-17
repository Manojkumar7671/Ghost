const https = require('https');

function serperNews(query, apiKey) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ q: query, num: 6, type: 'news' });
    const req = https.request({
      hostname: 'google.serper.dev', path: '/news', method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data).news || []); } catch { resolve([]); } });
    });
    req.on('error', () => resolve([]));
    req.end(body);
  });
}

function geocode(location) {
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
    https.get(url, { headers: { 'User-Agent': 'Ghost/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.length) resolve({ lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) });
          else resolve(null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function extractLocations(articles, groq) {
  try {
    const titles = articles.map((a, i) => `${i}: ${a.title}`).join('\n');
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: `For each news headline, extract the most specific real-world location mentioned (city, country, or region). Return ONLY a JSON array of strings, one per headline, empty string if no location. Headlines:\n${titles}\nJSON:` }],
      max_tokens: 200, temperature: 0.1
    });
    const raw = res.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch { return articles.map(() => ''); }
}

module.exports = {
  name: "news_map",
  description: "Show latest news as cards AND plot each story on a map with highlights. Use when user says: tell me the news and show map, news with map, what happened in the world",
  async run(args, ctx) {
    const query = args.query || 'top world news today';
    const apiKey = process.env.SERPER_API_KEY;
    const groq = ctx && ctx.groq;
    if (!apiKey) return { text: 'SERPER_API_KEY not set sir.' };

    const articles = await serperNews(query, apiKey);
    if (!articles.length) return { text: 'Could not fetch news sir.' };

    // Extract locations via Groq
    const locations = groq ? await extractLocations(articles, groq) : articles.map(() => '');

    // Geocode all locations in parallel
    const geoResults = await Promise.all(
      locations.map(loc => loc ? geocode(loc) : Promise.resolve(null))
    );

    // Build markers array
    const markers = [];
    const news = articles.map((a, i) => {
      const geo = geoResults[i];
      const loc = locations[i] || '';
      if (geo && loc) {
        markers.push({ lat: geo.lat, lng: geo.lng, title: a.title, snippet: a.snippet || '', location: loc });
      }
      return { title: a.title, snippet: a.snippet, source: a.source, link: a.link, location: loc };
    });

    // Build spoken summary
    const summary = `Here are today's top stories sir. ${articles.slice(0, 3).map(a => a.title).join('. ')}`;

    return { text: summary, news, newsmap: markers };
  }
};
