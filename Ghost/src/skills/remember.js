const vec = require('../vector_memory');
const fs = require('fs');
const path = require('path');
const SONA_FILE = path.join(__dirname, '../memory/sona.json');

module.exports = {
  name: "remember",
  description: "Admin command to make Ghost remember a specific fact permanently. Use when user says: remember this, learn that, store this, never forget",
  async run(args) {
    const fact = args.fact || args.query || args.text || '';
    if (!fact) return { text: 'What should I remember sir?' };

    // Save to vector memory
    vec.add(fact, { source: 'admin', type: 'admin_fact', ts: Date.now() });

    // Save to sona.json facts list
    try {
      const raw = fs.existsSync(SONA_FILE) ? JSON.parse(fs.readFileSync(SONA_FILE, 'utf8')) : { facts: [], learnCount: 0 };
      if (!raw.facts.includes(fact)) {
        raw.facts.unshift('[ADMIN] ' + fact);
        raw.learnCount++;
        raw.lastLearn = new Date().toISOString();
        fs.writeFileSync(SONA_FILE, JSON.stringify(raw, null, 2));
      }
    } catch(e) {}

    return { text: `Locked in memory sir: "${fact}"` };
  }
};
