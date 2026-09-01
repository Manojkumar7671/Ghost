import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import {
    getApprovalContractById,
    SAFETY_BANNER as CONTRACT_SAFETY_BANNER
} from './approvalContract.js';
import {
    appendPersonalTaskEvent,
    isPotentialSecret,
    SECRET_REJECTION_MESSAGE
} from './personalCore.js';

/**
 * services/approvalTestWorker.js — Ghost Approval-Gated Test Worker V0 Service
 *
 * Core Contract:
 * - TEST-ONLY WORKER: No production file modifications, creation, deletion, or renaming.
 * - Exact allowlisted test identifier only ('approval_gated_test_worker_v0_test').
 * - Requires explicit owner start on a reviewed, unexpired Approval Contract V1.
 * - Direct argument-vector process spawn (shell: false) with canonical Ghost root cwd.
 * - Scoped child-only SIGTERM cancellation; zero broad process kills.
 * - Bounded output capture (max 12 KiB) and deterministic timeout limit (25s).
 * - Appends immutable factual events to Task Activity Ledger.
 * - Zero filesystem-write capability or helper.
 */

export const WORKER_SAFETY_BANNER = "TEST-ONLY WORKER V0 — NO PRODUCTION FILES CHANGED — NO BROAD SHELL, MAC, BROWSER, NETWORK, GIT, OR DEPLOYMENT ACCESS — EXPLICIT OWNER START AND CANCELLATION REQUIRED";

export const ALLOWED_TEST_IDENTIFIERS = {
    'approval_gated_test_worker_v0_test': {
        executable: process.execPath,
        args: [path.join(process.cwd(), 'tests', 'approval_gated_test_worker_v0_test.cjs')],
        relativeScriptPath: 'tests/approval_gated_test_worker_v0_test.cjs',
        timeoutMs: 25000,
        description: 'Approval-Gated Test Worker V0 behavioural contract test suite'
    }
};

export const ALLOWED_RUN_STATES = [
    'idle',
    'ready',
    'queued',
    'running',
    'cancel_requested',
    'cancelled',
    'succeeded',
    'failed',
    'rejected',
    'timed_out'
];

export const MAX_OUTPUT_BYTES = 12288; // 12 KiB (12288 bytes) bounded stdout/stderr
export const DEFAULT_TIMEOUT_MS = 25000;

// In-memory test run repository: ownerId -> Map<runId, TestRunRecord>
const runStore = new Map();
// Active child process handles for scoped cancellation: runId -> ChildProcess
const activeProcesses = new Map();

/**
 * Reset test worker in-memory store for isolated unit tests.
 */
export function resetTestWorkerStoreForTesting() {
    runStore.clear();
    activeProcesses.clear();
}

/**
 * Generates a bounded unique record ID for test runs.
 */
function generateRunId(prefix = 'trun') {
    const timestamp = Date.now().toString(36);
    const randomHex = crypto.randomBytes(4).toString('hex');
    return `${prefix}_${timestamp}_${randomHex}`;
}

/**
 * Starts an approved test run for an authenticated owner and reviewed contract.
 *
 * @param {string} ownerId - Authenticated owner ID
 * @param {string} contractId - Reviewed, unexpired contract ID
 * @param {Object} options - { dbPool, spawnFn }
 * @returns {Promise<Object>} { success, run }
 */
