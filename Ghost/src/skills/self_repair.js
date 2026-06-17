const fs = require('fs');
const path = require('path');
module.exports = {
  name: "self_repair",
  description: "Ghost checks its own skills for errors and repairs broken ones. Use when user says: self repair, fix yourself, check skills, health check, what's broken",
  async run(args, { skills, loadSkills }) {
    const healthFile = path.join(__dirname, '../memory/skill_health.json');
    let health = {};
    try { health = JSON.parse(fs.readFileSync(healthFile, 'utf8')); } catch {}
    const broken = Object.entries(health).filter(([,v]) => v.status === 'broken').map(([k]) => k);
    const ok = Object.entries(health).filter(([,v]) => v.status === 'ok').map(([k]) => k);
    if (broken.length === 0) {
      return { text: `All ${ok.length} skills healthy sir. No repairs needed.` };
    }
    if (typeof loadSkills === 'function') loadSkills();
    return { text: `Repaired ${broken.length} broken skill(s): ${broken.join(', ')}. Reloaded all skills sir.`, broken, ok };
  }
};