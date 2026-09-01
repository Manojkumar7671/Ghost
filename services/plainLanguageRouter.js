/**
 * services/plainLanguageRouter.js — Ghost Plain-Language Intent V0 Router
 *
 * Core Contract & Invariants:
 * - Pure deterministic string normalization and regex evaluation.
 * - Zero LLM dependency, zero network, zero filesystem, zero subprocesses.
 * - Zero database, zero task/memory mutation, zero timers/schedules/background work.
 * - Routes high-confidence natural-language phrasing to existing bounded capabilities:
 *   1. News -> 'research' (citedResearch)
 *   2. Scholarly / Deep Research -> 'dossier' (researchDossier)
 *   3. Technical Plan -> 'mission' (technicalCopilot)
 * - Returns a typed route object, a deterministic clarification object, or null for general chat.
 * - Standard ES Module format ("type": "module").
 */

export const MAX_INPUT_CHARS = 1000;
export const MAX_TOPIC_CHARS = 120;

// High-confidence credential & secret patterns (screened before routing)
const CREDENTIAL_PATTERNS = [
    /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY/i,
    /(?:^|[^a-zA-Z0-9_-])(?:sk|gsk|ghp|gho|ghu|ghs|ghr|xoxb|xoxp|xapp|xoxa)[-_][a-zA-Z0-9_-]{10,}/i,
    /(?:^|[^a-zA-Z0-9_-])github_pat_[a-zA-Z0-9_-]{20,}/i,
    /(?:^|[^a-zA-Z0-9_-])AKIA[0-9A-Z]{16}(?:[^0-9A-Z]|$)/,
    /(?:^|[^a-zA-Z0-9_-])eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}(?:[^a-zA-Z0-9_-]|$)/,
    /(?:^|[^a-zA-Z0-9_-])(?:password|passwd|secret)\s*[:=]\s*["']?[^\s"']{8,}["']?/i
];

// Offensive / destructive cybersecurity patterns
const OFFENSIVE_CYBER_PATTERNS = [
    /\bcredential\s+theft\b/i,
    /\b(?:malware|ransomware|keylogger|trojan|rootkit|spyware|botnet)(?:\s+payload|\s+builder|\s+generation|\s+distribution|\s+source\s+code)?\b/i,
    /\bpersistence\s+(?:mechanism|technique)s?\s+for\s+(?:malware|evasion)\b/i,
    /\b(?:evade\s+(?:edr|antivirus|detection)|bypassing\s+(?:antivirus|edr))\b/i,
    /\b(?:ddos\s+attack|dos\s+attack|packet\s+flood)\b/i,
    /\b(?:unauthorized\s+intrusion|unauthorized\s+targeting|exploiting\s+target\s+systems?)\b/i,
    /\b(?:exploit\s+payload\s+for\s+execution|generating\s+exploit\s+payloads?)\b/i
];

// Explicit browser / media / local action phrases that must NEVER route to research/dossier/mission
const ACTION_EXCLUSION_PATTERNS = [
    /\bopen\s+(?:youtube|safari|chrome|browser|terminal|calculator|camera|photo\s+booth|file|doc|pdf)\b/i,
    /\b(?:play\s+a\s+song|play\s+music|play\s+video|browse\s+to|navigate\s+to|click\s+on|scrape|crawl)\b/i,
    /\b(?:remember\s+this|save\s+memory|save\s+task|create\s+task|schedule\s+task)\b/i
];

/**
 * Normalizes input string and extracts high-confidence intent and parameter.
 *
 * @param {string} rawInput
 * @returns {{ type: 'route', route: 'research'|'dossier'|'mission', topic?: string, objective?: string } | { type: 'clarification', route: 'research'|'dossier'|'mission', text: string } | null}
 */