export async function startApprovedTestRun(ownerId, contractId, options = {}) {
    // 1. Validate owner and contract ID inputs
    if (!ownerId || typeof ownerId !== 'string' || !ownerId.trim()) {
        return { success: false, error: 'Valid owner identification required.' };
    }
    if (!contractId || typeof contractId !== 'string' || !contractId.trim()) {
        return { success: false, error: 'Valid contractId is required.' };
    }

    const { dbPool = null, spawnFn = null } = options;

    // 2. Fetch contract & enforce owner isolation
    const contractRes = await getApprovalContractById(ownerId, contractId.trim(), { dbPool });
    if (!contractRes.success || !contractRes.contract) {
        return { success: false, error: 'Approval contract not found or unauthorized.', forbidden: true };
    }

    const contract = contractRes.contract;

    // 3. Enforce contract state precondition: Must be 'reviewed'
    if (contract.state !== 'reviewed') {
        return {
            success: false,
            error: `Contract is in '${contract.state}' state. A test run requires an owner-reviewed, unexpired contract.`
        };
    }

    // 4. Enforce expiry precondition: Must be unexpired at start instant
    if (contract.executionExpiry) {
        const now = new Date();
        const expiry = new Date(contract.executionExpiry);
        if (now >= expiry) {
            return {
                success: false,
                error: 'Approval contract has expired. Cannot start test run.'
            };
        }
    }

    // 5. Enforce exact V0 test scope allowlist
    const commandScope = Array.isArray(contract.proposedCommandScope) ? contract.proposedCommandScope : [];
    if (commandScope.length !== 1) {
        // Append rejection event
        try {
            await appendPersonalTaskEvent(ownerId, contract.taskId, 'approval_test_run_rejected', {
                contractId: contract.id,
                reason: `Invalid command scope count (${commandScope.length}). Exact 1 allowed test required.`,
                summary: `Test run rejected: contract must specify exactly 1 test identifier.`
            }, dbPool);
        } catch {}
        return {
            success: false,
            error: `Scope violation: V0 requires exactly 1 approved test identifier in contract command scope.`
        };
    }

    const requestedTestId = commandScope[0];
    const testMapping = ALLOWED_TEST_IDENTIFIERS[requestedTestId];
    if (!testMapping) {
        // Append rejection event
        try {
            await appendPersonalTaskEvent(ownerId, contract.taskId, 'approval_test_run_rejected', {
                contractId: contract.id,
                testIdentifier: requestedTestId,
                reason: `Test identifier '${requestedTestId}' is not in V0 allowlist.`,
                summary: `Test run rejected: '${requestedTestId}' is not permitted.`
            }, dbPool);
        } catch {}
        return {
            success: false,
            error: `Scope violation: '${requestedTestId}' is not an approved V0 test. Permitted tests: ${Object.keys(ALLOWED_TEST_IDENTIFIERS).join(', ')}.`
        };
    }

    // 6. Enforce One Run at a Time per contract
    if (!runStore.has(String(ownerId))) {
        runStore.set(String(ownerId), new Map());
    }
    const ownerRuns = runStore.get(String(ownerId));
    for (const existingRun of ownerRuns.values()) {
        if (existingRun.contractId === contract.id && ['queued', 'running', 'cancel_requested'].includes(existingRun.state)) {
            return {
                success: true,
                conflict: true,
                message: 'An active test run is already in progress for this contract.',
                run: existingRun
            };
        }
    }

    // 7. Initialize Run Record
    const runId = generateRunId('trun');
    const nowIso = new Date().toISOString();

    const runRecord = {
        id: runId,
        contractId: contract.id,
        taskId: contract.taskId,
        ownerId: String(ownerId),
        state: 'running',
        testIdentifier: requestedTestId,
        executable: testMapping.executable,
        args: [...testMapping.args],
        explicit_owner_start: true,
        preconditions: {
            contractStateAtStart: 'reviewed',
            expiryObservedAtStart: contract.executionExpiry,
            unexpired: true,
            exactApprovedTest: requestedTestId
        },
        scopeFacts: {
            production_files_changed: 0,
            production_file_write_authority: false
        },
        result: {
            exitCode: null,
            exitSignal: null,
            durationMs: null,
            stdout: '',
            stderr: '',
            output_truncated: false
        },
        cancellation: {
            requested: false,
            requestedAt: null,
            cancelledAt: null
        },
        safetyBanner: WORKER_SAFETY_BANNER,
        createdAt: nowIso,
        startedAt: nowIso,
        finishedAt: null,
        updatedAt: nowIso
    };

    ownerRuns.set(runId, runRecord);

    // 8. Append 'approval_test_run_started' event to Task Activity Ledger
    try {
        const eventDetail = {
            runId,
            contractId: contract.id,
            testIdentifier: requestedTestId,
            startedAt: nowIso,
            summary: `Owner started approved test run '${requestedTestId}' [${runId}].`
        };
        await appendPersonalTaskEvent(ownerId, contract.taskId, 'approval_test_run_started', eventDetail, dbPool);
    } catch (evtErr) {
        console.warn('[ApprovalTestWorker] Failed to append started event to ledger:', evtErr.message);
    }

    // 9. Execute Direct Process Spawn (shell: false, fixed cwd)
    const startTime = Date.now();
    const spawnExecutor = spawnFn || spawn;
    const timeoutDuration = testMapping.timeoutMs || DEFAULT_TIMEOUT_MS;

    let stdoutBuf = '';
    let stderrBuf = '';
    let isTruncated = false;
    let timeoutHandle = null;
    let hasEnded = false;

    const finalizeRun = async (terminalState, code, signal) => {
        if (hasEnded) return;
        hasEnded = true;

        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }
        activeProcesses.delete(runId);

        const durationMs = Date.now() - startTime;
        const finishedIso = new Date().toISOString();

        runRecord.state = terminalState;
        runRecord.finishedAt = finishedIso;
        runRecord.updatedAt = finishedIso;
        runRecord.result.exitCode = typeof code === 'number' ? code : (terminalState === 'succeeded' ? 0 : 1);
        runRecord.result.exitSignal = signal || null;
        runRecord.result.durationMs = durationMs;
        runRecord.result.stdout = stdoutBuf;
        runRecord.result.stderr = stderrBuf;
        runRecord.result.output_truncated = isTruncated;

        if (terminalState === 'cancelled') {
            runRecord.cancellation.cancelledAt = finishedIso;
        }

        // Map terminal state to event name
        let eventType = 'approval_test_run_failed';
        if (terminalState === 'succeeded') eventType = 'approval_test_run_succeeded';
        else if (terminalState === 'cancelled') eventType = 'approval_test_run_cancelled';
        else if (terminalState === 'timed_out') eventType = 'approval_test_run_timed_out';

        try {
            const eventDetail = {
                runId,
                contractId: contract.id,
                testIdentifier: requestedTestId,
                terminalState,
                exitCode: runRecord.result.exitCode,
                exitSignal: runRecord.result.exitSignal,
                durationMs,
                productionFilesChanged: 0,
                summary: `Approved test run '${requestedTestId}' finished with state '${terminalState}' (exit: ${runRecord.result.exitCode}, duration: ${durationMs}ms).`
            };
            await appendPersonalTaskEvent(ownerId, contract.taskId, eventType, eventDetail, dbPool);
        } catch (evtErr) {
            console.warn('[ApprovalTestWorker] Failed to append terminal event to ledger:', evtErr.message);
        }
    };

    try {
        const child = spawnExecutor(testMapping.executable, testMapping.args, {
            cwd: process.cwd(),
            shell: false,
            env: {
                ...process.env,
                NODE_ENV: process.env.NODE_ENV || 'development'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        activeProcesses.set(runId, child);

        timeoutHandle = setTimeout(() => {
            if (activeProcesses.has(runId)) {
                console.warn(`[ApprovalTestWorker] Run ${runId} timed out after ${timeoutDuration}ms. Sending SIGTERM.`);
                try {
                    child.kill('SIGTERM');
                } catch {}
                finalizeRun('timed_out', null, 'SIGTERM');
            }
        }, timeoutDuration);

        if (child.stdout) {
            child.stdout.on('data', (chunk) => {
                const text = chunk.toString();
                if (Buffer.byteLength(stdoutBuf + text, 'utf8') <= MAX_OUTPUT_BYTES) {
                    stdoutBuf += text;
                } else if (!isTruncated) {
                    const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(stdoutBuf, 'utf8');
                    if (remaining > 0) {
                        stdoutBuf += text.slice(0, remaining);
                    }
                    stdoutBuf += '\n... [Output Truncated at 16KB Limit]';
                    isTruncated = true;
                }
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (chunk) => {
                const text = chunk.toString();
                if (Buffer.byteLength(stderrBuf + text, 'utf8') <= MAX_OUTPUT_BYTES) {
                    stderrBuf += text;
                } else if (!isTruncated) {
                    const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(stderrBuf, 'utf8');
                    if (remaining > 0) {
                        stderrBuf += text.slice(0, remaining);
                    }
                    stderrBuf += '\n... [Stderr Truncated at 16KB Limit]';
                    isTruncated = true;
                }
            });
        }

        child.on('error', (err) => {
            stderrBuf += `\nSpawn Error: ${err.message}`;
            finalizeRun('failed', 1, null);
        });

        child.on('close', (code, signal) => {
            if (runRecord.cancellation.requested || signal === 'SIGTERM') {
                finalizeRun('cancelled', code, signal);
            } else if (code === 0) {
                finalizeRun('succeeded', 0, null);
            } else {
                finalizeRun('failed', code || 1, signal);
            }
        });

    } catch (spawnErr) {
        stderrBuf += `\nSynchronous Spawn Exception: ${spawnErr.message}`;
        await finalizeRun('failed', 1, null);
    }

    return {
        success: true,
        message: 'Approved test run started successfully.',
        run: runRecord
    };
}

/**
 * Gets a specific test run record by runId for an authenticated owner.
 */
export async function getApprovedTestRun(ownerId, runId, options = {}) {
    if (!ownerId || !runId) {
        return { success: false, error: 'Owner ID and Run ID required.' };
    }

    const ownerRuns = runStore.get(String(ownerId));
    if (!ownerRuns || !ownerRuns.has(String(runId))) {
        return { success: false, error: 'Test run not found or unauthorized.' };
    }

    const run = ownerRuns.get(String(runId));
    return {
        success: true,
        run
    };
}

/**
 * Gets the latest test run record for a specific contract.
 */
export async function getLatestTestRunForContract(ownerId, contractId, options = {}) {
    if (!ownerId || !contractId) {
        return { success: false, error: 'Owner ID and Contract ID required.' };
    }

    const ownerRuns = runStore.get(String(ownerId));
    if (!ownerRuns) {
        return { success: true, run: null };
    }

    let latestRun = null;
    for (const run of ownerRuns.values()) {
        if (run.contractId === contractId) {
            if (!latestRun || new Date(run.createdAt) > new Date(latestRun.createdAt)) {
                latestRun = run;
            }
        }
    }

    return {
        success: true,
        run: latestRun
    };
}

/**
 * Cancels an active approved test run using scoped SIGTERM.
 *
 * @param {string} ownerId - Authenticated owner ID
 * @param {string} runId - Run ID to cancel
 * @param {Object} options - { dbPool }
 * @returns {Promise<Object>} { success, run }
 */
export async function cancelApprovedTestRun(ownerId, runId, options = {}) {
    if (!ownerId || !runId) {
        return { success: false, error: 'Owner ID and Run ID required.' };
    }

    const { dbPool = null } = options;
    const ownerRuns = runStore.get(String(ownerId));
    if (!ownerRuns || !ownerRuns.has(String(runId))) {
        return { success: false, error: 'Test run not found or unauthorized.' };
    }

    const run = ownerRuns.get(String(runId));

    // Idempotency: if already in a terminal state, return existing record
    if (['succeeded', 'failed', 'cancelled', 'timed_out', 'rejected'].includes(run.state)) {
        return {
            success: true,
            isDuplicate: true,
            message: `Test run is already in terminal state '${run.state}'.`,
            run
        };
    }

    const nowIso = new Date().toISOString();
    run.cancellation.requested = true;
    run.cancellation.requestedAt = nowIso;
    run.state = 'cancel_requested';
    run.updatedAt = nowIso;

    // Append 'approval_test_run_cancel_requested' event to Task Activity Ledger
    try {
        const eventDetail = {
            runId: run.id,
            contractId: run.contractId,
            requestedAt: nowIso,
            summary: `Owner requested cancellation for test run '${run.testIdentifier}' [${run.id}].`
        };
        await appendPersonalTaskEvent(ownerId, run.taskId, 'approval_test_run_cancel_requested', eventDetail, dbPool);
    } catch (evtErr) {
        console.warn('[ApprovalTestWorker] Failed to append cancel_requested event to ledger:', evtErr.message);
    }

    // Scoped SIGTERM to child process handle
    const child = activeProcesses.get(String(runId));
    if (child) {
        try {
            child.kill('SIGTERM');
        } catch (killErr) {
            console.warn(`[ApprovalTestWorker] Failed to send SIGTERM to child ${runId}:`, killErr.message);
        }
    }

    return {
        success: true,
        message: 'Cancellation requested for approved test run.',
        run
    };
}

export default {
    startApprovedTestRun,
    getApprovedTestRun,
    getLatestTestRunForContract,
    cancelApprovedTestRun,
    resetTestWorkerStoreForTesting,
    WORKER_SAFETY_BANNER,
    ALLOWED_TEST_IDENTIFIERS,
    ALLOWED_RUN_STATES,
    MAX_OUTPUT_BYTES,
    DEFAULT_TIMEOUT_MS
};
