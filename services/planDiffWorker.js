import { inspectRepo } from './repoInspector.js';
import { callLLM } from '../llmRouter.js';

/**
 * services/planDiffWorker.js — Hermes-Inspired Plan/Diff Worker V1
 *
 * Core contract:
 * Ghost may explain a proposed plan and draft a file-by-file change preview.
 * It must NOT change files, execute commands, run tests, start processes,
 * deploy, commit, push, inspect secrets, or call external services.
 *
 * Fixed safety status:
 * PLAN ONLY — NO FILES CHANGED — NO COMMANDS EXECUTED — APPROVAL REQUIRED FOR ANY FUTURE EDIT OR TEST
 */

export const SAFETY_NOTICE = "PLAN ONLY — NO FILES CHANGED — NO COMMANDS EXECUTED — APPROVAL REQUIRED FOR ANY FUTURE EDIT OR TEST";
export const DISCLAIMER = "Future edits and tests will require a separate, explicit owner approval workflow. This draft did not perform any action.";
export const FIXED_STATUS = "PLAN_ONLY";

export const MAX_INPUT_CHARS = 2000;
export const MAX_PLAN_STEPS = 8;
export const MAX_PROPOSED_FILES = 5;
export const MAX_PREVIEW_CHARS = 2000;

/**
 * Helper to safely extract JSON object from LLM output string.
 */
