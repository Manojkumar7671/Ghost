/**
 * renderAgent.js
 * Delegates tasks to the always-on Ghost Render deployment.
 * Mac brain calls this; user never talks to Render directly.
 *
 * Routing rule (enforced by agentAdapter, not here):
 *   LOCAL  (Mac)  : file access, PM2, local automation, Obsidian, sysMonAgent,
 *                   privacy-sensitive tasks, anything needing real Mac hardware.
 *   RENDER (this) : always-on background tasks, scheduled/reminder tasks,
 *                   non-file non-hardware public tasks (web lookups, summaries,
 *                   stock quotes, general Q&A that needs 24/7 uptime).
 */

const https = require('https');
const http  = require('http');

const RENDER_BASE_URL = process.env.RENDER_GHOST_URL || 'https://ghost-34qz.onrender.com';

/**
 * Low-level POST to Render's /api/chat endpoint.
 * Returns the parsed JSON body or throws on network/HTTP error.
 */
async function callRender(message, options = {}) {
  const url = new URL('/api/chat', RENDER_BASE_URL);
  const body = JSON.stringify({ message, ...options });
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          // Forward Ghost-internal header so Render can optionally gate requests
          'X-Ghost-Internal': 'renderAgent',
        },
        timeout: 60000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          console.log(
            `[renderAgent] Render responded HTTP ${res.statusCode} for task: "${message.substring(0, 80)}"`
          );
          if (res.statusCode >= 400) {
            return reject(
              new Error(`Render HTTP ${res.statusCode}: ${data.substring(0, 200)}`)
            );
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ success: false, text: data });
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Render request timed out after 60s'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Main entry point used by agentAdapter.
 * @param {string} task  – natural language task description
 * @param {string} context – prior results/context string
 */
async function run(task, context = '') {
  const fullMessage = context
    ? `${task}\n\n[Context from Mac orchestrator]:\n${context}`
    : task;

  try {
    const result = await callRender(fullMessage);
    const text = result.text || result.message || JSON.stringify(result);
    return `[Render ✓] ${text}`;
  } catch (err) {
    console.error(`[renderAgent] Delegation failed: ${err.message}`);
    return `[Render ✗] Delegation to Render failed: ${err.message}`;
  }
}

/**
 * Health-check: returns true if Render is reachable.
 */
async function ping() {
  try {
    const res = await callRender('ping');
    return !!(res && res.success !== false);
  } catch {
    return false;
  }
}

/**
 * Whether a given task description should be routed to Render vs. kept local.
 * Called by agentAdapter before routing.
 *
 * Local signals  → false (keep on Mac)
 * Render signals → true  (delegate)
 */
function shouldDelegate(taskDescription) {
  const desc = taskDescription.toLowerCase();

  // Always keep on Mac
  const localSignals = [
    'obsidian', 'vault', 'pm2', 'local file', 'file system', 'read file',
    'write file', 'edit file', 'sysmon', 'system monitor', 'cpu', 'memory usage',
    'mac', 'applescript', 'desktop', 'open app', 'privacy', 'personal',
    'my files', 'local folder', 'workspace',
  ];
  if (localSignals.some((s) => desc.includes(s))) return false;

  // Prefer Render for these
  const renderSignals = [
    'reminder', 'schedule', 'background', 'always on', 'summary', 'stock',
    'weather', 'news', 'web search', 'lookup', 'research', 'translate',
    'recurring', 'daily', 'weekly', 'cron', 'monitor url',
  ];
  if (renderSignals.some((s) => desc.includes(s))) return true;

  // Default: keep local unless explicitly told to delegate
  return false;
}

module.exports = { run, ping, shouldDelegate, callRender };
