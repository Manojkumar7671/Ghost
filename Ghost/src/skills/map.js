const https = require('https');
module.exports = {
  name: "map",
  description: "Show a map of any location. Use when user says: show map, where is, locate, find on map",
  async run(args) {
    const location = args.location || args.query || '';
    if (!location) return { text: 'What location sir?' };
    return new Promise((resolve) => {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
      https.get(url, { headers: { 'User-Agent': 'Ghost/1.0' } }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.length) return resolve({ text: `Could not find ${location} sir.` });
            const { lat, lon, display_name } = json[0];
            resolve({
              text: `Here is ${location} on the map sir.`,
              map: { lat: parseFloat(lat), lng: parseFloat(lon), zoom: 13, label: display_name.split(',')[0] }
            });
          } catch { resolve({ text: 'Map error sir.' }); }
        });
      }).on('error', () => resolve({ text: 'Map fetch error.' }));
    });
  }
};