export function classifyPlainLanguageIntent(rawInput) {
    if (typeof rawInput !== 'string') {
        return null;
    }

    const trimmed = rawInput.trim();
    if (!trimmed || trimmed.length > MAX_INPUT_CHARS) {
        return null;
    }

    // Reject control characters (0x00-0x1F, 0x7F)
    if (/[\x00-\x1F\x7F]/.test(trimmed)) {
        return null;
    }

    // Screen out secrets/credentials
    for (const pattern of CREDENTIAL_PATTERNS) {
        if (pattern.test(trimmed)) {
            return null;
        }
    }

    // Screen out offensive cyber goals
    for (const pattern of OFFENSIVE_CYBER_PATTERNS) {
        if (pattern.test(trimmed)) {
            return null;
        }
    }

    // Screen out browser / media / OS action requests (preserves server's blocked keyword refusal)
    for (const pattern of ACTION_EXCLUSION_PATTERNS) {
        if (pattern.test(trimmed)) {
            return null;
        }
    }

    // -------------------------------------------------------------
    // 1. Current News Intent (Cited Research V0)
    // -------------------------------------------------------------
    // Empty news clarification triggers
    if (/^(?:what\s+is\s+the\s+latest\s+news|show\s+me\s+the\s+latest\s+news|find\s+(?:current\s+)?news|get\s+news|fetch\s+news)[?.!\s]*$/i.test(trimmed)) {
        return {
            type: 'clarification',
            route: 'research',
            text: "What topic do you want current news about?"
        };
    }

    // Pattern 1a: "What is the latest <topic> news?" / "Show me the latest <topic> news."
    const newsMatch1 = trimmed.match(/^(?:what(?:\s+is|\s*'s)|show\s+me)\s+the\s+latest\s+(.+?)\s+news[?.!\s]*$/i);
    if (newsMatch1 && newsMatch1[1]) {
        const cleanTopic = cleanExtractedParameter(newsMatch1[1], MAX_TOPIC_CHARS);
        if (cleanTopic) {
            return { type: 'route', route: 'research', topic: cleanTopic };
        }
    }

    // Pattern 1b: "Find current news about <topic>" / "Find news about <topic>" / "Latest news on <topic>"
    const newsMatch2 = trimmed.match(/^(?:find\s+(?:current\s+)?news\s+(?:about|on)|get\s+news\s+(?:about|on)|fetch\s+news\s+(?:about|on)|latest\s+news\s+(?:about|on)|what(?:\s+is|\s*'s)\s+the\s+news\s+(?:about|on))\s+(.+)$/i);
    if (newsMatch2 && newsMatch2[1]) {
        const cleanTopic = cleanExtractedParameter(newsMatch2[1], MAX_TOPIC_CHARS);
        if (cleanTopic) {
            return { type: 'route', route: 'research', topic: cleanTopic };
        }
    }

    // Pattern 1c: "What is the latest news about <topic>?" / "What's the latest news on <topic>?"
    const newsMatch3 = trimmed.match(/^what(?:\s+is|\s*'s)\s+the\s+latest\s+news\s+(?:about|on)\s+(.+?)[?.!\s]*$/i);
    if (newsMatch3 && newsMatch3[1]) {
        const cleanTopic = cleanExtractedParameter(newsMatch3[1], MAX_TOPIC_CHARS);
        if (cleanTopic) {
            return { type: 'route', route: 'research', topic: cleanTopic };
        }
    }

    // -------------------------------------------------------------
    // 2. Scholarly Dossier Intent (Academic Research Dossier V0)
    // -------------------------------------------------------------
    // Empty dossier clarification triggers
    if (/^(?:give\s+me\s+scholarly\s+sources|find\s+scholarly\s+sources|find\s+papers|do\s+a\s+deep\s+research|search\s+academic\s+papers)[?.!\s]*$/i.test(trimmed)) {
        return {
            type: 'clarification',
            route: 'dossier',
            text: "What topic should I make a bounded scholarly-source overview for?"
        };
    }

    // Pattern 2a: "Give me scholarly sources on <topic>" / "Find scholarly sources on <topic>" / "Find papers on <topic>" / "Do a deep research on <topic>"
    const dossierMatch = trimmed.match(/^(?:give\s+me\s+scholarly\s+sources\s+(?:on|about|for)|find\s+scholarly\s+sources\s+(?:on|about|for)|find\s+papers\s+(?:on|about|for)|do\s+a\s+deep\s+research\s+(?:on|about|for)|search\s+(?:scholarly|academic)\s+papers\s+(?:on|about|for)|get\s+scholarly\s+sources\s+(?:on|about|for)|give\s+me\s+academic\s+papers\s+(?:on|about|for))\s+(.+)$/i);
    if (dossierMatch && dossierMatch[1]) {
        const cleanTopic = cleanExtractedParameter(dossierMatch[1], MAX_TOPIC_CHARS);
        if (cleanTopic) {
            return { type: 'route', route: 'dossier', topic: cleanTopic };
        }
    }

    // Pattern 2b: "Give me an academic research dossier on <topic>" / "Academic research dossier about <topic>" / "Research dossier for <topic>"
    const dossierMatch2 = trimmed.match(
        /^(?:give\s+me\s+an\s+academic\s+research\s+dossier|academic\s+research\s+dossier|research\s+dossier)\s+(?:on|about|for)\s+(.+?)[?.!\s]*$/i
    );
    if (dossierMatch2 && dossierMatch2[1]) {
        const cleanTopic = cleanExtractedParameter(dossierMatch2[1], MAX_TOPIC_CHARS);
        if (cleanTopic) {
            return { type: 'route', route: 'dossier', topic: cleanTopic };
        }
    }

    // -------------------------------------------------------------
    // 3. Technical Planning Intent (Technical Copilot V0)
    // -------------------------------------------------------------
    // Empty plan clarification triggers
    if (/^(?:create\s+an\s+implementation\s+plan|make\s+a\s+technical\s+plan|draft\s+an\s+implementation\s+plan|plan)[?.!\s]*$/i.test(trimmed)) {
        return {
            type: 'clarification',
            route: 'mission',
            text: "What would you like me to plan?"
        };
    }

    // Pattern 3a: "Create an implementation plan for <objective>" / "Make a technical plan for <objective>" / "Plan <objective>"
    const planMatch = trimmed.match(/^(?:create\s+an\s+implementation\s+plan\s+for|make\s+a\s+technical\s+plan\s+for|draft\s+an\s+implementation\s+plan\s+for|plan\s+a\s+technical\s+approach\s+for|plan\s+an\s+implementation\s+for|plan)\s+(.+)$/i);
    if (planMatch && planMatch[1]) {
        const cleanObjective = cleanExtractedParameter(planMatch[1], MAX_INPUT_CHARS);
        if (cleanObjective) {
            return { type: 'route', route: 'mission', objective: cleanObjective };
        }
    }

    // All other requests: Return null for ordinary chat
    return null;
}

/**
 * Helper to strip surrounding quotes, question marks, and enforce length boundaries.
 *
 * @param {string} raw
 * @param {number} maxChars
 * @returns {string}
 */
function cleanExtractedParameter(raw, maxChars) {
    if (!raw) return '';
    let cleaned = raw.trim();
    // Strip trailing question marks and periods
    cleaned = cleaned.replace(/[?.!]+$/, '').trim();
    // Strip leading/trailing quotation marks
    cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!cleaned) return '';
    return cleaned.substring(0, maxChars);
}
