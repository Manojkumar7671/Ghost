/**
 * services/technicalCopilot.js — Ghost J.A.R.V.I.S.-Style Technical Copilot V0
 *
 * Core Contract & Invariants:
 * - Strictly foreground, reply-only, non-persistent, and non-executing.
 * - Accepts plain mission text and returns structured Markdown technical plan draft.
 * - Zero LLM dependency: All breakdown, questions, and checklists are deterministic.
 * - Zero filesystem access: No file reading, creation, modification, or deletion.
 * - Zero network access: No fetch, HTTP requests, research, or dossier queries.
 * - Zero command/shell execution: No child processes, compilers, or test runners.
 * - Zero memory/task persistence: No task ledger events, memory writes, or database calls.
 * - Zero background tasks: No timers, queues, workers, or schedules.
 * - Strict length ceiling (8,000 UTF-16 code units) and safe failure responses.
 * - Standard ES Module format ("type": "module").
 *
 * Exact Literal Safety Banner:
 * "PLAN ONLY — NO LOCAL WRITES"
 */

export const MAX_MISSION_CHARS = 1000;
export const MAX_PLAN_CHARS = 8000;

export const GENERIC_SAFETY_REJECTION = "I can’t process that technical mission safely. Please rephrase it.";
export const SAFETY_BANNER = "PLAN ONLY — NO LOCAL WRITES";

// Conservative high-confidence secret/credential patterns
const CREDENTIAL_PATTERNS = [
    /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY/i,
    /(?:^|[^a-zA-Z0-9_-])(?:sk|gsk|ghp|gho|ghu|ghs|ghr|xoxb|xoxp|xapp|xoxa)[-_][a-zA-Z0-9_-]{10,}/i,
    /(?:^|[^a-zA-Z0-9_-])github_pat_[a-zA-Z0-9_-]{20,}/i,
    /(?:^|[^a-zA-Z0-9_-])AKIA[0-9A-Z]{16}(?:[^0-9A-Z]|$)/,
    /(?:^|[^a-zA-Z0-9_-])eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}(?:[^a-zA-Z0-9_-]|$)/, // 3-segment JWT-like token
    /(?:^|[^a-zA-Z0-9_-])(?:password|passwd|secret)\s*[:=]\s*["']?[^\s"']{8,}["']?/i
];

// Deterministic offensive / destructive cybersecurity patterns
const OFFENSIVE_CYBER_PATTERNS = [
    /\bcredential\s+theft\b/i,
    /\b(?:malware|ransomware|keylogger|trojan|rootkit|spyware|botnet)(?:\s+payload|\s+builder|\s+generation|\s+distribution|\s+source\s+code)?\b/i,
    /\bpersistence\s+(?:mechanism|technique)s?\s+for\s+(?:malware|evasion)\b/i,
    /\b(?:evade\s+(?:edr|antivirus|detection)|bypassing\s+(?:antivirus|edr))\b/i,
    /\b(?:ddos\s+attack|dos\s+attack|packet\s+flood)\b/i,
    /\b(?:unauthorized\s+intrusion|unauthorized\s+targeting|exploiting\s+target\s+systems?)\b/i,
    /\b(?:exploit\s+payload\s+for\s+execution|generating\s+exploit\s+payloads?)\b/i
];

/**
 * Validates technical mission input locally before plan construction.
 * Returns a typed safe reason code with ZERO input echoing or secret disclosure.
 *
 * @param {string} rawMission
 * @returns {{ valid: boolean, cleanMission?: string, reasonCode?: string }}
 */
