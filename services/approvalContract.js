import crypto from 'crypto';
import path from 'path';
import {
    listPersonalTasks,
    listPersonalGoals,
    listPersonalTaskEvents,
    appendPersonalTaskEvent,
    isPotentialSecret,
    SECRET_REJECTION_MESSAGE
} from './personalCore.js';

/**
 * services/approvalContract.js — Ghost Approval Contract V1 Service
 *
 * Core Contract:
 * Approval Contract V1 is a reviewable proposal preparation layer for a future
 * Approval-Gated Edit/Test Worker.
 *
 * NON-EXECUTING GUARANTEE:
 * - NO file modifications, creation, deletion, or renaming.
 * - NO command, shell, or test execution.
 * - NO worker threads, background queues, schedulers, or leases.
 * - NO mutation of the underlying task status, title, description, or goal.
 * - NO mutation of Personal Core memories, goals, or feedback preferences.
 * - 'reviewed' state means OWNER HAS REVIEWED THE PROPOSAL, NOT that any worker may run.
 *
 * Exact Literal Safety Banner:
 * "APPROVAL CONTRACT ONLY — NO FILES CHANGED — NO COMMANDS OR TESTS EXECUTED — NO WORKER STARTED — OWNER CANCELLATION AVAILABLE"
 */

export const SAFETY_BANNER = "APPROVAL CONTRACT ONLY — NO FILES CHANGED — NO COMMANDS OR TESTS EXECUTED — NO WORKER STARTED — OWNER CANCELLATION AVAILABLE";
export const EVIDENCE_CONTRACT = "Future worker, if ever implemented, must return only a scoped diff, named test output, timestamps, and status. V1 produces no execution evidence.";
export const ALLOWED_CONTRACT_STATES = ['draft', 'reviewed', 'cancelled', 'expired'];

export const MIN_EXPIRY_MINUTES = 5;
export const MAX_EXPIRY_MINUTES = 60;
export const DEFAULT_EXPIRY_MINUTES = 30;

export const MAX_PURPOSE_CHARS = 500;
export const MAX_FILE_SCOPE_ITEMS = 10;
export const MAX_COMMAND_SCOPE_ITEMS = 5;
export const MAX_PATH_CHARS = 200;
export const MAX_COMMAND_CHARS = 100;

// Prohibited path substrings and extensions
const DISALLOWED_PATH_PATTERNS = [
    /\.env/i,
    /credentials/i,
    /id_rsa/i,
    /\.pem$/i,
    /secrets?/i,
    /\.git(\/|$)/i,
    /\.pm2(\/|$)/i,
    /node_modules(\/|$)/i,
    /\0/ // Null byte
];

const DISALLOWED_EXTENSIONS = [
    '.exe', '.so', '.dylib', '.dll', '.bin', '.dmg', '.iso', '.app', '.pkg'
];

