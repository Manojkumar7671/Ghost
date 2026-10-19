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
  /\[Memory\s+Router\]/gi,
  /\[RAG\s+Path\]/gi,
  /\[Real-Time\s+Factual\s+Boundary\]/gi,
  /\[Live\s+Query\s+Search\s+Error\]/gi,
  /\*Direct fast[^*]*\*/gi,
  /\*.*completion\.\.\.\*/gi,
  /\bcompletion\.\.\./gi
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

  // Clean up any remaining leading/trailing whitespace, orphan asterisks or empty italic markers like *...*
  sanitized = sanitized.replace(/\*+\s*\.{0,3}\s*\*+\s*/g, '').trim();
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
