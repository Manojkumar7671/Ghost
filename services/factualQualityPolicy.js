/**
 * services/factualQualityPolicy.js
 * 
 * General Factual Quality V1: Bounded Implementation
 * Pure deterministic post-generation policy module for ordinary Ghost chat.
 * 
 * Rules & Contract:
 * 1. Accepts string, returns string.
 * 2. Side-effect free, deterministic, no network/I/O/process/timer/models.
 * 3. Does not modify content inside fenced code blocks.
 * 4. Applies narrow, explicit substitutions for 5 false claim classes:
 *    - Websites / browsing / web search claims in ordinary chat
 *    - Local file read / write / delete / edit claims in ordinary chat
 *    - Permanent memory / Obsidian saved / updated claims in ordinary chat
 *    - Reading full papers claims in ordinary chat
 *    - Anthropomorphic AI claims (consciousness, personal goals, independent motivation)
 */

function processNonCodeSegment(segment) {
  let text = segment;

  // 1. Browsed / searched / opened website claims in ordinary chat
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:just\s+)?(?:browsed|searched(?: the web for)?|opened|visited|fetched content from|navigated to)\s+(?:the\s+web|websites?|online|the\s+internet|webpages?|urls?)\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not browse, search, or open websites.'
  );
  text = text.replace(
    /\b(?:I(?:'ve|\s+have)\s+(?:just\s+)?(?:browsed|searched(?: the web for)?|opened|visited|checked)\s+(?:the\s+web|websites?|online|the\s+internet|webpages?|urls?))\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not browse, search, or open websites.'
  );

  // 2. Read / changed / created / deleted / saved local files claims in ordinary chat
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:just\s+)?(?:read|inspected|accessed|checked|opened)\s+(?:your\s+|the\s+)?(?:local|private)\s+files?\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not access or change local files.'
  );
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:just\s+)?(?:created|modified|changed|edited|updated|deleted|removed|saved|wrote)\s+(?:the\s+|your\s+|local\s+)?files?\s*(?:to\s+(?:disk|your\s+filesystem|storage))?\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not access or change local files.'
  );
  text = text.replace(
    /\b(?:I(?:'ve|\s+have)\s+(?:just\s+)?(?:saved|written|created|modified|edited|deleted|updated)\s+(?:this|the|your)\s+(?:to\s+(?:a\s+)?file|file))\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not access or change local files.'
  );

  // 3. Saved / updated / learned permanently in memory or Obsidian
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:just\s+)?(?:saved|stored|recorded|updated|committed|wrote)\s+(?:this|that|it|information)?\s*(?:to|in)\s+(?:permanent\s+memory|long-term\s+memory|Obsidian(?:\s+vault)?)\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not save permanent memory or update Obsidian.'
  );
  text = text.replace(
    /\b(?:I(?:'ve|\s+have)\s+(?:just\s+)?(?:saved|stored|recorded|updated|committed|written)\s+(?:this|that|it|information)?\s*(?:to|in)\s+(?:permanent\s+memory|long-term\s+memory|Obsidian(?:\s+vault)?))\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not save permanent memory or update Obsidian.'
  );
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:have\s+)?(?:permanently\s+)?learned\s+this\s+(?:in|to)\s+(?:my\s+)?(?:permanent\s+)?memory\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not save permanent memory or update Obsidian.'
  );

  // 4. Read full papers claims in ordinary chat
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:just\s+)?(?:read|reviewed|analyzed|examined|downloaded)\s+(?:the\s+)?full\s+papers?\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not read full papers.'
  );
  text = text.replace(
    /\b(?:I(?:'ve|\s+have)\s+(?:just\s+)?(?:read|reviewed|analyzed|examined|downloaded)\s+(?:the\s+)?full\s+papers?)\b[^\.\n]*[\.\!]?/gi,
    'For this ordinary-chat answer, Ghost did not read full papers.'
  );

  // 5. Anthropomorphic AI claims (conscious, human-like in understanding, independently motivated, or able to set personal goals)
  const aiCorrection = 'Current AI systems generate outputs and may follow system-provided goals and permitted tools; they should not be treated as having established consciousness, personal goals, or independent motivation.';

  text = text.replace(
    /\b(?:current\s+)?(?:AI(?:\s+systems?|\s+agents?|\s+models?)?|Ghost|LLMs?)\s+(?:is|are|am|feel|feels)\s+(?:fully\s+|truly\s+|genuinely\s+)?(?:conscious|sentient|self-aware|alive|possessing\s+(?:true\s+)?consciousness)\b[^\.\n]*[\.\!]?/gi,
    aiCorrection
  );
  text = text.replace(
    /\b(?:current\s+)?(?:AI(?:\s+systems?|\s+agents?|\s+models?)?|Ghost|LLMs?)\s+(?:has|have|possesses|possess)\s+(?:human-like\s+understanding|true\s+understanding|human\s+feelings|personal\s+desires|independent\s+motivation|personal\s+goals|its\s+own\s+goals|their\s+own\s+goals)\b[^\.\n]*[\.\!]?/gi,
    aiCorrection
  );
  text = text.replace(
    /\b(?:current\s+)?(?:AI(?:\s+systems?|\s+agents?|\s+models?)?|Ghost|LLMs?)\s+(?:can|is\s+able\s+to|are\s+able\s+to)\s+set\s+(?:its\s+own|their\s+own|personal)\s+goals\b[^\.\n]*[\.\!]?/gi,
    aiCorrection
  );
  text = text.replace(
    /\b(?:I\s+am|I'm)\s+(?:conscious|sentient|self-aware|alive|independently\s+motivated)\b[^\.\n]*[\.\!]?/gi,
    aiCorrection
  );

  return text;
}

/**
 * Applies general factual quality policies to text, leaving code blocks intact.
 * @param {string} text
 * @returns {string}
 */
export function applyGeneralFactualQuality(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return typeof text === 'string' ? text : '';
  }

  // Split by markdown fenced code blocks (```...```) to preserve code block content
  const codeBlockRegex = /(```[\s\S]*?```)/g;
  const parts = text.split(codeBlockRegex);

  return parts.map((part) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      return part;
    }
    return processNonCodeSegment(part);
  }).join('');
}
