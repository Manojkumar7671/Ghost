/**
 * services/capabilityCatalog.js — Ghost Skills V0 Capability Catalog
 *
 * Core Contract & Invariants:
 * - Pure synchronous ESM module ("type": "module"), deterministic and side-effect free.
 * - Exactly two named exports: `isCapabilityQuery` and `getCapabilitiesHelp`. Zero default export.
 * - Zero imports; zero external dependencies.
 * - Zero network, fetch/axios, filesystem, child processes, shell execution,
 *   timers, environment access, model calls, database, task, memory, global state, or logging.
 * - Truthfully maps current source-proven bounded surfaces with their hard non-negotiable boundaries:
 *   1. General chat (conversational reasoning; no external actions).
 *   2. Cited news research (Google News RSS headlines/metadata; no full-article reading).
 *   3. Academic research dossier (OpenAlex records/abstracts; no full papers/PDFs; no permanent learning).
 *   4. Technical copilot planning (structured blueprints; PLAN ONLY — NO LOCAL WRITES).
 */

const CAPABILITY_QUERY_REGEX = /^(?:what\s+can\s+you\s+do\??|what\s+are\s+your\s+skills\??|what\s+skills\s+do\s+you\s+have\??|show\s+your\s+capabilities\??|list\s+your\s+skills\??|capabilities\??|help\s+me\s+choose\s+what\s+you\s+can\s+do\??)$/i;

const CAPABILITIES_HELP_TEXT = `# Ghost Capabilities & Skills Overview

Here is what Ghost can do in ordinary chat and how to use each safe, bounded capability:

### 1. General Chat & Reasoning
- **Usage:** Ask any direct reasoning, coding explanation, conceptual, or conversational question.
- **Scope:** In-session discussion, brainstorming, and code analysis.
- **Limit:** Broad reasoning only; no external action authority.

### 2. Cited News Research
- **Usage:** \`research <topic>\` (e.g. \`research artificial intelligence\`)
- **Scope:** Retrieves up to 5 cited news headlines and source links via Google News RSS metadata.
- **Limit:** Bounded feed metadata only. Ghost does not open websites, browse pages, or read full article texts.

### 3. Academic Research Dossier
- **Usage:** \`dossier <topic>\` (e.g. \`dossier quantum computing\`)
- **Scope:** Retrieves up to 5 scholarly publication records, authors, venues, and abstract excerpts from OpenAlex.
- **Limit:** Bounded registry and abstract metadata only. Ghost does not download or read full papers or PDFs, and this is not permanent learning.

### 4. Technical Copilot Planning
- **Usage:** \`mission <objective>\` (e.g. \`mission design authentication api\`)
- **Scope:** Generates a structured architectural blueprint, scope assumptions, work breakdown, and review questions.
- **Limit:** **PLAN ONLY — NO LOCAL WRITES**. Ghost does not inspect or modify local files, execute code or commands, run tests, or deploy applications.

---
*For this bounded response, Ghost did not browse websites, open linked pages, read full papers, access or modify local files, execute commands, or save permanent memory.*`;

/**
 * Checks whether an incoming user message is an exact direct capability question.
 *
 * @param {any} message
 * @returns {boolean}
 */
export function isCapabilityQuery(message) {
  if (typeof message !== 'string') {
    return false;
  }
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    return false;
  }
  return CAPABILITY_QUERY_REGEX.test(trimmed);
}

/**
 * Returns the immutable static capability catalog markdown string.
 *
 * @returns {string}
 */
export function getCapabilitiesHelp() {
  return CAPABILITIES_HELP_TEXT;
}
