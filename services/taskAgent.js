import crypto from 'crypto';
import {
    listPersonalTasks,
    listPersonalGoals,
    listPersonalTaskEvents,
    getPersonalOverview,
    appendPersonalTaskEvent,
    isPotentialSecret,
    SECRET_REJECTION_MESSAGE
} from './personalCore.js';
import { callLLM } from '../llmRouter.js';

/**
 * services/taskAgent.js — Ghost Agent V0.1 Grounded Task Proposal & Explicit Feedback Service
 *
 * Core contract:
 * Ghost Agent V0.1 is an observer and planner, NOT an executor.
 * It reads an authenticated owner's selected Task Ledger item, analyzes approved
 * Personal Core context, resolves immutable blocker history, and produces a structured,
 * grounded proposal for the next action.
 *
 * SAFETY CONTRACT:
 * - NO file modifications, creation, or deletion.
 * - NO shell command execution, tests, child processes, or external API calls.
 * - NO background workers, schedulers, leases, or autonomous loops.
 * - NO task status, goal link, title, or description mutations.
 * - NO silent learning; only explicit saved feedback shapes future proposal prompts.
 * - Append-only immutable activity ledger events ('agent_proposal_created', 'agent_proposal_feedback_recorded').
 * - Fixed visible safety notice on every proposal.
 */

export const SAFETY_NOTICE = "PROPOSAL ONLY — NO ACTIONS EXECUTED — NO SILENT LEARNING — OWNER APPROVAL REQUIRED FOR ANY FUTURE WORK";
export const DISCLAIMER = "Future work will require a separate, explicit owner approval workflow. This proposal did not perform any action.";
export const FIXED_STATUS = "PROPOSAL_ONLY";
export const ELIGIBLE_TASK_STATUSES = ['pending', 'planned', 'blocked'];
export const ALLOWED_FEEDBACK_RATINGS = ['helpful', 'too_vague', 'incorrect'];

export const MAX_PROPOSAL_ACTION_CHARS = 300;
export const MAX_PROPOSAL_REASONING_CHARS = 400;
export const MAX_PROPOSAL_EVIDENCE_CHARS = 300;
export const MAX_PROPOSAL_BLOCKER_CHARS = 250;
export const MAX_FEEDBACK_NOTE_CHARS = 240;
export const MAX_FEEDBACK_RECORDS_PER_OWNER = 10;

// In-memory store for explicit owner feedback records
const inMemoryFeedbackStore = new Map(); // ownerId -> Array<FeedbackRecord>

/**
 * Reset in-memory feedback store (used for unit testing isolation).
 */
export function resetTaskAgentStoreForTesting() {
    inMemoryFeedbackStore.clear();
}

/**
 * Helper to generate secure unique record IDs.
 */
function generateRecordId(prefix = 'prop') {
    const timestamp = Date.now().toString(36);
    const randomHex = crypto.randomBytes(4).toString('hex');
    return `${prefix}_${timestamp}_${randomHex}`;
}

/**
 * Helper to safely extract a JSON object from an LLM response string.
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
            const parsed = JSON.parse(raw.slice(startIdx, endIdx + 1).trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {}
    }

    return null;
}

/**
 * Sanitizes plain text input with length bounding.
 */
