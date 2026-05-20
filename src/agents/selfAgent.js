const fs = require('fs-extra');
const path = require('path');
const { chat } = require('../tools/llm');
const GHOST_ROOT = path.join(__dirname, '../../');

async function readSelf() {
  const files = {};
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.endsWith('.js')) files[path.relative(GHOST_ROOT, full)] = fs.readFileSync(full, 'utf-8').slice(0, 2000);
    });
  }
  walk(path.join(GHOST_ROOT, 'src'));
  return files;
}
async function analyzeSelf() {
  const files = await readSelf();
  const analysis = await chat([{ role: 'user', content: `Analyze your own codebase:\nFiles: ${Object.keys(files).join('\n')}\n\nSample:\n${Object.entries(files).slice(0,2).map(([k,v])=>`// ${k}\n${v}`).join('\n---\n')}` }], { systemPrompt: 'You are Ghost. Analyze your own code. Find bugs and suggest improvements.' });
  return { files: Object.keys(files), analysis };
}
async function suggestFeature(description) {
  const files = await readSelf();
  const suggestion = await chat([{ role: 'user', content: `Files:\n${Object.keys(files).join('\n')}\n\nImplement: ${description}` }], { systemPrompt: 'Suggest precise implementation plan for Ghost.' });
  return { feature: description, suggestion };
}
module.exports = { readSelf, analyzeSelf, suggestFeature };