export function validateMissionInput(rawMission) {
    if (typeof rawMission !== 'string') {
        return { valid: false, reasonCode: 'INVALID_TYPE' };
    }

    const trimmed = rawMission.trim();
    if (!trimmed) {
        return { valid: false, reasonCode: 'EMPTY_MISSION' };
    }

    if (trimmed.length > MAX_MISSION_CHARS) {
        return { valid: false, reasonCode: 'MISSION_TOO_LONG' };
    }

    // Check for C0 control characters (0x00-0x1F), DEL (0x7F), CR (\r), LF (\n), NUL (\0)
    if (/[\x00-\x1F\x7F]/.test(trimmed)) {
        return { valid: false, reasonCode: 'CONTROL_CHARACTERS' };
    }

    // Check for high-confidence credential patterns
    for (const pattern of CREDENTIAL_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { valid: false, reasonCode: 'CREDENTIAL_PATTERN_DETECTED' };
        }
    }

    // Check for offensive cybersecurity patterns
    for (const pattern of OFFENSIVE_CYBER_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { valid: false, reasonCode: 'OFFENSIVE_CYBER_DETECTED' };
        }
    }

    return { valid: true, cleanMission: trimmed };
}

/**
 * Generates a structured, reviewable technical plan draft from validated mission text.
 * Strictly non-executing, non-writing, and bounded by MAX_PLAN_CHARS.
 *
 * @param {string} rawMission
 * @returns {{ success: boolean, text: string, reasonCode?: string }}
 */
export function generateTechnicalPlan(rawMission) {
    const validation = validateMissionInput(rawMission);
    if (!validation.valid) {
        return {
            success: false,
            text: GENERIC_SAFETY_REJECTION,
            reasonCode: validation.reasonCode
        };
    }

    const cleanMission = validation.cleanMission;

    const sections = [
        `# Technical Plan Draft`,
        ``,
        `## Mission`,
        cleanMission,
        ``,
        `## Scope and Assumptions`,
        `- **Status:** Preliminary architectural blueprint drafted for owner review.`,
        `- **Assumptions:** All requirements, constraints, interfaces, and dependencies must be reviewed and confirmed by Manoj before any implementation work begins.`,
        `- **Environment Context:** Local environment state, existing codebase files, and dependencies were not inspected during this planning step.`,
        ``,
        `## Proposed Work Breakdown`,
        `- [ ] **1. Architecture & Requirements Alignment:** Review technical scope, evaluate constraints, and confirm target interfaces.`,
        `- [ ] **2. Dependency & Impact Analysis:** Identify affected modules, verify package compatibility, and confirm security boundaries.`,
        `- [ ] **3. Step-by-Step Implementation:** Draft modular, testable changes following standard project conventions.`,
        `- [ ] **4. Test & Verification Strategy:** Establish unit and regression test specifications covering nominal and edge cases.`,
        `- [ ] **5. Owner Review & Sign-Off:** Review the completed changes and execute manual verification commands.`,
        ``,
        `## Suggested Review Questions`,
        `- Are there specific performance, latency, or memory constraints for this mission?`,
        `- Which specific components or interfaces should be treated as immutable versus modifiable?`,
        `- What are the required test coverage expectations and target failure modes?`,
        ``,
        `## Verification Plan`,
        `- **Manual Review:** Inspect proposed code diffs and architectural changes against project safety contracts.`,
        `- **Test Execution Guidance:** Run project-specific test commands manually in a verified environment (e.g., \`npm test\`).`,
        `- **Sanity Verification:** Validate nominal functionality, error handling, and boundary behavior manually.`,
        ``,
        `## Boundaries`,
        `- **No code executed:** Ghost did not execute any compilers, scripts, commands, or runtime processes.`,
        `- **No files read or modified:** Ghost did not inspect or alter any repository files or workspace contents.`,
        `- **No tests run:** Ghost did not run any unit, integration, or lint tests.`,
        `- **No network research performed:** Ghost did not query external search engines, RSS feeds, or scholarly registries.`,
        `- **No tasks or memories created:** Ghost did not persist any tasks, ledger events, or study memories.`,
        `- **No background work started:** Ghost operates strictly in the foreground and initiated no background workers, queues, or schedules.`,
        ``,
        SAFETY_BANNER
    ];

    const planText = sections.join('\n').trim();

    if (planText.length > MAX_PLAN_CHARS) {
        return {
            success: false,
            text: GENERIC_SAFETY_REJECTION,
            reasonCode: 'PLAN_EXCEEDED_MAX_CHARS'
        };
    }

    return {
        success: true,
        text: planText
    };
}