// Dangerous shell operators and commands prohibited in command scope
const PROHIBITED_SHELL_PATTERNS = [
    /[;&|]/,             // Chaining & pipes: ;, &&, ||, |, &
    /[><]/,              // Redirection: >, >>, <
    /[`$]/,              // Substitution: `cmd`, $var, $(cmd), ${var}
    /\b(curl|wget|nc|netcat|ssh|scp|rsync)\b/i, // Network utilities
    /\b(npm\s+(i|install|publish|unpublish)|yarn\s+add|pip\s+install|brew\s+install)\b/i, // Package managers
    /\b(git\s+(push|commit|merge|rebase|tag|branch\s+-[dD]|reset|checkout|clean))\b/i, // Git write ops
    /\b(eval|exec|sh\s+|bash\s+|zsh\s+|sudo\s+|su\s+|chmod|chown|kill|pkill)\b/i, // Shell exec & admin
    /\b(rm\s+|rmdir|mv\s+|cp\s+|cat\s+|tee\s+)\b/i // Generic shell file mutations
];

// In-memory store for isolated unit testing & resilient fallback
const inMemoryContractStore = new Map(); // ownerId -> Array<ApprovalContract>

/**
 * Reset in-memory store for unit test isolation.
 */
export function resetApprovalContractStoreForTesting() {
    inMemoryContractStore.clear();
}

/**
 * Generates a record ID for approval contracts.
 */
function generateRecordId(prefix = 'actr') {
    const timestamp = Date.now().toString(36);
    const randomHex = crypto.randomBytes(4).toString('hex');
    return `${prefix}_${timestamp}_${randomHex}`;
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
 * Validates a proposed relative file path.
 * Must be a relative repo path, no traversal, no globs, no secret/system paths.
 */
export function validateProposedFilePath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') {
        return { valid: false, error: 'File path must be a non-empty string.' };
    }

    const trimmed = rawPath.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PATH_CHARS) {
        return { valid: false, error: `File path length must be between 1 and ${MAX_PATH_CHARS} characters.` };
    }

    if (isPotentialSecret(trimmed)) {
        return { valid: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    // Must not start with / or \ (reject absolute paths)
    if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-zA-Z]:[/\\]/.test(trimmed)) {
        return { valid: false, error: `Absolute paths not allowed: '${trimmed}'. Must be a relative repository path.` };
    }

    // Normalize slashes
    const normalized = path.normalize(trimmed).replace(/\\/g, '/');

    // Reject path traversal
    if (normalized.startsWith('..') || normalized.includes('/../') || normalized === '..') {
        return { valid: false, error: `Path traversal not allowed in file scope: '${trimmed}'.` };
    }

    // Reject wildcards and globs
    if (/[*?{}[\]]/.test(trimmed)) {
        return { valid: false, error: `Wildcards and glob patterns not allowed: '${trimmed}'. Specify exact paths.` };
    }

    // Reject prohibited patterns
    for (const pattern of DISALLOWED_PATH_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { valid: false, error: `Disallowed or sensitive path pattern: '${trimmed}'.` };
        }
    }

    // Reject dangerous binary extensions
    const ext = path.extname(trimmed).toLowerCase();
    if (DISALLOWED_EXTENSIONS.includes(ext)) {
        return { valid: false, error: `Binary file extensions not permitted in file scope: '${trimmed}'.` };
    }

    return { valid: true, path: normalized };
}

/**
 * Validates a proposed command or test name.
 * Must be text only, no shell chaining, no redirection, no package managers or git writes.
 */
export function validateProposedCommand(rawCommand) {
    if (!rawCommand || typeof rawCommand !== 'string') {
        return { valid: false, error: 'Command / test name must be a non-empty string.' };
    }

    const trimmed = rawCommand.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_COMMAND_CHARS) {
        return { valid: false, error: `Command / test name length must be between 1 and ${MAX_COMMAND_CHARS} characters.` };
    }

    if (isPotentialSecret(trimmed)) {
        return { valid: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    // Reject dangerous shell patterns
    for (const pattern of PROHIBITED_SHELL_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { valid: false, error: `Disallowed shell syntax or command pattern in proposed command scope: '${trimmed}'.` };
        }
    }

    // Reject environment assignments at start
    if (/^[a-zA-Z_][a-zA-Z0-9_]*=/.test(trimmed)) {
        return { valid: false, error: `Environment variable assignments not allowed: '${trimmed}'.` };
    }

    return { valid: true, command: trimmed };
}

/**
 * Builds a safe task snapshot from server-side records.
 */
async function buildTaskSnapshot(ownerId, task, dbPool) {
    let goalTitle = null;
    if (task.goalId) {
        try {
            const goals = await listPersonalGoals(ownerId, dbPool);
            const goal = goals.find(g => g.id === task.goalId);
            if (goal) goalTitle = goal.title;
        } catch {}
    }

    let blockerContext = null;
    try {
        const eventsRes = await listPersonalTaskEvents(ownerId, task.id, dbPool);
        if (eventsRes.success && Array.isArray(eventsRes.events)) {
            const blockerEvents = eventsRes.events.filter(e => e.eventType === 'blocker_recorded');
            if (blockerEvents.length > 0) {
                const latest = blockerEvents[blockerEvents.length - 1];
                const dateStr = latest.createdAt ? new Date(latest.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
                const reason = (latest.eventDetail && latest.eventDetail.blockerReason) || task.blockerReason || 'Unspecified';
                blockerContext = `${task.status === 'blocked' ? 'Active' : 'Historic'} blocker (${dateStr}): "${reason}"`;
            }
        }
    } catch {}

    return {
        taskId: task.id,
        title: task.title,
        description: task.description || null,
        status: task.status,
        goalTitle: goalTitle || null,
        blockerContext: blockerContext || (task.status === 'blocked' && task.blockerReason ? `Active blocker: "${task.blockerReason}"` : null)
    };
}

/**
 * Checks and updates contract state if execution expiry has passed.
 */
function refreshContractExpiryState(contract) {
    if (!contract) return contract;
    if ((contract.state === 'draft' || contract.state === 'reviewed') && contract.executionExpiry) {
        const now = new Date();
        const expiry = new Date(contract.executionExpiry);
        if (now >= expiry) {
            contract.state = 'expired';
            contract.updatedAt = now.toISOString();
        }
    }
    return contract;
}

/**
 * Drafts an Approval Contract for an authenticated owner's task.
 *
 * @param {string} ownerId - Authenticated owner ID
 * @param {string} taskId - Target task ID
 * @param {Object} input - { purpose, proposedFileScope, proposedCommandScope, expiryMinutes }
 * @param {Object} options - { dbPool }
 * @returns {Promise<Object>} { success, contract }
 */
export async function draftApprovalContract(ownerId, taskId, input = {}, options = {}) {
    // 1. Input Validation
    if (!ownerId || typeof ownerId !== 'string' || !ownerId.trim()) {
        return { success: false, error: 'Valid owner identification required.' };
    }
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
        return { success: false, error: 'Valid taskId is required.' };
    }

    const {
        purpose = '',
        proposedFileScope = [],
        proposedCommandScope = [],
        expiryMinutes = DEFAULT_EXPIRY_MINUTES
    } = input;

    if (isPotentialSecret(taskId) || (purpose && isPotentialSecret(purpose))) {
        return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    const { dbPool = null } = options;

    // 2. Fetch Task & Verify Ownership
    const existingTasks = await listPersonalTasks(ownerId, dbPool);
    const task = existingTasks.find(t => t.id === taskId);
    if (!task) {
        return { success: false, error: 'Task not found or unauthorized.' };
    }

    // 3. Validate Purpose
    const sanitizedPurpose = sanitizeText(purpose || `Approval contract proposal for '${task.title}'`, MAX_PURPOSE_CHARS);
    if (!sanitizedPurpose) {
        return { success: false, error: 'Purpose cannot be empty.' };
    }

    // 4. Validate Proposed File Scope Array
    if (!Array.isArray(proposedFileScope)) {
        return { success: false, error: 'Proposed file scope must be an array of relative paths.' };
    }
    if (proposedFileScope.length > MAX_FILE_SCOPE_ITEMS) {
        return { success: false, error: `Proposed file scope exceeds maximum limit of ${MAX_FILE_SCOPE_ITEMS} files.` };
    }

    const validatedFiles = [];
    for (const rawFile of proposedFileScope) {
        const check = validateProposedFilePath(rawFile);
        if (!check.valid) {
            return { success: false, error: check.error, isSecretRejected: check.isSecretRejected };
        }
        if (!validatedFiles.includes(check.path)) {
            validatedFiles.push(check.path);
        }
    }

    // 5. Validate Proposed Command Scope Array
    if (!Array.isArray(proposedCommandScope)) {
        return { success: false, error: 'Proposed command scope must be an array of command/test names.' };
    }
    if (proposedCommandScope.length > MAX_COMMAND_SCOPE_ITEMS) {
        return { success: false, error: `Proposed command scope exceeds maximum limit of ${MAX_COMMAND_SCOPE_ITEMS} commands.` };
    }

    const validatedCommands = [];
    for (const rawCmd of proposedCommandScope) {
        const check = validateProposedCommand(rawCmd);
        if (!check.valid) {
            return { success: false, error: check.error, isSecretRejected: check.isSecretRejected };
        }
        if (!validatedCommands.includes(check.command)) {
            validatedCommands.push(check.command);
        }
    }

    // 6. Validate & Calculate Bounded Expiry
    let parsedExpiryMinutes = parseInt(expiryMinutes, 10);
    if (isNaN(parsedExpiryMinutes) || parsedExpiryMinutes < MIN_EXPIRY_MINUTES || parsedExpiryMinutes > MAX_EXPIRY_MINUTES) {
        parsedExpiryMinutes = DEFAULT_EXPIRY_MINUTES;
    }

    const now = new Date();
    const expiryDate = new Date(now.getTime() + parsedExpiryMinutes * 60 * 1000);
    const nowIso = now.toISOString();
    const expiryIso = expiryDate.toISOString();

    // 7. Resolve Task Snapshot
    const taskSnapshot = await buildTaskSnapshot(ownerId, task, dbPool);

    // 8. Build Contract Object
    const contractId = generateRecordId('actr');
    const contract = {
        id: contractId,
        taskId: String(taskId),
        ownerId: String(ownerId),
        taskSnapshot,
        purpose: sanitizedPurpose,
        proposedFileScope: validatedFiles,
        proposedCommandScope: validatedCommands,
        executionExpiry: expiryIso,
        expiryMinutes: parsedExpiryMinutes,
        state: 'draft',
        evidenceContract: EVIDENCE_CONTRACT,
        authority: SAFETY_BANNER,
        createdAt: nowIso,
        updatedAt: nowIso,
        reviewedAt: null,
        cancelledAt: null
    };

    // 9. Append 'approval_contract_drafted' Event to Task Activity Ledger
    try {
        const eventDetail = {
            contractId,
            purpose: sanitizedPurpose,
            fileScopeCount: validatedFiles.length,
            commandScopeCount: validatedCommands.length,
            executionExpiry: expiryIso,
            summary: `Approval contract drafted: ${validatedFiles.length} files, ${validatedCommands.length} commands, expires in ${parsedExpiryMinutes}m.`
        };
        await appendPersonalTaskEvent(ownerId, taskId, 'approval_contract_drafted', eventDetail, dbPool);
    } catch (evtErr) {
        console.warn('[ApprovalContract] Failed to append drafted event to activity ledger:', evtErr.message);
    }

    // 10. Store Contract in Owner-Scoped Repository
    if (!inMemoryContractStore.has(String(ownerId))) {
        inMemoryContractStore.set(String(ownerId), []);
    }
    inMemoryContractStore.get(String(ownerId)).unshift(contract);

    return {
        success: true,
        contract
    };
}

/**
 * Gets the active or latest Approval Contract for a task.
 */
export async function getApprovalContractForTask(ownerId, taskId, options = {}) {
    if (!ownerId || !taskId) {
        return { success: false, error: 'Owner ID and Task ID required.' };
    }

    const { dbPool = null } = options;

    // Verify task ownership
    const existingTasks = await listPersonalTasks(ownerId, dbPool);
    const task = existingTasks.find(t => t.id === taskId);
    if (!task) {
        return { success: false, error: 'Task not found or unauthorized.' };
    }

    const list = inMemoryContractStore.get(String(ownerId)) || [];
    const contract = list.find(c => c.taskId === taskId);

    if (!contract) {
        return { success: true, contract: null };
    }

    refreshContractExpiryState(contract);
    return {
        success: true,
        contract
    };
}

/**
 * Gets a specific Approval Contract by contractId for an authenticated owner.
 */
export async function getApprovalContractById(ownerId, contractId, options = {}) {
    if (!ownerId || !contractId) {
        return { success: false, error: 'Owner ID and Contract ID required.' };
    }

    const list = inMemoryContractStore.get(String(ownerId)) || [];
    const contract = list.find(c => c.id === contractId);

    if (!contract) {
        return { success: false, error: 'Approval contract not found or unauthorized.' };
    }

    refreshContractExpiryState(contract);
    return {
        success: true,
        contract
    };
}

/**
 * Marks an Approval Contract as reviewed by the owner.
 *
 * NOTE: 'reviewed' state means OWNER HAS REVIEWED THE PROPOSAL, NOT that any worker may run.
 */
export async function reviewApprovalContract(ownerId, contractId, options = {}) {
    if (!ownerId || !contractId) {
        return { success: false, error: 'Owner ID and Contract ID required.' };
    }

    const { dbPool = null } = options;
    const list = inMemoryContractStore.get(String(ownerId)) || [];
    const contract = list.find(c => c.id === contractId);

    if (!contract) {
        return { success: false, error: 'Approval contract not found or unauthorized.' };
    }

    refreshContractExpiryState(contract);

    if (contract.state === 'cancelled') {
        return { success: false, error: 'Cannot review a cancelled approval contract.' };
    }
    if (contract.state === 'expired') {
        return { success: false, error: 'Cannot review an expired approval contract.' };
    }

    // Idempotency: if already reviewed, return existing state without duplicate ledger events
    if (contract.state === 'reviewed') {
        return {
            success: true,
            isDuplicate: true,
            message: 'Approval contract has already been reviewed by owner.',
            contract
        };
    }

    const nowIso = new Date().toISOString();
    contract.state = 'reviewed';
    contract.reviewedAt = nowIso;
    contract.updatedAt = nowIso;

    // Append 'approval_contract_reviewed' event to task activity ledger
    try {
        const eventDetail = {
            contractId,
            reviewedAt: nowIso,
            summary: `Owner reviewed approval contract for task '${contract.taskSnapshot ? contract.taskSnapshot.title : contract.taskId}'.`
        };
        await appendPersonalTaskEvent(ownerId, contract.taskId, 'approval_contract_reviewed', eventDetail, dbPool);
    } catch (evtErr) {
        console.warn('[ApprovalContract] Failed to append reviewed event to activity ledger:', evtErr.message);
    }

    return {
        success: true,
        message: 'Approval contract reviewed by owner.',
        contract
    };
}

/**
 * Cancels an Approval Contract. Idempotent and immutable.
 */
export async function cancelApprovalContract(ownerId, contractId, options = {}) {
    if (!ownerId || !contractId) {
        return { success: false, error: 'Owner ID and Contract ID required.' };
    }

    const { dbPool = null } = options;
    const list = inMemoryContractStore.get(String(ownerId)) || [];
    const contract = list.find(c => c.id === contractId);

    if (!contract) {
        return { success: false, error: 'Approval contract not found or unauthorized.' };
    }

    refreshContractExpiryState(contract);

    // Idempotency: if already cancelled, return existing state without duplicate ledger events
    if (contract.state === 'cancelled') {
        return {
            success: true,
            isDuplicate: true,
            message: 'Approval contract is already cancelled.',
            contract
        };
    }

    const nowIso = new Date().toISOString();
    contract.state = 'cancelled';
    contract.cancelledAt = nowIso;
    contract.updatedAt = nowIso;

    // Append 'approval_contract_cancelled' event to task activity ledger
    try {
        const eventDetail = {
            contractId,
            cancelledAt: nowIso,
            summary: `Approval contract cancelled by owner.`
        };
        await appendPersonalTaskEvent(ownerId, contract.taskId, 'approval_contract_cancelled', eventDetail, dbPool);
    } catch (evtErr) {
        console.warn('[ApprovalContract] Failed to append cancelled event to activity ledger:', evtErr.message);
    }

    return {
        success: true,
        message: 'Approval contract cancelled.',
        contract
    };
}

export default {
    draftApprovalContract,
    getApprovalContractForTask,
    getApprovalContractById,
    reviewApprovalContract,
    cancelApprovalContract,
    validateProposedFilePath,
    validateProposedCommand,
    resetApprovalContractStoreForTesting,
    SAFETY_BANNER,
    EVIDENCE_CONTRACT,
    ALLOWED_CONTRACT_STATES,
    MIN_EXPIRY_MINUTES,
    MAX_EXPIRY_MINUTES,
    DEFAULT_EXPIRY_MINUTES
};
