const https = require('https');
const http = require('http');
const { chat } = require('../tools/llm');
const axios = require('axios');

async function searchWeb(query) {
  const results = await new Promise((resolve) => {
    const url = `http://localhost:8080/search?q=${encodeURIComponent(query)}&format=json`;
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

// Added scrapeAndSummarize to parse web content and fix subtask execution crashes
async function scrapeAndSummarize(url) {
  try {
    const res = await axios.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' 
      },
      timeout: 10000 
    });
    const html = res.data;
    
    // Strip script and style blocks, then clean tags
    let text = html
      .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
      .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Truncate text to avoid token limits
    text = text.substring(0, 5000);
    
    if (text.length < 50) {
      return { url, summary: `Unable to extract meaningful text content from page. Raw length: ${text.length} chars.` };
    }
    
    const summary = await chat([
      { role: 'system', content: 'You are Ghost, an elite autonomous AI. Summarize the text of the webpage provided below clearly and concisely.' },
      { role: 'user', content: `Webpage URL: ${url}\n\nWebpage content:\n${text}` }
    ], { maxTokens: 400 });
    
    return { url, summary: summary.trim() };
  } catch (err) {
    return { url, summary: `Failed to scrape page content: ${err.message}` };
  }
}

module.exports = { searchWeb, scrapeAndSummarize };
