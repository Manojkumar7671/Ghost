const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '../memory');
const LEARNINGS_FILE = path.join(MEMORY_DIR, 'learnings.json');

function initStore() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
  if (!fs.existsSync(LEARNINGS_FILE)) {
    fs.writeFileSync(LEARNINGS_FILE, JSON.stringify([]));
  }
}

function recordLearning(task, toolsUsed, status, outcome) {
  initStore();
  try {
    const data = JSON.parse(fs.readFileSync(LEARNINGS_FILE, 'utf8'));
    data.push({
      timestamp: new Date().toISOString(),
      task,
      toolsUsed,
      status,
      outcome
    });
    // Keep only the last 100 learnings to prevent context bloat
    if (data.length > 100) data.shift();
    fs.writeFileSync(LEARNINGS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[Ghost] Failed to record learning:', error);
  }
}

function getRelevantLearnings(query) {
  initStore();
  try {
    const data = JSON.parse(fs.readFileSync(LEARNINGS_FILE, 'utf8'));
    if (data.length === 0) return "No past learnings available.";

    // Simple keyword extraction for matching (ignores words < 4 chars)
    const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    
    const relevant = data.filter(entry => {
      const taskStr = entry.task.toLowerCase();
      return words.some(w => taskStr.includes(w));
    }).slice(-5); // Get top 5 most relevant/recent

    if (relevant.length === 0) return "No directly matching past tasks found.";

    return relevant.map(r => 
      `Task: "${r.task}" -> Tools used: [${r.toolsUsed.join(', ')}] -> Status: ${r.status}`
    ).join('\n');
  } catch (error) {
    return "Failed to load past learnings.";
  }
}

module.exports = { recordLearning, getRelevantLearnings };