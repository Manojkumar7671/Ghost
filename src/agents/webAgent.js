const { chat } = require('../tools/llm');
const axios = require('axios');

const SERPER_API_KEY = process.env.SERPER_API_KEY;

/**
 * Search the web using Serper (Google Search API).
 * Replaces the broken localhost:8080 SearXNG dependency.
 */
async function searchWeb(query) {
  if (!SERPER_API_KEY) {
    return { error: 'Web search unavailable — SERPER_API_KEY not configured.', query, results: [], summary: `[Oracle offline] Search for "${query}" could not be completed — no API key configured.` };
  }

  try {
    const res = await axios.post(
      'https://google.serper.dev/search',
      { q: query, num: 5 },
      {
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        timeout: 8000
      }
    );

    const organic = res.data.organic || [];
    if (!organic.length) {
      return { query, results: [], summary: `[Oracle] No results found for: "${query}"` };
    }

    const results = organic.slice(0, 5).map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet || ''
    }));

    const context = results.map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\n${r.url}`).join('\n\n');
    return { query, results, summary: context };

  } catch (err) {
    console.error('[webAgent] searchWeb error:', err.message);
    return { error: err.message, query, results: [], summary: `[Oracle] Search failed: ${err.message}` };
  }
}

/**
 * Scrape a URL and summarize its text content using Ghost's LLM.
 */
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
