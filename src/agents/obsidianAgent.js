/**
 * obsidianAgent.js
 * Integrates Ghost with Obsidian via the "Local REST API" community plugin.
 *
 * Prerequisites (Manoj must do manually):
 *   1. Install "Local REST API" plugin in Obsidian (Settings → Community Plugins)
 *   2. Enable it and copy the API key
 *   3. Add to Ghost .env:
 *        OBSIDIAN_API_KEY=<key from Obsidian plugin settings>
 *        OBSIDIAN_VAULT_PATH=<absolute path to your vault folder>
 *   4. The plugin runs on https://127.0.0.1:27124 with a self-signed cert by default.
 *
 * OUTPUT FORMAT: all notes are written as Obsidian-flavored markdown:
 *   - YAML frontmatter (---) at top with title, date, tags
 *   - Wikilinks: [[Note Name]]
 *   - Tags: #tag-name in body or frontmatter array
 *   - No raw HTML (Obsidian renders it inconsistently)
 *   - Headings use ## / ### (not bold text as headings)
 *   - Callouts: > [!NOTE], > [!WARNING] etc.
 *
 * LOCAL-ONLY: this agent must always run on Mac. Never route to renderAgent.
 */

const https = require('https');
const path  = require('path');
const fs    = require('fs');

// Self-signed cert — disable TLS verification for localhost only
const OBSIDIAN_AGENT = new https.Agent({ rejectUnauthorized: false });

