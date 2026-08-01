import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLAN_FILE = path.join(__dirname, '../state/plan_structures.json');

// Ensure state dir exists
fs.mkdirSync(path.dirname(PLAN_FILE), { recursive: true });

function loadPlanStore() {
  if (!fs.existsSync(PLAN_FILE)) return [];
  try {
    const raw = fs.readFileSync(PLAN_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function savePlanStore(plans) {
  try {
    // Enforce max 50 entries to prevent unbounded growth
    const trimmed = Array.isArray(plans) ? plans.slice(-50) : [];
    fs.writeFileSync(PLAN_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (e) {
    console.error('[Plan Memory] Failed to save plan structures:', e.message);
  }
}

function normalizeGoal(goal = '') {
  return String(goal)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'this', 'that', 'from', 'check', 'get', 'run'].includes(w));
}

/**
 * Records a successful multi-step plan structure.
 */
export function recordPlanStructure(primaryGoal = '', subtasks = []) {
  if (!primaryGoal || !Array.isArray(subtasks) || subtasks.length === 0) return null;
  
  const plans = loadPlanStore();
  const goalWords = normalizeGoal(primaryGoal);
  const goalKey = goalWords.sort().join('_');

  const existingIdx = plans.findIndex(p => p.goalKey === goalKey || p.primaryGoal.toLowerCase() === primaryGoal.toLowerCase());
  const now = new Date().toISOString();

  if (existingIdx !== -1) {
    plans[existingIdx].subtasks = subtasks;
    plans[existingIdx].count = (plans[existingIdx].count || 1) + 1;
    plans[existingIdx].updatedAt = now;
    console.log(`[Plan Memory] Updated existing plan structure for goal: "${primaryGoal}" (Usage count: ${plans[existingIdx].count})`);
  } else {
    plans.push({
      id: `plan_${Date.now()}`,
      goalKey,
      primaryGoal,
      subtasks,
      count: 1,
      createdAt: now,
      updatedAt: now
    });
    console.log(`[Plan Memory] Stored new plan structure for goal: "${primaryGoal}" with ${subtasks.length} subtask(s).`);
  }

  savePlanStore(plans);
  return plans[existingIdx !== -1 ? existingIdx : plans.length - 1];
}

/**
 * Retrieves a matching stored plan structure for a given goal.
 */
export function getMatchingPlanStructure(primaryGoal = '') {
  if (!primaryGoal) return null;
  const plans = loadPlanStore();
  if (plans.length === 0) return null;

  const targetWords = normalizeGoal(primaryGoal);
  if (targetWords.length === 0) return null;

  for (const p of plans) {
    if (p.primaryGoal.toLowerCase() === primaryGoal.toLowerCase()) {
      console.log(`[Plan Memory Retrieval] Exact match found for goal: "${primaryGoal}"`);
      return p;
    }
    const storedWords = normalizeGoal(p.primaryGoal);
    const overlap = targetWords.filter(w => storedWords.includes(w));
    const matchScore = overlap.length / Math.max(targetWords.length, storedWords.length);
    
    if (matchScore >= 0.6) {
      console.log(`[Plan Memory Retrieval] Pattern match found (${(matchScore * 100).toFixed(0)}% match) for goal "${primaryGoal}" -> Stored: "${p.primaryGoal}"`);
      return p;
    }
  }

  return null;
}

export default { recordPlanStructure, getMatchingPlanStructure };
