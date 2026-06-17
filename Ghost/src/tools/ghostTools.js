const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const GhostTools = {
  web_search: {
    description: 'Search the web',
    execute: async (query) => {
      try {
        const response = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`);
        return {
          abstract: response.data.Abstract,
          results: response.data.RelatedTopics?.slice(0, 5).map(t => t.Text) || [],
        };
      } catch (err) { return { error: err.message }; }
    },
  },

  web_scrape: {
    description: 'Scrape a URL',
    execute: async (url) => {
      try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
        const text = response.data
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, 5000);
        return { url, content: text };
      } catch (err) { return { error: err.message }; }
    },
  },

  get_weather: {
    description: 'Get weather for a city',
    execute: async (city) => {
      try {
        const response = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
        return {
          city,
          temp: response.data.current_condition[0].temp_C + '°C',
          condition: response.data.current_condition[0].weatherDesc[0].value,
        };
      } catch (err) { return { error: err.message }; }
    },
  },

  wikipedia: {
    description: 'Search Wikipedia',
    execute: async (query) => {
      try {
        const search = await axios.get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`);
        const pageId = search.data.query.search[0]?.pageid;
        if (!pageId) return { result: 'Nothing found' };
        const summary = await axios.get(`https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=extracts&exintro=true&format=json`);
        const text = summary.data.query.pages[pageId].extract.replace(/<[^>]+>/g, '').slice(0, 1000);
        return { result: text };
      } catch (err) { return { error: err.message }; }
    },
  },

  file_write: {
    description: 'Write to a file',
    execute: async (filepath, content) => {
      try {
        const fullPath = path.resolve(filepath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
        return { success: true, path: fullPath };
      } catch (err) { return { error: err.message }; }
    },
  },

  file_read: {
    description: 'Read a file',
    execute: async (filepath) => {
      try {
        const content = fs.readFileSync(path.resolve(filepath), 'utf8');
        return { success: true, content };
      } catch (err) { return { error: err.message }; }
    },
  },

  run_command: {
    description: 'Run a shell command',
    execute: async (command) => {
      return new Promise((resolve) => {
        exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
          resolve({ success: !error, output: stdout || stderr || error?.message });
        });
      });
    },
  },
};

async function routeToolCall(userMessage) {
  const lower = userMessage.toLowerCase();
  if (lower.includes('search for') || lower.includes('look up')) {
    const query = userMessage.replace(/.*(?:search for|look up)\s*/i, '');
    return await GhostTools.web_search.execute(query);
  }
  if (lower.includes('scrape') || lower.includes('visit this')) {
    const url = userMessage.match(/https?:\/\/[^\s]+/)?.[0];
    if (url) return await GhostTools.web_scrape.execute(url);
  }
  if (lower.includes('weather in')) {
    const city = userMessage.replace(/.*weather in\s*/i, '').trim();
    return await GhostTools.get_weather.execute(city);
  }
  if (lower.includes('tell me about') || lower.includes('what is') || lower.includes('who is')) {
    const query = userMessage.replace(/.*(?:tell me about|what is|who is)\s*/i, '').trim();
    return await GhostTools.wikipedia.execute(query);
  }
  return null;
}

module.exports = { GhostTools, routeToolCall };
