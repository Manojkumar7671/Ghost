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

function sanitizeTextSegment(text) {
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
  // Note: Only clean up horizontal whitespace, never cross newlines (\n) or destroy bold markers
  sanitized = sanitized.replace(/\([ \t]*(?:note:?[ \t]*)?\)/gi, '');
  sanitized = sanitized.replace(/\[[ \t]*\]/g, '');
  sanitized = sanitized.replace(/\*[ \t]*\.{1,3}[ \t]*\*/g, '');

  // Normalize multiple horizontal spaces between words while preserving list indentation and markdown tables
  const lines = sanitized.split('\n');
  const cleanedLines = lines.map(line => {
    if (/^\s*\|/.test(line)) return line; // preserve markdown table line formatting
    return line.replace(/([^\s\t\r\n])[ \t]{2,}/g, '$1 ');
  });

  return cleanedLines.join('\n');
}

/**
 * Removes internal status/route labels from user-facing text, logging any found leaks.
 * Preserves newlines, lists, tables, and code fences.
 * @param {string} text
 * @returns {string}
 */
function sanitizeResponseText(text) {
  if (!text || typeof text !== 'string') return typeof text === 'string' ? text : '';

  // Split by markdown fenced code blocks (```...```) to preserve code block content verbatim
  const codeBlockRegex = /(```[\s\S]*?```)/g;
  const parts = text.split(codeBlockRegex);

  const processed = parts.map(part => {
    if (part.startsWith('```') && part.endsWith('```')) {
      return part; // Return code fence verbatim
    }
    return sanitizeTextSegment(part);
  }).join('');

  return processed.trim();
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
