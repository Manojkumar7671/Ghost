const Groq = require("groq-sdk");
const https = require("https");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class BrowserAgent {
  async run(task) {
    const query = encodeURIComponent(task);
    const url = `https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1`;
    const raw = await new Promise((res, rej) => {
      https.get(url, (r) => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(d)); }).on("error", rej);
    });
    let data;
    try { data = JSON.parse(raw); } catch { return { error: "Parse failed" }; }
    const snippets = [];
    if (data.AbstractText) snippets.push(data.AbstractText);
    (data.RelatedTopics || []).slice(0, 5).forEach(t => { if (t.Text) snippets.push(t.Text); });
    if (!snippets.length) return { result: "No results for: " + task };
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Summarize search results to answer the task." },
        { role: "user", content: `Task: ${task}\n\nResults:\n${snippets.join("\n")}` }
      ],
    });
    return { result: res.choices[0].message.content };
  }
}
module.exports = BrowserAgent;
