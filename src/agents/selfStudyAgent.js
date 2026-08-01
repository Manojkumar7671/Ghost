const fs = require('fs');
const path = require('path');
const { chat } = require('../tools/llm');

const STUDY_LOG_FILE = path.join(__dirname, '../../state/self_study_log.json');

// Ensure state dir exists
fs.mkdirSync(path.dirname(STUDY_LOG_FILE), { recursive: true });

function loadStudyLog() {
  if (!fs.existsSync(STUDY_LOG_FILE)) {
    return { userTopics: {}, ghostKnowledgeGaps: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(STUDY_LOG_FILE, 'utf8'));
  } catch {
    return { userTopics: {}, ghostKnowledgeGaps: [] };
  }
}

function saveStudyLog(data) {
  try {
    fs.writeFileSync(STUDY_LOG_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[SelfStudyAgent] Failed to save study log:', e.message);
  }
}

/**
 * Tracks a learning topic for Manoj and logs study progress.
 */
async function trackTopic(topic) {
  const log = loadStudyLog();
  const timestamp = new Date().toISOString();
  if (!log.userTopics[topic]) {
    log.userTopics[topic] = { firstSeen: timestamp, reviewsCount: 0, progress: 'Learning' };
  }
  log.userTopics[topic].lastReviewed = timestamp;
  log.userTopics[topic].reviewsCount += 1;
  saveStudyLog(log);
  console.log(`[SelfStudyAgent] Logged user learning topic: "${topic}"`);
  return log.userTopics[topic];
}

/**
 * Generates a spaced-repetition quiz question for Manoj on a target topic.
 */
async function generateQuiz(topic) {
  await trackTopic(topic);
  const prompt = `Generate a 1-question spaced repetition quiz for topic "${topic}".
Include:
1. Question
2. 3 Multiple Choice Options (A, B, C)
3. Correct Answer + 1-sentence Explanation`;

  return await chat([{ role: 'user', content: prompt }], { maxTokens: 250 });
}

/**
 * REFLEXIVE SELF-STUDY LOOP: Ghost turns its OWN failures into self-study material!
 * Logs Ghost's internal knowledge gap into state/self_study_log.json and generates a self-study lesson.
 */
async function recordGhostKnowledgeGap({ tool = '', failedStep = '', error = '' }) {
  const log = loadStudyLog();
  const timestamp = new Date().toISOString();

  const studyItem = {
    timestamp,
    tool,
    failedStep,
    error: String(error).slice(0, 200),
    correctiveStudyPrompt: `Ghost Self-Study Unit: How to properly format and execute tool "${tool}" for step "${failedStep}" without triggering error "${String(error).slice(0, 100)}".`
  };

  log.ghostKnowledgeGaps.push(studyItem);
  saveStudyLog(log);

  console.log(`[Reflexive Self-Study Loop] Logged Ghost internal knowledge gap for tool "${tool}". Total study units: ${log.ghostKnowledgeGaps.length}`);
  return studyItem;
}

module.exports = {
  run: async (task, context) => {
    return await generateQuiz(task);
  },
  trackTopic,
  generateQuiz,
  recordGhostKnowledgeGap,
  loadStudyLog
};
