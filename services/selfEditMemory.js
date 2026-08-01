import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, '../logs/self_edits.log');

// Ensure log directory exists
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

/**
 * Formats and records a self-edit lesson after a step failure or execution mistake.
 */
export async function recordSelfEdit({ username = 'guest', goal = '', failedStep = '', tool = '', error = '', attemptsTried = [] }, pool = null) {
  const timestamp = new Date().toISOString();
  const lessonText = `Avoid failing tool "${tool}" for task "${failedStep}". Error encountered: "${String(error).slice(0, 150)}".`;
  
  const record = {
    timestamp,
    username,
    goal,
    failedStep,
    tool,
    error: String(error).slice(0, 200),
    lesson: lessonText
  };

  const line = `[${timestamp}] User: "${username}" | Goal: "${goal}" | Tool: "${tool}" | Error: "${record.error}" | Lesson: "${lessonText}"\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
    console.log(`[Self-Edit Memory] Logged lesson to ${LOG_FILE}`);
  } catch (e) {
    console.error('[Self-Edit Memory] Failed to write log:', e.message);
  }

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO user_memories (username, history_json, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (username) DO UPDATE SET history_json = user_memories.history_json || $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
        [username, JSON.stringify([{ type: 'self_edit_lesson', record }])]
      );
      console.log(`[Self-Edit Memory] Persisted lesson to database for user "${username}"`);
    } catch (dbErr) {
      console.warn('[Self-Edit Memory] DB persist skipped/failed:', dbErr.message);
    }
  }

  // Trigger Reflexive Self-Study Loop for Ghost itself
  try {
    const studyMod = await import('../src/agents/selfStudyAgent.js');
    const recordFn = studyMod.recordGhostKnowledgeGap || studyMod.default?.recordGhostKnowledgeGap;
    if (typeof recordFn === 'function') {
      await recordFn({ tool, failedStep, error });
    }
  } catch (studyErr) {
    console.warn('[Reflexive Self-Study Loop] Failed to trigger self-study log:', studyErr.message);
  }

  return record;
}

/**
 * Formats and records a successful execution pattern for future planning bias.
 */
export async function recordSuccessPattern({ username = 'guest', goal = '', tool = '', pattern = '', result = '' }, pool = null) {
  const timestamp = new Date().toISOString();
  const patternText = `Successful pattern for "${goal}" using tool "${tool}": ${pattern || result.slice(0, 150)}`;

  const line = `[${timestamp}] [SUCCESS] User: "${username}" | Goal: "${goal}" | Tool: "${tool}" | Pattern: "${patternText}"\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
    console.log(`[Self-Edit Memory] Logged success pattern to ${LOG_FILE}`);
  } catch (e) {
    console.error('[Self-Edit Memory] Failed to write success log:', e.message);
  }

  return { timestamp, username, goal, tool, patternText };
}

/**
 * Retrieves relevant self-edit lessons for the current goal to inject into DAG planning context.
 */
export function getSelfEditLessons(goal = '') {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8').trim();
    if (!raw) return [];
    
    const lines = raw.split('\n').filter(Boolean);
    const lessons = lines.map(l => {
      if (l.includes('[SUCCESS]')) return null; // Exclude success lines from failure lessons
      const idx = l.indexOf('| Lesson: "');
      if (idx !== -1) {
        const rawLesson = l.slice(idx + 11);
        return rawLesson.endsWith('"') ? rawLesson.slice(0, -1) : rawLesson;
      }
      return null;
    }).filter(Boolean);

    const result = Array.from(new Set(lessons)).slice(-3);
    console.log(`[Self-Edit Memory Retrieval] [Goal: "${goal}"] Found ${result.length} past lesson(s):\n${result.map(l => `  -> ${l}`).join('\n')}`);
    return result;
  } catch (e) {
    console.error('[Self-Edit Memory] Failed to read lessons:', e.message);
    return [];
  }
}

/**
 * Retrieves relevant successful patterns to bias future task execution.
 */
export function getSuccessPatterns(goal = '') {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8').trim();
    if (!raw) return [];
    
    const lines = raw.split('\n').filter(l => l.includes('[SUCCESS]'));
    const patterns = lines.map(l => {
      const idx = l.indexOf('| Pattern: "');
      if (idx !== -1) {
        const rawP = l.slice(idx + 12);
        return rawP.endsWith('"') ? rawP.slice(0, -1) : rawP;
      }
      return null;
    }).filter(Boolean);

    const result = Array.from(new Set(patterns)).slice(-3);
    console.log(`[Self-Edit Memory Retrieval] [Goal: "${goal}"] Found ${result.length} past success pattern(s):\n${result.map(p => `  -> ${p}`).join('\n')}`);
    return result;
  } catch (e) {
    console.error('[Self-Edit Memory] Failed to read success patterns:', e.message);
    return [];
  }
}

export default { recordSelfEdit, getSelfEditLessons, recordSuccessPattern, getSuccessPatterns };
