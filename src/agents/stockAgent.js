const https = require('https');

function fetchStockData(ticker) {
  const cleanTicker = ticker.toUpperCase().trim();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanTicker)}?interval=1d&range=1d`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const meta = parsed.chart.result[0].meta;
          const price = meta.regularMarketPrice;
          const prevClose = meta.chartPreviousClose;
          const change = price - prevClose;
          const changePct = ((change / prevClose) * 100).toFixed(2);
          const currency = meta.currency || 'USD';
          
          resolve({
            symbol: meta.symbol,
            price,
            prevClose,
            change: change.toFixed(2),
            changePct: `${changePct >= 0 ? '+' : ''}${changePct}%`,
            currency,
            high: meta.regularMarketDayHigh,
            low: meta.regularMarketDayLow,
            exchange: meta.exchangeName
          });
        } catch (e) {
          reject(new Error(`Could not parse stock data for "${cleanTicker}": ${e.message}`));
        }
      });
    });
    req.on('error', err => reject(err));
  });
}

async function run(task = 'AAPL') {
  const symbolsMatch = task.match(/\b([A-Za-z]{1,5}|[A-Za-z]+-[A-Za-z]+|\^[A-Za-z]+)\b/g);
  const targetSymbol = (symbolsMatch && symbolsMatch[0]) ? symbolsMatch[0] : 'AAPL';

  try {
    const data = await fetchStockData(targetSymbol);
    const text = `📈 **Ghost Market Agent: ${data.symbol}**
- **Price**: ${data.currency} $${data.price} (${data.changePct})
- **Previous Close**: $${data.prevClose}
- **Day Range**: $${data.low} - $${data.high}
- **Exchange**: ${data.exchange}`;

    return {
      success: true,
      data,
      text
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      text: `[Stock Agent Warning]: ${err.message}`
    };
  }
}

module.exports = { run, fetchStockData };
