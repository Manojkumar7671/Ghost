const https = require("https");

class BrowserAgent {
  async run(task) {
    const query = encodeURIComponent(task);
    const key = process.env.SERPAPI_KEY;
    const url = `https://serpapi.com/search.json?q=${query}&api_key=${key}&num=5`;

    const raw = await new Promise((res, rej) => {
      https.get(url, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(d));
      }).on("error", rej);
    });

    let data;
    try { data = JSON.parse(raw); } catch { return { error: "Parse failed" }; }

    const snippets = (data.organic_results || []).slice(0, 5).map(r => `${r.title}: ${r.snippet}`);
    if (!snippets.length) return { result: "No results found for: " + task };

    return { result: snippets.join("\n\n"), sources: (data.organic_results || []).slice(0, 5).map(r => r.link) };
  }
}
module.exports = BrowserAgent;
