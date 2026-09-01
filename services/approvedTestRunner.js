import cp from 'child_process';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const proposals = new Map();
const lastResults = new Map();

const ALLOWLIST = {
    'session_context': 'tests/session_context_v0_test.cjs',
    'golden_baseline': 'tests/golden_regression_v0_test.cjs'
};

export function createProposal(ownerId, testKey) {
    if (!ALLOWLIST[testKey]) return null;
    
    const existing = proposals.get(ownerId);
    if (existing && Date.now() <= existing.expiresAt) {
        return null;
    }
    
    const proposalId = crypto.randomUUID();
    proposals.set(ownerId, {
        proposalId,
        testKey,
        expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    });
    return proposalId;
}

export function consumeProposal(ownerId) {
    const proposal = proposals.get(ownerId);
    if (!proposal || Date.now() > proposal.expiresAt) {
        proposals.delete(ownerId);
        return null;
    }
    proposals.delete(ownerId);
    return proposal.testKey;
}

export function cancelProposal(ownerId) {
    const proposal = proposals.get(ownerId);
    if (!proposal) return false;
    if (Date.now() > proposal.expiresAt) {
        proposals.delete(ownerId);
        return false;
    }
    proposals.delete(ownerId);
    return true;
}

export function getPendingProposalSnapshot(ownerId) {
    const proposal = proposals.get(ownerId);
    if (!proposal) return null;
    if (Date.now() > proposal.expiresAt) {
        proposals.delete(ownerId);
        return null;
    }
    return {
        testKey: ALLOWLIST[proposal.testKey],
        label: proposal.testKey === 'golden_baseline' ? 'Golden Baseline' : 'Session Context',
        expiresAt: proposal.expiresAt
    };
}

export function getLatestResultSnapshot(ownerId) {
    return lastResults.get(ownerId) || null;
}

export async function executeAllowlistedTest(ownerId, testKey) {
    return new Promise((resolve) => {
        const testPath = ALLOWLIST[testKey];
        if (!testPath) {
            return resolve({
                success: false,
                text: "Invalid test key.",
                runId: null,
                execution: { state: "failed", taskId: null, summary: "Invalid test key.", artifacts: [] }
            });
        }
        
        const projectRoot = path.resolve(__dirname, '..');
        const label = testKey === 'golden_baseline' ? 'Golden Baseline' : 'Session Context';
        
        cp.execFile(process.execPath, [testPath], {
            cwd: projectRoot,
            shell: false,
            timeout: 30000,
            maxBuffer: 2048
        }, (error) => {
            let result;
            if (error) {
                let summary = 'Test process failed to start';
                if (error.killed) {
                    summary = 'Test timed out';
                } else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
                    summary = 'Test output exceeded the safety bound';
                } else if (error.code !== undefined && error.code !== null) {
                    summary = `Test exited with error: ${error.code}`;
                }
                
                result = {
                    success: false,
                    text: `The ${label} allowlisted test failed. Result: ${summary}. No raw process output is returned for safety.`,
                    runId: null,
                    execution: {
                        state: "failed",
                        taskId: null,
                        summary: summary,
                        artifacts: []
                    }
                };
            } else {
                result = {
                    success: true,
                    text: `The ${label} allowlisted test completed successfully. All isolation bounds were respected.`,
                    runId: null,
                    execution: {
                        state: "succeeded",
                        taskId: null,
                        summary: "Test run completed successfully.",
                        artifacts: []
                    }
                };
            }
            if (ownerId) {
                lastResults.set(ownerId, {
                    state: result.execution.state,
                    summary: result.execution.summary,
                    label: label
                });
            }
            resolve(result);
        });
    });
}
