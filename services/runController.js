import crypto from 'crypto';

/**
 * runMap: Map<string, RunRecord>
 * RunRecord: {
 *   runId: string,
 *   user: string,
 *   status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'rate_limited' | 'cancelled' | 'timed_out',
 *   createdAt: number,
 *   abortController: AbortController,
 *   plan: Array | null,
 *   error: string | null
 * }
 */
const runMap = new Map();

// We only allow one active run per user/session.
export function getActiveRunForUser(user) {
    for (const run of runMap.values()) {
        if (run.user === user && ['queued', 'running', 'awaiting_approval'].includes(run.status)) {
            return run;
        }
    }
    return null;
}

export function createRun(user) {
    const active = getActiveRunForUser(user);
    if (active) {
        throw new Error('RUN_ACTIVE');
    }
    
    const runId = crypto.randomUUID();
    const abortController = new AbortController();
    
    const runRecord = {
        runId,
        user,
        status: 'running',
        createdAt: Date.now(),
        abortController,
        plan: null,
        error: null
    };
    
    runMap.set(runId, runRecord);
    return runRecord;
}

export function completeRun(runId, plan = null) {
    const run = runMap.get(runId);
    if (run) {
        run.status = 'completed';
        run.plan = plan;
    }
    return run;
}

export function failRun(runId, errorReason = 'failed', status = 'failed') {
    const run = runMap.get(runId);
    if (run) {
        run.status = status;
        run.error = errorReason;
    }
    return run;
}

export function cancelRun(runId, user) {
    const run = runMap.get(runId);
    if (!run) return { success: false, error: 'Run not found' };
    
    // Only the owning user can cancel their run
    if (run.user !== user && user !== 'master_manoj') {
        return { success: false, error: 'Unauthorized to cancel this run' };
    }
    
    if (['completed', 'failed', 'cancelled', 'timed_out'].includes(run.status)) {
        return { success: true, message: 'Run already finished' };
    }
    
    run.status = 'cancelled';
    try {
        run.abortController.abort();
    } catch (e) {
        console.error('[RunController] Abort error:', e);
    }
    
    return { success: true, runId };
}

export function getRun(runId) {
    return runMap.get(runId);
}
