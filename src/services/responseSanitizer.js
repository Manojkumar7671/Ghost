/**
 * src/services/responseSanitizer.js
 * 
 * Response Sanitizer & Anti-Leak Policy for Ghost.
 * Ensures internal routing, telemetry, and fast-path markers are moved to server logs only
 * and never leaked into user-visible chat replies.
 */

const INTERNAL_LEAK_PATTERNS = [
  /Direct fast(?:\s+normal\s+chat\s+completion)?/gi,
  /\[Brain\s+Route\]/gi,
  /\[Brain\s+Fast\s+Path\]/gi,
  /\[Brain\s+Debug\]/gi,
  /\[Brain\s+Routing\s+Fix\]/gi,
  /\[Brain\s+Security\/Scope\s+Boundary\]/gi,
  /\[Brain\s+Hard\s+Cap\]/gi,
  /\[Brain\s+Blocker\]/gi,
  /\[Brain\]/gi,
  /\[LLM\s+Router\]/gi,
  /\[LLM\s+Router\s+Timing\]/gi,
  /\[LLM\s+Router\s+Cooldown\]/gi,
  /\[LLM\s+Router\s+Budget\]/gi,
  /\[Memory\s+Router\]/gi,
  /\[RAG\s+Path\]/gi,
  /\[Real-Time\s+Factual\s+Boundary\]/gi,
  /\[Live\s+Query\s+Search\s+Error\]/gi,
  /\[Live\s+Web\s+Search\s+via\s+Serper\]/gi,
  /\[Server\s+Log\]/gi,
  /\[Startup\s+Warning\]/gi,
  /\[Code\s+Routing\]/gi,
  /\[(?:NOVA|ECHO|ROUTER|ORCHESTRATOR|ADVISOR|ENGINEER|chat\s*➔\s*llm)\]:?/gi,
  /\*Direct fast[^*]*\*/gi,
  /\*.*completion\.\.\.\*/gi,
  /\bcompletion\.\.\./gi,
  // Internal capability names
  /(?:please\s+use\s+(?:the\s+)?)?\bscholarly[-_]dossier\b(?:\s+capability)?/gi,
  // Internal tool names
  /\b(?:workspace_run_command|workspace_edit_file|workspace_view_file|orchestrator_run|stock_quote|knowledge_recall|python_sandbox|browser_automation|deep_research|web_search|web_scrape|email_draft|email_send|notion_search|notion_create|goal_run|self_analyze|memory_save|memory_get|live_data_boundary)\b/gi
];

/**
 * Checks whether a given string contains any internal status/route labels.
 * @param {string} text
 * @returns {boolean}
 */
function hasInternalLeak(text) {
  if (!text || typeof text !== 'string') return false;
  return INTERNAL_LEAK_PATTERNS.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/**
 * Removes internal status/route labels from user-facing text, logging any found leaks.
 * @param {string} text
 * @returns {string}
 */
function sanitizeResponseText(text) {
  if (!text || typeof text !== 'string') return typeof text === 'string' ? text : '';

  let sanitized = text;
  for (const pattern of INTERNAL_LEAK_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      pattern.lastIndex = 0;
      const matches = sanitized.match(pattern);
      if (matches) {
        console.log(`[Server Log Only - Internal Leak Stripped]: "${matches.join('", "')}"`);
      }
      sanitized = sanitized.replace(pattern, '');
    }
  }

  // Clean up empty parentheses, brackets, or notes left behind by stripped terms
  sanitized = sanitized.replace(/\(\s*(?:note:?\s*)?\)/gi, '');
  sanitized = sanitized.replace(/\[\s*\]/g, '');
  sanitized = sanitized.replace(/\*+\s*\.{0,3}\s*\*+\s*/g, '');
  sanitized = sanitized.replace(/[ \t]{2,}/g, ' ').trim();
  return sanitized;
}

/**
 * Filters out internal route/status labels from reasoning actions array,
 * recording them in server logs only.
 * @param {Array} actions
 * @returns {Array}
 */
function sanitizeReasoningSteps(actions) {
  if (!Array.isArray(actions)) return [];

  const safeSteps = [];
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const reasonStr = action.reason || '';
    const toolStr = action.tool || '';

    if (hasInternalLeak(reasonStr) || hasInternalLeak(toolStr) || reasonStr === 'Direct fast normal chat completion') {
      console.log(`[Server Log Only - Internal Routing Label]: tool=${toolStr}, reason="${reasonStr}"`);
      continue;
    }

    safeSteps.push(action);
  }

  return safeSteps;
}

module.exports = {
  INTERNAL_LEAK_PATTERNS,
  hasInternalLeak,
  sanitizeResponseText,
  sanitizeReasoningSteps
};
