import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PERSISTENCE_FILE = path.join(__dirname, '../state/user_personalization.json');

// Ensure state dir exists
fs.mkdirSync(path.dirname(PERSISTENCE_FILE), { recursive: true });

function loadStore() {
  if (!fs.existsSync(PERSISTENCE_FILE)) return {};
  try {
    const raw = fs.readFileSync(PERSISTENCE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveStore(store) {
  try {
    fs.writeFileSync(PERSISTENCE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('[Personalization Memory] Failed to save store:', e.message);
  }
}

/**
 * Records or updates a long-term user preference or fact.
 */
export function recordPreference(username = 'master_manoj', key, value) {
  const store = loadStore();
  if (!store[username]) {
    store[username] = { updated_at: new Date().toISOString(), preferences: {} };
  }
  store[username].preferences[key] = {
    value,
    recorded_at: new Date().toISOString()
  };
  store[username].updated_at = new Date().toISOString();
  saveStore(store);
  console.log(`[Personalization Memory] Recorded preference for "${username}": ${key} = "${value}"`);
  return store[username].preferences;
}

/**
 * Retrieves all long-term preferences for a specific user.
 */
export function getPersonalization(username = 'master_manoj') {
  const store = loadStore();
  const userRecord = store[username];
  if (!userRecord || !userRecord.preferences) return [];
  
  return Object.entries(userRecord.preferences).map(([key, val]) => {
    return `- ${key}: ${val.value}`;
  });
}

export default { recordPreference, getPersonalization };