function sanitizeText(input, maxLen) {
    if (typeof input !== 'string') return '';
    const cleaned = input
        .replace(/<[^>]*>/g, '') // Strip HTML tags
        .trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * Resolves the selected task's blocker history from its immutable ledger events.
 * Distinguishes between an active blocker and a historic blocker.
 */
export function resolveTaskBlockerHistory(task, events = []) {
    if (!Array.isArray(events) || events.length === 0) {
        if (task.status === 'blocked' && task.blockerReason) {
            return {
                hasBlockerHistory: true,
                isHistoric: false,
                isActive: true,
                blockerReason: task.blockerReason,
                recordedAt: task.updatedAt || task.createdAt
            };
        }
        return {
            hasBlockerHistory: false,
            isHistoric: false,
            isActive: false,
            blockerReason: null,
            recordedAt: null
        };
    }

    // Find all blocker_recorded events in chronological order
    const blockerEvents = events.filter(e => e.eventType === 'blocker_recorded');
    if (blockerEvents.length === 0) {
        if (task.status === 'blocked' && task.blockerReason) {
            return {
                hasBlockerHistory: true,
                isHistoric: false,
                isActive: true,
                blockerReason: task.blockerReason,
                recordedAt: task.updatedAt || task.createdAt
            };
        }
        return {
            hasBlockerHistory: false,
            isHistoric: false,
            isActive: false,
            blockerReason: null,
            recordedAt: null
        };
    }

    const latestBlockerEvent = blockerEvents[blockerEvents.length - 1];
    const recordedAt = latestBlockerEvent.createdAt;
    const blockerReason = (latestBlockerEvent.eventDetail && latestBlockerEvent.eventDetail.blockerReason) ||
        task.blockerReason || 'Unspecified blocker';

    if (task.status === 'blocked') {
        return {
            hasBlockerHistory: true,
            isHistoric: false,
            isActive: true,
            blockerReason,
            recordedAt
        };
    } else {
        // Current state is planned/pending but historical ledger has a blocker recorded
        return {
            hasBlockerHistory: true,
            isHistoric: true,
            isActive: false,
            blockerReason,
            recordedAt
        };
    }
}

/**
 * Retrieves explicit feedback preferences for an owner (at most 10 recent items).
 */
export function getOwnerFeedbackPreferenceSummary(ownerId) {
    const feedbackList = inMemoryFeedbackStore.get(String(ownerId)) || [];
    const recent = feedbackList.slice(0, MAX_FEEDBACK_RECORDS_PER_OWNER);

    if (recent.length === 0) {
        return {
            count: 0,
            guidance: "No explicit owner feedback recorded yet. Follow standard grounded, concrete formatting.",
            items: []
        };
    }

    const tooVagueItems = recent.filter(f => f.rating === 'too_vague');
    const incorrectItems = recent.filter(f => f.rating === 'incorrect');
    const helpfulItems = recent.filter(f => f.rating === 'helpful');

    const rules = [];
    if (tooVagueItems.length > 0) {
        const notes = tooVagueItems.map(f => f.note).filter(Boolean).slice(0, 2);
        const noteContext = notes.length > 0 ? ` Recent owner note: "${notes.join('; ')}".` : '';
        rules.push(`[RULE: AVOID VAGUENESS] Owner previously rated proposals as Too Vague.${noteContext} You MUST use specific terms from the task description and title, name a concrete reviewable artifact or policy document (e.g. 'approval_gated_worker_policy.md'), and specify measurable verification criteria. DO NOT return generic phrases like 'review current implementation' or 'align with preferences'.`);
    }

    if (incorrectItems.length > 0) {
        const notes = incorrectItems.map(f => f.note).filter(Boolean).slice(0, 2);
        const noteContext = notes.length > 0 ? ` Recent owner note: "${notes.join('; ')}".` : '';
        rules.push(`[RULE: ACCURACY & STRICT TRUTHFULNESS] Owner previously rated proposals as Incorrect.${noteContext} You MUST strictly distinguish between known server facts and unknown facts. If code structure or implementation facts are not in the provided context, DO NOT guess or assume them; instead, propose a future owner-approved read-only inspection request ('Inspect Ghost repository').`);
    }

    if (helpfulItems.length > 0 && tooVagueItems.length === 0 && incorrectItems.length === 0) {
        rules.push(`[RULE: REINFORCE CONCISENESS] Owner previously rated proposals as Helpful. Maintain this grounded, concise format with concrete next steps.`);
    }

    return {
        count: recent.length,
        guidance: rules.join('\n'),
        items: recent
    };
}

/**
 * Builds a visible, compact grounding statement.
 */
export function buildGroundingStatement(task, blockerInfo, hasContinuationContext, feedbackCount) {
    const parts = [];

    if (task.description && task.description.trim()) {
        parts.push("selected task description");
    } else {
        parts.push("no task description provided");
    }

    parts.push(`current state: ${task.status}`);

    if (blockerInfo.isActive) {
        parts.push(`active blocker: "${sanitizeText(blockerInfo.blockerReason, 60)}"`);
    } else if (blockerInfo.isHistoric) {
        const dateStr = blockerInfo.recordedAt ? new Date(blockerInfo.recordedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'earlier';
        parts.push(`historic blocker recorded on ${dateStr}: "${sanitizeText(blockerInfo.blockerReason, 60)}"`);
    }

    if (hasContinuationContext) {
        parts.push("approved Personal Core context");
    }

    if (feedbackCount > 0) {
        parts.push(`${feedbackCount} explicit owner feedback item${feedbackCount === 1 ? '' : 's'}`);
    }

    return `Grounded in: ${parts.join('; ')}.`;
}

/**
 * Builds a deterministic truthful fallback proposal based strictly on task facts and blocker history.
 */
export function buildDeterministicFallbackProposal(task, goalTitle = null, blockerInfo = {}, feedbackSummary = {}, reason = 'LLM analysis unavailable') {
    const title = task.title || 'Untitled task';
    const status = task.status || 'pending';
    const desc = task.description ? task.description.trim() : '';
    const linkedGoal = goalTitle || 'No linked goal';
    const now = new Date().toISOString();
    const proposalId = generateRecordId('prop');

    let proposedNextAction = `Draft structured scope and verification artifact for '${title}'.`;
    let reasoningSummary = `Task is currently in ${status} state${desc ? ` (${desc.slice(0, 100)})` : ''}. Drafting a reviewable artifact establishes clear success criteria without unapproved execution.`;
    let expectedEvidence = `A documented artifact specification ready for explicit owner review.`;
    let blocker = 'None identified from approved context';

    if (blockerInfo.isActive) {
        const knownBlocker = blockerInfo.blockerReason ? sanitizeText(blockerInfo.blockerReason, MAX_PROPOSAL_BLOCKER_CHARS) : 'Active blocker';
        proposedNextAction = `Investigate and draft resolution options for active blocker: ${knownBlocker}`;
        reasoningSummary = `Task is in blocked state due to: "${knownBlocker}". Resolving this blocker is required before advancing the task.`;
        expectedEvidence = `Blocker resolution options documented and recorded in activity ledger.`;
        blocker = `Active Blocker: ${knownBlocker}`;
    } else if (blockerInfo.isHistoric) {
        const histBlocker = blockerInfo.blockerReason ? sanitizeText(blockerInfo.blockerReason, MAX_PROPOSAL_BLOCKER_CHARS) : 'Historic blocker';
        proposedNextAction = `Draft reviewable proposal for '${title}' addressing historic blocker: ${histBlocker}`;
        reasoningSummary = `Task is in ${status} state with a prior historic blocker: "${histBlocker}". Confirm whether this blocker remains resolved or requires a dedicated specification.`;
        expectedEvidence = `A specification artifact covering the historic blocker requirements ready for owner sign-off.`;
        blocker = `Historic Blocker (Unresolved status confirmation required): ${histBlocker}`;
    } else if (status === 'planned') {
        proposedNextAction = `Draft implementation plan artifact for '${title}'${desc ? ` addressing: ${desc.slice(0, 80)}` : ''}.`;
        reasoningSummary = `Task is planned. Decomposing the work into a reviewable plan prepares the next phase for owner approval.`;
        expectedEvidence = `Detailed implementation plan artifact ready for explicit owner review.`;
    }

    const groundingStatement = buildGroundingStatement(task, blockerInfo, Boolean(linkedGoal && linkedGoal !== 'No linked goal'), feedbackSummary.count || 0);

    return {
        proposalId,
        selectedTask: {
            id: task.id,
            title: task.title,
            status: task.status,
            description: task.description || null,
            blockerReason: task.blockerReason || null
        },
        currentGoal: linkedGoal,
        proposedNextAction,
        reasoningSummary,
        expectedEvidence,
        blocker,
        groundingStatement,
        futureApprovalRequired: true,
        authority: SAFETY_NOTICE,
        createdAt: now,
        fallbackReason: reason
    };
}

/**
 * Generates a bounded, grounded task proposal for an authenticated owner's selected task.
 *
 * @param {string} ownerId - Authenticated owner ID
 * @param {string} taskId - Target task ID
 * @param {Object} options - { dbPool }
 * @returns {Promise<Object>} { success, mode, proposal, groundingStatement, safetyNotice, disclaimer }
 */
export async function generateTaskProposal(ownerId, taskId, options = {}) {
    // 1. Input Validation
    if (!ownerId || typeof ownerId !== 'string' || !ownerId.trim()) {
        return { success: false, error: 'Valid owner identification required.' };
    }
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
        return { success: false, error: 'Valid taskId is required.' };
    }

    if (isPotentialSecret(taskId)) {
        return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    const { dbPool = null } = options;

    // 2. Fetch Selected Task & Verify Ownership
    const existingTasks = await listPersonalTasks(ownerId, dbPool);
    const task = existingTasks.find(t => t.id === taskId);
    if (!task) {
        return { success: false, error: 'Task not found or unauthorized.' };
    }

    // 3. Verify Status Eligibility
    if (!ELIGIBLE_TASK_STATUSES.includes(task.status)) {
        return {
            success: false,
            error: `Only pending, planned, or blocked tasks are eligible for agent proposals. Current status: '${task.status}'.`
        };
    }

    // 4. Fetch Linked Goal (if any)
    let goalTitle = 'No linked goal';
    if (task.goalId) {
        const goals = await listPersonalGoals(ownerId, dbPool);
        const goal = goals.find(g => g.id === task.goalId);
        if (goal) {
            goalTitle = goal.title;
        }
    }

    // 5. Fetch Task Ledger Events to Resolve Blocker History
    let taskEvents = [];
    try {
        const eventsRes = await listPersonalTaskEvents(ownerId, taskId, dbPool);
        if (eventsRes.success && Array.isArray(eventsRes.events)) {
            taskEvents = eventsRes.events;
        }
    } catch (e) {
        console.warn('[TaskAgent] Could not load task events for blocker history:', e.message);
    }
    const blockerInfo = resolveTaskBlockerHistory(task, taskEvents);

    // 6. Fetch Sanitized Personal Core Continuation Context
    let continuationContext = '';
    try {
        const overview = await getPersonalOverview(ownerId, dbPool);
        if (overview && overview.continuationSummary) {
            continuationContext = overview.continuationSummary;
        }
    } catch (e) {
        // Non-fatal: proceed with task-local context
    }

    // 7. Fetch Explicit Feedback Preferences (max 10 recent items)
    const feedbackSummary = getOwnerFeedbackPreferenceSummary(ownerId);

    // 8. Build Grounding Statement
    const groundingStatement = buildGroundingStatement(
        task,
        blockerInfo,
        Boolean(continuationContext),
        feedbackSummary.count
    );

    // 9. Attempt LLM Reasoning with Strict Bounded & Grounded Prompt
    const systemPrompt = `You are Ghost Agent V0.1, a bounded read-only task reasoning and action planning assistant.
Your job is to analyze the selected task facts, relevant blocker history, and approved owner context, then propose exactly ONE concrete, non-executing next action.

STRICT SAFETY & GROUNDING CONSTRAINTS:
1. PROPOSAL-ONLY MODE: You have NO execution capabilities.
2. DO NOT execute commands, edit files, run tests, access Git, or access external systems.
3. DO NOT claim work has been done, inspected, or tested.
4. GROUNDING RULES:
   - Ground your proposal materially in the task's title, description, and state.
   - If the task has a description, YOU MUST use its specific terms and constraints.
   - If task description is absent, state this plainly; NEVER invent missing task details.
   - If the task has an active blocker, address the active blocker directly.
   - If the task has a historic blocker (recorded in past events), explicitly identify it as a HISTORIC blocker and propose confirming whether it remains unresolved or requires a dedicated artifact.
   - If a next step requires code facts that Ghost does not have, propose a future owner-approved read-only inspection request ('Inspect Ghost repository'). NEVER say Ghost inspected code.
   - Name a concrete reviewable artifact (e.g. policy document, schema draft, contract specification) or specific owner decision. DO NOT say generic 'review current implementation'.
   - 'expectedEvidence' MUST be measurable content, not vague 'review' or 'preferences' filler.
5. EXPLICIT FEEDBACK PREFERENCES:
${feedbackSummary.guidance}

Output MUST be a single valid JSON object with NO preamble or markdown wrapper.

JSON SCHEMA:
{
  "proposedNextAction": "One concrete reviewable artifact or owner decision (max 300 chars)",
  "reasoningSummary": "Short explanation grounded in task description, state, and blocker history (max 400 chars)",
  "expectedEvidence": "Measurable verification criteria or artifact ready for owner review (max 300 chars)",
  "blocker": "Active blocker, historic blocker summary, or 'None identified from approved context' (max 250 chars)",
  "futureApprovalRequired": true
}`;

    const userPrompt = `SELECTED TASK FACTS:
- ID: ${task.id}
- Title: ${task.title}
- Current Status: ${task.status}
- Linked Goal: ${goalTitle}
- Description: ${task.description && task.description.trim() ? task.description.trim() : 'No task description provided.'}
${blockerInfo.isActive ? `- ACTIVE BLOCKER: ${blockerInfo.blockerReason}` : ''}
${blockerInfo.isHistoric ? `- HISTORIC BLOCKER (Recorded ${blockerInfo.recordedAt ? new Date(blockerInfo.recordedAt).toLocaleDateString() : 'earlier'}): ${blockerInfo.blockerReason}` : ''}

APPROVED OWNER CONTINUATION CONTEXT:
${continuationContext || 'No additional continuity context.'}

VISUAL GROUNDING:
${groundingStatement}

Generate the structured proposal object in pure JSON format:`;

    let mode = 'generated';
    let proposal = null;
    const proposalId = generateRecordId('prop');

    try {
        const rawOutput = await callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], {
            systemPrompt,
            maxTokens: 512,
            temperature: 0.1,
            timeoutMs: 12000
        });

        const parsed = extractJsonObject(rawOutput);
        if (parsed && typeof parsed.proposedNextAction === 'string' && parsed.proposedNextAction.trim()) {
            proposal = {
                proposalId,
                selectedTask: {
                    id: task.id,
                    title: task.title,
                    status: task.status,
                    description: task.description || null,
                    blockerReason: task.blockerReason || null
                },
                currentGoal: goalTitle,
                proposedNextAction: sanitizeText(parsed.proposedNextAction, MAX_PROPOSAL_ACTION_CHARS),
                reasoningSummary: sanitizeText(parsed.reasoningSummary || 'Logical sequence grounded in approved task state.', MAX_PROPOSAL_REASONING_CHARS),
                expectedEvidence: sanitizeText(parsed.expectedEvidence || 'Measurable verification proof ready for owner review.', MAX_PROPOSAL_EVIDENCE_CHARS),
                blocker: sanitizeText(parsed.blocker || (blockerInfo.isActive ? blockerInfo.blockerReason : (blockerInfo.isHistoric ? `Historic: ${blockerInfo.blockerReason}` : 'None identified from approved context')), MAX_PROPOSAL_BLOCKER_CHARS),
                groundingStatement,
                futureApprovalRequired: true,
                authority: SAFETY_NOTICE,
                createdAt: new Date().toISOString()
            };
        } else {
            console.warn('[TaskAgent] LLM output could not be parsed into valid proposal JSON. Using deterministic fallback.');
            mode = 'fallback';
            proposal = buildDeterministicFallbackProposal(task, goalTitle, blockerInfo, feedbackSummary, 'LLM output structure invalid');
        }
    } catch (err) {
        console.warn('[TaskAgent] LLM reasoning call failed. Using deterministic fallback:', err.message);
        mode = 'fallback';
        proposal = buildDeterministicFallbackProposal(task, goalTitle, blockerInfo, feedbackSummary, 'LLM call unavailable or timed out');
    }

    // 10. Append 'agent_proposal_created' Event to Task Activity Ledger
    try {
        const eventDetail = {
            proposalId: proposal.proposalId,
            proposalMode: mode,
            proposedNextAction: proposal.proposedNextAction,
            groundingStatement: proposal.groundingStatement,
            futureApprovalRequired: true,
            summary: `Agent V0.1 generated proposal (${mode}): ${proposal.proposedNextAction.slice(0, 100)}`
        };
        await appendPersonalTaskEvent(ownerId, taskId, 'agent_proposal_created', eventDetail, dbPool);
    } catch (evtErr) {
        console.warn('[TaskAgent] Failed to append proposal event to activity ledger:', evtErr.message);
    }

    return {
        success: true,
        mode,
        proposal,
        groundingStatement: proposal.groundingStatement,
        safetyNotice: SAFETY_NOTICE,
        disclaimer: DISCLAIMER,
        fixedStatus: FIXED_STATUS
    };
}

