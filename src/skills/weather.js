const https = require('https');
module.exports = {
  name: "weather",
  description: "Get current weather for any location",
  async run(args) {
    const location = args.location || args.city || args.q || 'Vijayawada';
    return new Promise((resolve) => {
      https.get(`https://wttr.in/${encodeURIComponent(location)}?format=3&u`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ text: data.trim() }));
      }).on('error', () => resolve({ text: `Could not fetch weather for ${location}.` }));
    });
  }
};