function extractJsonObject(raw) {
    if (!raw || typeof raw !== 'string') return null;

    // 1. Direct JSON parse
    try {
        const parsed = JSON.parse(raw.trim());
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}

    // 2. Markdown fence extraction
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
    if (fenceMatch) {
        try {
            const parsed = JSON.parse(fenceMatch[1].trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {}
    }

    // 3. First balanced curly braces object
    const startIdx = raw.indexOf('{');
    const endIdx = raw.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
        try {
            const parsed = JSON.parse(raw.substring(startIdx, endIdx + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {}
    }

    return null;
}

/**
 * Sanitizes and enforces safety boundaries on proposed text strings.
 */
function sanitizeText(str, maxLen = 500) {
    if (typeof str !== 'string') return '';
    let cleaned = str
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .trim();
    if (cleaned.length > maxLen) {
        cleaned = cleaned.slice(0, maxLen) + '... (truncated)';
    }
    return cleaned;
}

/**
 * Generate a deterministic safe fallback plan when model is unavailable or malformed.
 */
export function buildDeterministicFallbackPlan(taskPrompt, verifiedFiles = []) {
    const safeSummary = sanitizeText(taskPrompt, 200) || "Plan technical task";
    const sampleFiles = Array.isArray(verifiedFiles) && verifiedFiles.length > 0
        ? verifiedFiles.slice(0, 3).map(filePath => ({
            path: filePath,
            pathStatus: "verified path",
            reason: "Verified existing repository file relevant for task analysis",
            preview: `// Planned modifications for ${filePath}\n// Pending detailed model availability\n- [Current State]\n+ [Target Specification]`
        }))
        : [];

    return {
        success: true,
        taskSummary: `Draft plan for: ${safeSummary}`,
        assumptions: [
            "Read-only planning mode active — zero external file writes or commands permitted.",
            "Plan requires review before any future implementation attempt.",
            "All proposed file paths must be verified against repository boundaries."
        ],
        planSteps: [
            "1. Review task requirements and architectural constraints.",
            "2. Identify target files and interfaces in local repository.",
            "3. Draft incremental change preview once planning model is available."
        ],
        proposedFiles: sampleFiles,
        risks: [
            "Detailed planning model response was unavailable; generated deterministic safe outline.",
            "No files were modified, created, or tested in this workspace."
        ],
        status: FIXED_STATUS,
        safetyNotice: SAFETY_NOTICE,
        disclaimer: DISCLAIMER,
        isFallback: true
    };
}

/**
 * Main plan-draft generation worker.
 *
 * @param {string} taskPrompt - The user's coding task description.
 * @param {object} options - Optional parameters { targetPath, timeoutMs }.
 * @returns {Promise<object>} Structured, validated plan draft.
 */
export async function generatePlanDraft(taskPrompt, options = {}) {
    // 1. Input Validation & Bounding
    if (!taskPrompt || typeof taskPrompt !== 'string' || !taskPrompt.trim()) {
        return {
            success: false,
            error: "Task description cannot be empty.",
            status: FIXED_STATUS,
            safetyNotice: SAFETY_NOTICE,
            disclaimer: DISCLAIMER
        };
    }

    const trimmedInput = taskPrompt.trim();
    const boundedInput = trimmedInput.length > MAX_INPUT_CHARS
        ? trimmedInput.slice(0, MAX_INPUT_CHARS)
        : trimmedInput;

    // 2. Safely Retrieve Bounded Repository Context
    let verifiedFileList = [];
    try {
        const repoSummary = await inspectRepo(options.targetPath || null, {
            maxDepth: 4,
            maxFiles: 50,
            maxTimeMs: 1500
        });
        if (repoSummary && repoSummary.success && Array.isArray(repoSummary.entryPoints)) {
            verifiedFileList = repoSummary.entryPoints.map(ep => typeof ep === 'string' ? ep : (ep && ep.path ? ep.path : '')).filter(Boolean);
        }
    } catch (e) {
        // Non-fatal: Proceed without verified context
    }

    const verifiedFileSet = new Set(verifiedFileList.map(f => (typeof f === 'string' ? f : '').toLowerCase()).filter(Boolean));

    // 3. Construct Hermes-style Structured Planning Prompt
    const systemPrompt = `You are Ghost Plan/Diff Worker V1, a specialized read-only architecture planner inspired by Hermes.
Your job is to provide a structured, file-by-file implementation plan and diff preview for a coding task.

STRICT CONSTRAINTS:
1. You are in READ-ONLY PLANNING MODE.
2. DO NOT claim that files were created, edited, executed, or tested.
3. DO NOT output execution logs, simulated shell outputs, or fake test results.
4. Output MUST be a single valid JSON object with NO preamble or trailing commentary.

JSON SCHEMA:
{
  "taskSummary": "Concise interpretation of the task (max 300 chars)",
  "assumptions": ["List of 2-4 key assumptions or constraints"],
  "planSteps": ["List of 3-6 sequential step descriptions"],
  "proposedFiles": [
    {
      "path": "relative/path/to/file.ext",
      "reason": "Why this file changes (max 200 chars)",
      "preview": "Unified diff format preview: --- file.ext\\n+++ file.ext\\n@@ ... @@\\n- old\\n+ new"
    }
  ],
  "risks": ["List of 1-3 risks or edge cases to consider"]
}`;

    const contextSnippet = verifiedFileList.length > 0
        ? `\nVerified Existing Repository Files (sample):\n${verifiedFileList.slice(0, 20).join('\n')}\n`
        : '';

    const userMessage = `Coding Task:\n${boundedInput}\n${contextSnippet}\nGenerate the structured implementation plan and diff preview in pure JSON format:`;

    // 4. Call LLM Router with defensive timeout
    let rawOutput = '';
    try {
        rawOutput = await callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ], {
            systemPrompt,
            maxTokens: 2048,
            temperature: 0.2
        });
    } catch (err) {
        console.warn('[PlanDiffWorker] LLM call failed, returning deterministic safe fallback:', err.message || err);
        return buildDeterministicFallbackPlan(boundedInput, verifiedFileList);
    }

    // 5. Defensive Parsing & Schema Validation
    const parsed = extractJsonObject(rawOutput);
    if (!parsed) {
        console.warn('[PlanDiffWorker] Failed to parse JSON from LLM output, using deterministic fallback.');
        return buildDeterministicFallbackPlan(boundedInput, verifiedFileList);
    }

    // Task Summary
    const taskSummary = sanitizeText(parsed.taskSummary || `Plan for: ${boundedInput.slice(0, 100)}`, 300);

    // Assumptions
    let assumptions = Array.isArray(parsed.assumptions)
        ? parsed.assumptions.map(a => sanitizeText(a, 300)).filter(Boolean).slice(0, 6)
        : [];
    if (assumptions.length === 0) {
        assumptions = [
            "Read-only planning mode — no files will be modified without explicit owner approval.",
            "All dependencies and target environments must be verified prior to implementation."
        ];
    }

    // Plan Steps
    let planSteps = Array.isArray(parsed.planSteps)
        ? parsed.planSteps.map(s => sanitizeText(s, 400)).filter(Boolean).slice(0, MAX_PLAN_STEPS)
        : [];
    if (planSteps.length === 0) {
        planSteps = [
            "1. Analyze requirements and target codebase structure.",
            "2. Define interfaces and module boundaries.",
            "3. Draft incremental change diffs for review."
        ];
    }

    // Proposed Files & Diffs
    let proposedFiles = [];
    if (Array.isArray(parsed.proposedFiles)) {
        for (const fileObj of parsed.proposedFiles.slice(0, MAX_PROPOSED_FILES)) {
            if (fileObj && typeof fileObj === 'object') {
                const rawPath = sanitizeText(fileObj.path || 'suggested_change.js', 150);
                const isVerified = verifiedFileSet.has(rawPath.toLowerCase());
                const pathStatus = isVerified ? "verified path" : "suggested path — not verified";
                const reason = sanitizeText(fileObj.reason || "Component update for task implementation", 250);
                const preview = sanitizeText(fileObj.preview || `--- ${rawPath}\n+++ ${rawPath}\n@@ proposed diff @@`, MAX_PREVIEW_CHARS);

                proposedFiles.push({
                    path: rawPath,
                    pathStatus,
                    reason,
                    preview
                });
            }
        }
    }

    // Risks
    let risks = Array.isArray(parsed.risks)
        ? parsed.risks.map(r => sanitizeText(r, 300)).filter(Boolean).slice(0, 6)
        : [];
    if (risks.length === 0) {
        risks = [
            "Review diff previews carefully before any future approval workflow.",
            "No automated tests or file operations were run during this planning phase."
        ];
    }

    // 6. Return Verified Plan-Only Contract
    return {
        success: true,
        taskSummary,
        assumptions,
        planSteps,
        proposedFiles,
        risks,
        status: FIXED_STATUS,
        safetyNotice: SAFETY_NOTICE,
        disclaimer: DISCLAIMER,
        isFallback: false
    };
}
