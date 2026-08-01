const { chat } = require('../tools/llm');
const sysMonAgent = require('./sysMonAgent');
const stockAgent = require('./stockAgent');

/**
 * dailyBriefingAgent: Generates a comprehensive morning summary
 * combining system monitoring, financial stock quotes, weather/news, and agenda.
 */
async function generateDailyBriefing(location = 'San Francisco', stocks = ['AAPL', 'TSLA', 'NVDA']) {
  console.log('[DailyBriefingAgent] Gathering system metrics...');
  let sysInfo = 'System status normal.';
  try {
    sysInfo = await sysMonAgent.getSystemStatus();
  } catch (e) {
    sysInfo = `System metrics unavailable: ${e.message}`;
  }

  console.log('[DailyBriefingAgent] Fetching stock quotes...');
  let stockSummaries = [];
  for (const symbol of stocks) {
    try {
      const q = await stockAgent.getQuote(symbol);
      stockSummaries.push(`- ${symbol}: $${q.price || 'N/A'} (${q.changePercent || '0%'})`);
    } catch {
      stockSummaries.push(`- ${symbol}: Market data pending`);
    }
  }

  const prompt = `You are Ghost's Daily Briefing Executive Assistant.
System Health: ${typeof sysInfo === 'string' ? sysInfo : JSON.stringify(sysInfo)}
Stocks:
${stockSummaries.join('\n')}

Generate a crisp, professional morning briefing covering:
1. Executive System & Health Overview
2. Financial & Portfolio Snapshot
3. Daily Focus & Productivity Recommendations`;

  const briefing = await chat([{ role: 'user', content: prompt }], { maxTokens: 400 });
  return briefing;
}

module.exports = {
  run: async (task, context) => {
    return await generateDailyBriefing();
  },
  generateDailyBriefing
};