/** Check if the Obsidian REST API is reachable (non-blocking, max 2s) */
async function isApiReachable(baseUrl, apiKey) {
  return new Promise((resolve) => {
    const url = new URL('/vault/', baseUrl);
    const req = https.request({
      hostname: url.hostname,
      port:     url.port || 27124,
      path:     url.pathname,
      method:   'HEAD',
      agent:    OBSIDIAN_AGENT,
      timeout:  2000,
      headers:  { Authorization: `Bearer ${apiKey}` }
    }, () => resolve(true));
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function getConfig() {
  const apiKey   = process.env.OBSIDIAN_API_KEY;
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
  const baseUrl  = process.env.OBSIDIAN_API_URL || 'https://127.0.0.1:27124';

  if (!apiKey) {
    throw new Error(
      '[obsidianAgent] OBSIDIAN_API_KEY is not set.\n' +
      'Action needed: In Obsidian → Settings → Community Plugins → Local REST API → copy the API key,\n' +
      'then add OBSIDIAN_API_KEY=<key> to Ghost/.env'
    );
  }
  if (!vaultPath) {
    throw new Error(
      '[obsidianAgent] OBSIDIAN_VAULT_PATH is not set.\n' +
      'Action needed: Add OBSIDIAN_VAULT_PATH=<absolute path to your Obsidian vault> to Ghost/.env\n' +
      'Example: OBSIDIAN_VAULT_PATH=/Users/manojkumarmathangi/Documents/MyVault'
    );
  }
  return { apiKey, vaultPath, baseUrl };
}

/**
 * Low-level HTTP call to the Obsidian Local REST API.
 */
async function obsidianRequest(method, endpoint, body = null, contentType = null) {
  const { apiKey, baseUrl } = getConfig();
  const url = new URL(endpoint, baseUrl);

  return new Promise((resolve, reject) => {
    const isObject = typeof body === 'object' && body !== null;
    const bodyStr = isObject ? JSON.stringify(body) : (body !== null ? String(body) : null);
    const finalContentType = contentType || (isObject ? 'application/json' : 'text/markdown');

    const reqOpts = {
      hostname: url.hostname,
      port:     url.port || 27124,
      path:     url.pathname + (url.search || ''),
      method,
      agent:    OBSIDIAN_AGENT,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': finalContentType,
        ...(bodyStr !== null ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`Obsidian API HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
        try {
          resolve(data ? JSON.parse(data) : { status: res.statusCode });
        } catch {
          resolve({ raw: data, status: res.statusCode });
        }
      });
    });

    req.on('error', (e) =>
      reject(new Error(`Obsidian REST API unreachable: ${e.message}. Is the Local REST API plugin enabled in Obsidian?`))
    );
    if (bodyStr !== null) req.write(bodyStr);
    req.end();
  });
}

/** Build Obsidian-flavored markdown frontmatter */
function buildFrontmatter(title, tags = []) {
  const date = new Date().toISOString().split('T')[0];
  const tagList = tags.length ? `\ntags:\n${tags.map((t) => `  - ${t}`).join('\n')}` : '';
  return `---\ntitle: "${title}"\ndate: ${date}${tagList}\n---\n\n`;
}

/**
 * createNote(notePath, content, tags)
 * notePath: relative to vault root, e.g. "Projects/my-note.md"
 * content:  markdown body (frontmatter will be prepended if not already present)
 * tags:     optional string array for frontmatter
 */
async function createNote(notePath, content, tags = []) {
  const title = path.basename(notePath, '.md');
  const finalPath = notePath.endsWith('.md') ? notePath : `${notePath}.md`;

  // Prepend frontmatter if not already present
  const body = content.trimStart().startsWith('---')
    ? content
    : buildFrontmatter(title, tags) + content;

  const { apiKey, vaultPath, baseUrl } = getConfig();

  // Try REST API first
  const apiUp = await isApiReachable(baseUrl, apiKey);
  if (apiUp) {
    const result = await obsidianRequest('PUT', `/vault/${encodeURIComponent(finalPath)}`, body, 'text/markdown');
    console.log(`[obsidianAgent] createNote via REST API: ${finalPath} → status ${result.status || 'ok'}`);
    return { success: true, path: finalPath, result, method: 'api' };
  }

  // Fallback: write directly to vault folder on disk
  console.warn('[obsidianAgent] REST API unreachable — falling back to direct disk write');
  const diskPath = path.join(vaultPath, finalPath);
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  fs.writeFileSync(diskPath, body, 'utf8');
  console.log(`[obsidianAgent] createNote via disk: ${diskPath}`);
  return { success: true, path: finalPath, result: { status: 'disk_write' }, method: 'disk' };
}

/**
 * appendToNote(notePath, content)
 * Appends content to an existing note (creates if missing).
 */
async function appendToNote(notePath, content) {
  const finalPath = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
  const { apiKey, vaultPath, baseUrl } = getConfig();

  const apiUp = await isApiReachable(baseUrl, apiKey);
  if (apiUp) {
    const result = await obsidianRequest('POST', `/vault/${encodeURIComponent(finalPath)}`, content, 'text/markdown');
    console.log(`[obsidianAgent] appendToNote via REST API: ${finalPath}`);
    return { success: true, path: finalPath, result, method: 'api' };
  }

  // Fallback: append directly to disk
  console.warn('[obsidianAgent] REST API unreachable — falling back to direct disk append');
  const diskPath = path.join(vaultPath, finalPath);
  if (!fs.existsSync(diskPath)) {
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, content, 'utf8');
  } else {
    fs.appendFileSync(diskPath, '\n' + content, 'utf8');
  }
  console.log(`[obsidianAgent] appendToNote via disk: ${diskPath}`);
  return { success: true, path: finalPath, result: { status: 'disk_append' }, method: 'disk' };
}

/**
 * readNote(notePath) → { content: string }
 */
async function readNote(notePath) {
  const finalPath = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
  const { apiKey, vaultPath, baseUrl } = getConfig();

  const apiUp = await isApiReachable(baseUrl, apiKey);
  if (apiUp) {
    const result = await obsidianRequest('GET', `/vault/${encodeURIComponent(finalPath)}`);
    return { success: true, path: finalPath, content: result.content || result.raw || '', method: 'api' };
  }

  // Fallback: read directly from disk
  console.warn('[obsidianAgent] REST API unreachable — falling back to direct disk read');
  const diskPath = path.join(vaultPath, finalPath);
  if (!fs.existsSync(diskPath)) {
    return { success: false, path: finalPath, content: `[obsidianAgent] Note not found at ${diskPath}. Open Obsidian to sync.`, method: 'disk' };
  }
  const content = fs.readFileSync(diskPath, 'utf8');
  return { success: true, path: finalPath, content, method: 'disk' };
}

/**
 * searchVault(query) → array of matching note paths
 */
async function searchVault(query) {
  const result = await obsidianRequest('POST', `/search/simple/?query=${encodeURIComponent(query)}`);
  const hits = Array.isArray(result) ? result : (result.results || []);
  console.log(`[obsidianAgent] searchVault "${query}" → ${hits.length} hits`);
  return { success: true, query, hits };
}

/**
 * listNotes(folder) → array of file paths under the folder
 */
async function listNotes(folder = '') {
  const endpoint = folder
    ? `/vault/${encodeURIComponent(folder)}/`
    : '/vault/';
  const result = await obsidianRequest('GET', endpoint);
  const files = result.files || result || [];
  return { success: true, folder, files };
}

/**
 * Main adapter entry point (called by agentAdapter).
 */
async function run(task, context = '') {
  // Guard: fail cleanly if env not set
  let cfg;
  try {
    cfg = getConfig();
  } catch (err) {
    return err.message;
  }

  // Proactively check API status and warn if using disk fallback
  const apiUp = await isApiReachable(cfg.baseUrl, cfg.apiKey);
  const modeNote = apiUp
    ? ''
    : ' ⚠️ (Obsidian app is closed — using direct disk read/write. Open Obsidian to sync with the app.)';

  const desc = task.toLowerCase();

  try {
    if (desc.includes('create note') || desc.includes('write note') || desc.includes('new note')) {
      const pathMatch = task.match(/["']([^"']+\.md)["']/);
      const notePath  = pathMatch ? pathMatch[1] : `Ghost-Notes/${Date.now()}.md`;
      const content   = context || task;
      const result    = await createNote(notePath, content);
      return `[obsidianAgent] Note created at ${result.path}${modeNote}`;
    }

    if (desc.includes('append') || desc.includes('add to note')) {
      const pathMatch = task.match(/["']([^"']+\.md)["']/);
      const notePath  = pathMatch ? pathMatch[1] : 'Ghost-Notes/inbox.md';
      const result    = await appendToNote(notePath, context || task);
      return `[obsidianAgent] Appended to ${result.path}${modeNote}`;
    }

    if (desc.includes('read note') || desc.includes('open note') || desc.includes('get note')) {
      const pathMatch = task.match(/["']([^"']+)["']/);
      const notePath  = pathMatch ? pathMatch[1] : task.replace(/^.*?(read|open|get)\s+note\s*/i, '').trim();
      const result    = await readNote(notePath);
      return `[obsidianAgent] Content of ${result.path}:\n\n${result.content}${modeNote}`;
    }

    if (desc.includes('search') || desc.includes('find note') || desc.includes('search vault')) {
      if (!apiUp) {
        return `[obsidianAgent] Search requires the Obsidian app to be open (REST API offline).${modeNote}`;
      }
      const queryMatch = task.match(/(?:search|find|query)\s+(?:for\s+)?["']?([^"']+?)["']?\s*$/i);
      const query      = queryMatch ? queryMatch[1].trim() : task;
      const result     = await searchVault(query);
      const hitList    = result.hits.map((h) => `- ${h.filename || h.path || JSON.stringify(h)}`).join('\n');
      return `[obsidianAgent] Search "${query}" → ${result.hits.length} results:\n${hitList}`;
    }

    if (desc.includes('list') || desc.includes('folder')) {
      const folderMatch = task.match(/(?:in|folder|directory)\s+["']?([^"'\s]+)["']?/i);
      const folder      = folderMatch ? folderMatch[1] : '';
      const result      = await listNotes(folder);
      return `[obsidianAgent] Files in "${folder || 'vault root'}":\n${JSON.stringify(result.files, null, 2)}`;
    }

    return `[obsidianAgent] Unrecognised task. Supported: create note, append to note, read note, search vault, list notes.`;
  } catch (err) {
    console.error('[obsidianAgent] Error:', err.message);
    return `[obsidianAgent] Error: ${err.message}`;
  }
}

module.exports = { run, createNote, appendToNote, readNote, searchVault, listNotes };