/**
 * Records explicit owner feedback for a displayed Agent proposal.
 *
 * @param {string} ownerId - Authenticated owner ID
 * @param {string} taskId - Target task ID
 * @param {Object} feedbackInput - { proposalId, rating, note }
 * @param {Object} options - { dbPool }
 * @returns {Promise<Object>} { success, message, feedback }
 */
export async function recordProposalFeedback(ownerId, taskId, feedbackInput = {}, options = {}) {
    // 1. Input Validation
    if (!ownerId || typeof ownerId !== 'string' || !ownerId.trim()) {
        return { success: false, error: 'Valid owner identification required.' };
    }
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
        return { success: false, error: 'Valid taskId is required.' };
    }

    const { proposalId, rating, note = '' } = feedbackInput;

    if (!proposalId || typeof proposalId !== 'string' || !proposalId.trim()) {
        return { success: false, error: 'Valid proposalId is required to record feedback.' };
    }

    if (!rating || typeof rating !== 'string') {
        return { success: false, error: `Valid rating is required. Must be one of: ${ALLOWED_FEEDBACK_RATINGS.join(', ')}.` };
    }

    const normalizedRating = rating.trim().toLowerCase();
    if (!ALLOWED_FEEDBACK_RATINGS.includes(normalizedRating)) {
        return { success: false, error: `Valid rating is required. Must be one of: ${ALLOWED_FEEDBACK_RATINGS.join(', ')}.` };
    }

    if (note && typeof note === 'string' && isPotentialSecret(note)) {
        return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    const sanitizedNote = sanitizeText(note || '', MAX_FEEDBACK_NOTE_CHARS);
    const { dbPool = null } = options;

    // 2. Verify Task Exists and Belongs to Owner
    const existingTasks = await listPersonalTasks(ownerId, dbPool);
    const task = existingTasks.find(t => t.id === taskId);
    if (!task) {
        return { success: false, error: 'Task not found or unauthorized.' };
    }

    // 3. Server-side Idempotency Check: Prevent duplicate feedback for the same proposal
    if (!inMemoryFeedbackStore.has(String(ownerId))) {
        inMemoryFeedbackStore.set(String(ownerId), []);
    }
    const ownerFeedbackList = inMemoryFeedbackStore.get(String(ownerId));
    const existingEntry = ownerFeedbackList.find(f => f.proposalId === proposalId.trim());
    if (existingEntry) {
        // Return existing feedback record idempotently without creating duplicate ledger events
        return {
            success: true,
            isDuplicate: true,
            message: 'Feedback already recorded for this proposal.',
            feedback: existingEntry
        };
    }

    // 4. Create Feedback Record
    const feedbackId = generateRecordId('fb');
    const now = new Date().toISOString();
    const feedbackRecord = {
        id: feedbackId,
        ownerId: String(ownerId),
        taskId: String(taskId),
        proposalId: proposalId.trim(),
        rating: normalizedRating,
        note: sanitizedNote || null,
        createdAt: now
    };

    // 5. Append 'agent_proposal_feedback_recorded' Event to Task Activity Ledger
    try {
        const eventDetail = {
            feedbackId,
            proposalId: proposalId.trim(),
            rating: normalizedRating,
            note: sanitizedNote || null,
            summary: `Owner feedback recorded: ${normalizedRating}${sanitizedNote ? ` ("${sanitizedNote.slice(0, 50)}")` : ''}`
        };
        await appendPersonalTaskEvent(ownerId, taskId, 'agent_proposal_feedback_recorded', eventDetail, dbPool);
    } catch (evtErr) {
        console.warn('[TaskAgent] Failed to append feedback event to activity ledger:', evtErr.message);
        return { success: false, error: `Failed to record feedback event in activity ledger: ${evtErr.message}` };
    }

    // 6. Prepend to in-memory store and enforce MAX_FEEDBACK_RECORDS_PER_OWNER cap
    ownerFeedbackList.unshift(feedbackRecord);
    if (ownerFeedbackList.length > MAX_FEEDBACK_RECORDS_PER_OWNER) {
        ownerFeedbackList.length = MAX_FEEDBACK_RECORDS_PER_OWNER;
    }

    return {
        success: true,
        message: 'Feedback recorded successfully.',
        feedback: feedbackRecord
    };
}

export default {
    generateTaskProposal,
    recordProposalFeedback,
    buildDeterministicFallbackProposal,
    resolveTaskBlockerHistory,
    getOwnerFeedbackPreferenceSummary,
    buildGroundingStatement,
    resetTaskAgentStoreForTesting,
    SAFETY_NOTICE,
    DISCLAIMER,
    FIXED_STATUS,
    ELIGIBLE_TASK_STATUSES,
    ALLOWED_FEEDBACK_RATINGS
};
