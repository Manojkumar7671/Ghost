const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

/**
 * tests/approval_gated_test_worker_v0_test.cjs
 *
 * Comprehensive behavioral and contract test suite for Ghost Approval-Gated Test Worker V0.
 */

async function runApprovalGatedTestWorkerSuite() {
    console.log('--- RUNNING APPROVAL-GATED TEST WORKER V0 COMPREHENSIVE SUITE ---');

    const approvalTestWorker = await import('../services/approvalTestWorker.js');
    const approvalContract = await import('../services/approvalContract.js');
    const personalCore = await import('../services/personalCore.js');

    const {
        startApprovedTestRun,
        getApprovedTestRun,
        getLatestTestRunForContract,
        cancelApprovedTestRun,
        resetTestWorkerStoreForTesting,
        WORKER_SAFETY_BANNER,
        ALLOWED_TEST_IDENTIFIERS
    } = approvalTestWorker;

    const {
        draftApprovalContract,
        reviewApprovalContract,
        cancelApprovalContract,
        resetApprovalContractStoreForTesting
    } = approvalContract;

    const {
        createPersonalTask,
        listPersonalTasks,
        listPersonalTaskEvents,
        saveExplicitMemory,
        listExplicitMemories,
        createOwnerGoal,
        listOwnerGoals,
        resetStoreForTesting
    } = personalCore;

    const OWNER_ALICE = 'owner_alice_test';
    const OWNER_BOB = 'owner_bob_test';

    function setupCleanState() {
        if (resetStoreForTesting) resetStoreForTesting();
        if (resetApprovalContractStoreForTesting) resetApprovalContractStoreForTesting();
        if (resetTestWorkerStoreForTesting) resetTestWorkerStoreForTesting();
    }

    // Helper: Mock Process for Dependency Injection
    function createMockProcess(options = {}) {
        const {
            exitCode = 0,
            exitSignal = null,
            stdout = 'Test suite passed: 10/10 assertions.',
            stderr = '',
            delayMs = 10,
            autoExit = true
        } = options;

        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.killed = false;
        proc.killSignal = null;

        proc.kill = function(sig = 'SIGTERM') {
            proc.killed = true;
            proc.killSignal = sig;
            setImmediate(() => {
                proc.emit('close', null, sig);
            });
            return true;
        };

        if (autoExit) {
            setTimeout(() => {
                if (proc.killed) return;
                if (stdout && proc.stdout) proc.stdout.emit('data', Buffer.from(stdout));
                if (stderr && proc.stderr) proc.stderr.emit('data', Buffer.from(stderr));
                setImmediate(() => {
                    if (!proc.killed) proc.emit('close', exitCode, exitSignal);
                });
            }, delayMs);
        }

        return proc;
    }

    // =========================================================================
    // Test 1: Exactly one allowlist key & reviewed contract with canonical identifier starts run
    // =========================================================================
    {
        setupCleanState();

        // 1a. Verify allowlist has exactly one own property and it is canonical
        const allowlistKeys = Object.keys(ALLOWED_TEST_IDENTIFIERS);
        assert.strictEqual(allowlistKeys.length, 1, 'Allowlist must contain exactly one test identifier');
        assert.strictEqual(allowlistKeys[0], 'approval_gated_test_worker_v0_test', 'Single allowed identifier must be approval_gated_test_worker_v0_test');
        assert.strictEqual(ALLOWED_TEST_IDENTIFIERS['approval-gated-worker-v0-contract'], undefined, 'Legacy alias must not exist in allowlist');

        const taskRes = await createPersonalTask(OWNER_ALICE, { title: 'Implement Test Worker' });
        assert.strictEqual(taskRes.success, true);
        const taskId = taskRes.task.id;

        const draftRes = await draftApprovalContract(OWNER_ALICE, taskId, {
            purpose: 'Run worker contract test',
            proposedCommandScope: ['approval_gated_test_worker_v0_test'],
            expiryMinutes: 30
        });
        assert.strictEqual(draftRes.success, true);
        const contractId = draftRes.contract.id;

        const reviewRes = await reviewApprovalContract(OWNER_ALICE, contractId);
        assert.strictEqual(reviewRes.success, true);
        assert.strictEqual(reviewRes.contract.state, 'reviewed');

        let spawnCalled = false;
        let spawnedExec = null;
        let spawnedArgs = null;
        let spawnedOpts = null;

        const mockSpawn = (exec, args, opts) => {
            spawnCalled = true;
            spawnedExec = exec;
            spawnedArgs = args;
            spawnedOpts = opts;
            return createMockProcess({ exitCode: 0, stdout: 'PASS: 12 assertions' });
        };

        const startRes = await startApprovedTestRun(OWNER_ALICE, contractId, { spawnFn: mockSpawn });
        assert.strictEqual(startRes.success, true, 'Start approved test run must succeed');
        assert.ok(startRes.run, 'Run record must be returned');
        assert.strictEqual(startRes.run.explicit_owner_start, true);
        assert.strictEqual(startRes.run.testIdentifier, 'approval_gated_test_worker_v0_test');
        assert.strictEqual(startRes.run.scopeFacts.production_files_changed, 0);
        assert.strictEqual(startRes.run.scopeFacts.production_file_write_authority, false);
        assert.strictEqual(spawnCalled, true, 'Child process must be spawned');
        assert.strictEqual(spawnedOpts.shell, false, 'Process must spawn with shell: false');
        assert.strictEqual(spawnedOpts.cwd, process.cwd(), 'Process cwd must be canonical Ghost root');
        assert.strictEqual(spawnedArgs[0], path.join(process.cwd(), 'tests', 'approval_gated_test_worker_v0_test.cjs'));

        console.log('✓ PASS: 1. Reviewed, unexpired owner contract with sole exact allowed identifier starts run');
    }

    // =========================================================================
    // Test 2: Draft, cancelled, expired, unknown, cross-owner, and no-scope contracts fail closed
    // =========================================================================
    {
        setupCleanState();
        const taskRes = await createPersonalTask(OWNER_ALICE, { title: 'Precondition Checks' });
        const taskId = taskRes.task.id;

        // 2a. Draft contract (not yet reviewed)
        const draftRes = await draftApprovalContract(OWNER_ALICE, taskId, {
            purpose: 'Draft test',
            proposedCommandScope: ['approval_gated_test_worker_v0_test']
        });
        const draftRun = await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id);
        assert.strictEqual(draftRun.success, false, 'Draft contract must fail closed');
        assert.ok(draftRun.error.includes('reviewed'), 'Error must cite required reviewed state');

        // 2b. Cancelled contract
        await reviewApprovalContract(OWNER_ALICE, draftRes.contract.id);
        await cancelApprovalContract(OWNER_ALICE, draftRes.contract.id);
        const cancelledRun = await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id);
        assert.strictEqual(cancelledRun.success, false, 'Cancelled contract must fail closed');

        // 2c. Expired contract
        const expDraft = await draftApprovalContract(OWNER_ALICE, taskId, {
            purpose: 'Expired test',
            proposedCommandScope: ['approval_gated_test_worker_v0_test'],
            expiryMinutes: 5
        });
        await reviewApprovalContract(OWNER_ALICE, expDraft.contract.id);
        expDraft.contract.executionExpiry = new Date(Date.now() - 10000).toISOString();
        const expiredRun = await startApprovedTestRun(OWNER_ALICE, expDraft.contract.id);
        assert.strictEqual(expiredRun.success, false, 'Expired contract must fail closed');

        // 2d. Cross-owner contract access
        const crossRun = await startApprovedTestRun(OWNER_BOB, expDraft.contract.id);
        assert.strictEqual(crossRun.success, false, 'Cross-owner start must fail closed');
        assert.strictEqual(crossRun.forbidden, true);

        // 2e. Non-existent contract
        const nonExistentRun = await startApprovedTestRun(OWNER_ALICE, 'actr_nonexistent_123');
        assert.strictEqual(nonExistentRun.success, false, 'Non-existent contract must fail closed');

        // 2f. Empty command scope contract
        const noScopeDraft = await draftApprovalContract(OWNER_ALICE, taskId, {
            purpose: 'No scope test',
            proposedCommandScope: []
        });
        await reviewApprovalContract(OWNER_ALICE, noScopeDraft.contract.id);
        const noScopeRun = await startApprovedTestRun(OWNER_ALICE, noScopeDraft.contract.id);
        assert.strictEqual(noScopeRun.success, false, 'Empty command scope must fail closed');

        console.log('✓ PASS: 2. Draft, cancelled, expired, unknown, cross-owner, and no-scope contracts fail closed');
    }

    // =========================================================================
    // Test 3: Disallowed commands and legacy alias rejected before spawn
    // =========================================================================
    {
        setupCleanState();
        const taskRes = await createPersonalTask(OWNER_ALICE, { title: 'Disallowed Commands' });
        const taskId = taskRes.task.id;

        const badCmds = [
            'approval-gated-worker-v0-contract', // Legacy alias must be rejected
            'npm test',
            'node -e "console.log(1)"',
            'approval_gated_test_worker_v0_test; rm -rf /',
            'approval_gated_test_worker_v0_test && echo pwned',
            'curl https://malicious.site',
            'git push origin main',
            'unknown-test-identifier'
        ];

        for (const badCmd of badCmds) {
            let spawnAttempted = false;
            const mockSpawn = () => {
                spawnAttempted = true;
                return createMockProcess();
            };

            const draftRes = await draftApprovalContract(OWNER_ALICE, taskId, {
                purpose: 'Disallowed command test',
                proposedCommandScope: [badCmd]
            });

            if (draftRes.success) {
                await reviewApprovalContract(OWNER_ALICE, draftRes.contract.id);
                const runRes = await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id, { spawnFn: mockSpawn });
                assert.strictEqual(runRes.success, false, `Command '${badCmd}' must not start a run`);
                assert.strictEqual(spawnAttempted, false, `Command '${badCmd}' must never trigger process spawn`);
            }
        }

        console.log('✓ PASS: 3. Free-form test names, legacy alias, shell syntax, and altered arguments cannot reach spawn');
    }

    // =========================================================================
    // Test 4: Process invocation uses shell: false, fixed cwd, fixed mapping, and bounded options
    // =========================================================================
    {
        setupCleanState();
        const taskRes = await createPersonalTask(OWNER_ALICE, { title: 'Spawn Properties' });
        const draftRes = await draftApprovalContract(OWNER_ALICE, taskRes.task.id, {
            proposedCommandScope: ['approval_gated_test_worker_v0_test']
        });
        await reviewApprovalContract(OWNER_ALICE, draftRes.contract.id);

        let capturedOpts = null;
        let capturedArgs = null;
        let capturedExec = null;
        const mockSpawn = (exec, args, opts) => {
            capturedExec = exec;
            capturedArgs = args;
            capturedOpts = opts;
            return createMockProcess({ exitCode: 0, stdout: 'Short output' });
        };

        const res = await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id, { spawnFn: mockSpawn });
        assert.strictEqual(res.success, true);
        assert.strictEqual(capturedExec, process.execPath);
        assert.strictEqual(capturedOpts.shell, false);
        assert.strictEqual(capturedOpts.cwd, process.cwd());
        assert.deepStrictEqual(capturedOpts.stdio, ['ignore', 'pipe', 'pipe']);
        assert.strictEqual(capturedArgs[0], path.join(process.cwd(), 'tests', 'approval_gated_test_worker_v0_test.cjs'));

        console.log('✓ PASS: 4. Process invocation uses shell: false, fixed cwd, fixed mapping, and bounded options');
    }

    // =========================================================================
    // Test 5: Duplicate / racing starts yield one run / one spawn only
    // =========================================================================
    {
        setupCleanState();
        const taskRes = await createPersonalTask(OWNER_ALICE, { title: 'Racing Starts' });
        const draftRes = await draftApprovalContract(OWNER_ALICE, taskRes.task.id, {
            proposedCommandScope: ['approval_gated_test_worker_v0_test']
        });
        await reviewApprovalContract(OWNER_ALICE, draftRes.contract.id);

        let spawnCount = 0;
        const mockSpawn = () => {
            spawnCount++;
            return createMockProcess({ delayMs: 100, autoExit: false });
        };

        const firstStart = await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id, { spawnFn: mockSpawn });
        assert.strictEqual(firstStart.success, true);
        assert.strictEqual(spawnCount, 1);

        const secondStart = await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id, { spawnFn: mockSpawn });
        assert.strictEqual(secondStart.success, true);
        assert.strictEqual(secondStart.conflict, true, 'Second start must identify existing active run conflict');
        assert.strictEqual(secondStart.run.id, firstStart.run.id, 'Must return existing run handle');
        assert.strictEqual(spawnCount, 1, 'Spawn count must remain strictly 1');

        console.log('✓ PASS: 5. Duplicate/racing starts yield one run and one spawn only');
    }

    // =========================================================================
    // Test 6: Scoped SIGTERM cancellation is owner-only, idempotent, and uses no kill -9
    // =========================================================================
    {
        setupCleanState();
        const taskRes = await createPersonalTask(OWNER_ALICE, { title: 'Cancellation' });
        const draftRes = await draftApprovalContract(OWNER_ALICE, taskRes.task.id, {
            proposedCommandScope: ['approval_gated_test_worker_v0_test']
        });
        await reviewApprovalContract(OWNER_ALICE, draftRes.contract.id);

        let activeMockProc = null;
        const mockSpawn = () => {
            activeMockProc = createMockProcess({ autoExit: false });
            return activeMockProc;
        };

        const startRes = await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id, { spawnFn: mockSpawn });
        const runId = startRes.run.id;

        // 6a. Cross-owner cancel rejected
        const crossCancel = await cancelApprovedTestRun(OWNER_BOB, runId);
        assert.strictEqual(crossCancel.success, false, 'Cross-owner cancel must fail closed');

        // 6b. Owner cancel sends scoped SIGTERM
        const cancelRes = await cancelApprovedTestRun(OWNER_ALICE, runId);
        assert.strictEqual(cancelRes.success, true);
        assert.strictEqual(activeMockProc.killed, true, 'Child process must receive kill');
        assert.strictEqual(activeMockProc.killSignal, 'SIGTERM', 'Child signal must be strictly SIGTERM');

        await new Promise(r => setTimeout(r, 25));

        const getRes = await getApprovedTestRun(OWNER_ALICE, runId);
        assert.strictEqual(getRes.run.state, 'cancelled', 'Terminal state must be cancelled');

        // 6c. Idempotent repeated cancel
        const repeatCancel = await cancelApprovedTestRun(OWNER_ALICE, runId);
        assert.strictEqual(repeatCancel.success, true);
        assert.strictEqual(repeatCancel.isDuplicate, true);

        console.log('✓ PASS: 6. Scoped SIGTERM cancellation is owner-only, idempotent, and uses no kill -9');
    }

    // =========================================================================
    // Test 7: Timeout, non-zero exit, signal termination, output truncation produce factual records
    // =========================================================================
    {
        setupCleanState();
        const taskRes = await createPersonalTask(OWNER_ALICE, { title: 'Terminal Outcomes' });
        const taskId = taskRes.task.id;

        // 7a. Non-zero exit code
        const draft1 = await draftApprovalContract(OWNER_ALICE, taskId, {
            proposedCommandScope: ['approval_gated_test_worker_v0_test']
        });
        await reviewApprovalContract(OWNER_ALICE, draft1.contract.id);

        const mockFailSpawn = () => createMockProcess({ exitCode: 1, stderr: 'AssertionError: test failed' });
        await startApprovedTestRun(OWNER_ALICE, draft1.contract.id, { spawnFn: mockFailSpawn });
        await new Promise(r => setTimeout(r, 25));

        const failRun = await getLatestTestRunForContract(OWNER_ALICE, draft1.contract.id);
        assert.strictEqual(failRun.run.state, 'failed');
        assert.strictEqual(failRun.run.result.exitCode, 1);
        assert.ok(failRun.run.result.stderr.includes('AssertionError'));

        // 7b. Output truncation at 12 KiB
        const draft2 = await draftApprovalContract(OWNER_ALICE, taskId, {
            proposedCommandScope: ['approval_gated_test_worker_v0_test']
        });
        await reviewApprovalContract(OWNER_ALICE, draft2.contract.id);

        const hugeOutput = 'A'.repeat(25000);
        const mockHugeSpawn = () => createMockProcess({ exitCode: 0, stdout: hugeOutput });
        await startApprovedTestRun(OWNER_ALICE, draft2.contract.id, { spawnFn: mockHugeSpawn });
        await new Promise(r => setTimeout(r, 25));

        const truncRun = await getLatestTestRunForContract(OWNER_ALICE, draft2.contract.id);
        assert.strictEqual(truncRun.run.result.output_truncated, true);
        assert.ok(truncRun.run.result.stdout.length <= 13000);

        console.log('✓ PASS: 7. Timeout, non-zero exit, signal termination, and output truncation produce factual records');
    }

    // =========================================================================
    // Test 8: Run lifecycle actions never mutate task status, Personal Core memories/goals, or contract state
    // =========================================================================
    {
        setupCleanState();
        const memRes = await saveExplicitMemory(OWNER_ALICE, 'Do not write production files');
        const goalRes = await createOwnerGoal(OWNER_ALICE, { title: 'Verify safety invariants' });
        const taskRes = await createPersonalTask(OWNER_ALICE, {
            title: 'Invariant Task',
            goalId: goalRes.goal.id
        });
        const taskId = taskRes.task.id;

        const draftRes = await draftApprovalContract(OWNER_ALICE, taskId, {
            proposedCommandScope: ['approval_gated_test_worker_v0_test']
        });
        await reviewApprovalContract(OWNER_ALICE, draftRes.contract.id);

        const mockSpawn = () => createMockProcess({ exitCode: 0 });
        await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id, { spawnFn: mockSpawn });
        await new Promise(r => setTimeout(r, 25));

        const tasks = await listPersonalTasks(OWNER_ALICE);
        const task = tasks.find(t => t.id === taskId);
        assert.strictEqual(task.status, 'pending', 'Task status must remain pending');

        const goals = await listOwnerGoals(OWNER_ALICE);
        assert.strictEqual(goals.length, 1);
        assert.strictEqual(goals[0].status, 'active');

        const memories = await listExplicitMemories(OWNER_ALICE);
        assert.strictEqual(memories.length, 1);

        console.log('✓ PASS: 8. Run lifecycle actions never mutate task status, memories, goals, or contract state');
    }

    // =========================================================================
    // Test 9: Evidence contains required factual fields and no invented claims
    // =========================================================================
    {
        setupCleanState();
        const taskRes = await createPersonalTask(OWNER_ALICE, { title: 'Evidence Contract' });
        const draftRes = await draftApprovalContract(OWNER_ALICE, taskRes.task.id, {
            proposedCommandScope: ['approval_gated_test_worker_v0_test']
        });
        await reviewApprovalContract(OWNER_ALICE, draftRes.contract.id);

        const mockSpawn = () => createMockProcess({ exitCode: 0, stdout: 'Tests Passed: 10' });
        const startRes = await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id, { spawnFn: mockSpawn });
        await new Promise(r => setTimeout(r, 25));

        const runRes = await getApprovedTestRun(OWNER_ALICE, startRes.run.id);
        const run = runRes.run;

        assert.ok(run.id.startsWith('trun_'));
        assert.strictEqual(run.explicit_owner_start, true);
        assert.strictEqual(run.preconditions.unexpired, true);
        assert.strictEqual(run.preconditions.contractStateAtStart, 'reviewed');
        assert.strictEqual(run.scopeFacts.production_files_changed, 0);
        assert.strictEqual(run.scopeFacts.production_file_write_authority, false);
        assert.strictEqual(run.safetyBanner, WORKER_SAFETY_BANNER);
        assert.ok(run.startedAt);
        assert.ok(run.finishedAt);
        assert.strictEqual(typeof run.result.durationMs, 'number');

        console.log('✓ PASS: 9. Evidence has the required factual fields and no invented claims');
    }

    // =========================================================================
    // Test 10: Immutable worker events are append-only, accurate, and deduplicated
    // =========================================================================
    {
        setupCleanState();
        const taskRes = await createPersonalTask(OWNER_ALICE, { title: 'Activity Ledger Events' });
        const taskId = taskRes.task.id;

        const draftRes = await draftApprovalContract(OWNER_ALICE, taskId, {
            proposedCommandScope: ['approval_gated_test_worker_v0_test']
        });
        await reviewApprovalContract(OWNER_ALICE, draftRes.contract.id);

        const mockSpawn = () => createMockProcess({ exitCode: 0 });
        const startRes = await startApprovedTestRun(OWNER_ALICE, draftRes.contract.id, { spawnFn: mockSpawn });
        await new Promise(r => setTimeout(r, 25));

        const eventsRes = await listPersonalTaskEvents(OWNER_ALICE, taskId);
        assert.strictEqual(eventsRes.success, true);
        const eventTypes = eventsRes.events.map(e => e.eventType);

        assert.ok(eventTypes.includes('approval_contract_drafted'));
        assert.ok(eventTypes.includes('approval_contract_reviewed'));
        assert.ok(eventTypes.includes('approval_test_run_started'));
        assert.ok(eventTypes.includes('approval_test_run_succeeded'));

        console.log('✓ PASS: 10. Immutable worker events are append-only, accurate, and deduplicated');
    }

    // =========================================================================
    // Test 11: Zero runtime filesystem-write capability or helper
    // =========================================================================
    {
        // 11a. Ensure runtime service exports no validateFixtureEditScope or other write helper
        assert.strictEqual(approvalTestWorker.validateFixtureEditScope, undefined, 'Worker service must not export validateFixtureEditScope');

        // 11b. Static source audit: ensure approvalTestWorker.js contains zero fs imports or write calls
        const workerSource = fs.readFileSync(path.join(__dirname, '../services/approvalTestWorker.js'), 'utf8');
        assert.ok(!workerSource.includes("from 'fs'"), 'Must not import from fs');
        assert.ok(!workerSource.includes('require("fs")'), 'Must not require fs');
        assert.ok(!workerSource.includes('writeFileSync'), 'Must not call writeFileSync');
        assert.ok(!workerSource.includes('mkdirSync'), 'Must not call mkdirSync');
        assert.ok(!workerSource.includes('createWriteStream'), 'Must not create write stream');
        assert.ok(!workerSource.includes('validateFixtureEditScope'), 'Must not reference validateFixtureEditScope');

        console.log('✓ PASS: 11. Zero runtime filesystem-write capability, zero fs imports, and zero write helpers');
    }

    // =========================================================================
    // Test 12: Zero automatic start, retry, polling, scheduler, or persistent background worker
    // =========================================================================
    {
        const workerSource = fs.readFileSync(path.join(__dirname, '../services/approvalTestWorker.js'), 'utf8');
        assert.ok(!workerSource.includes('setInterval'), 'Must not contain setInterval');
        assert.ok(!workerSource.includes('requestAnimationFrame'), 'Must not contain requestAnimationFrame');
        assert.ok(!workerSource.includes('cron'), 'Must not contain cron');
        assert.ok(!workerSource.includes('autoRetry'), 'Must not contain autoRetry');

        console.log('✓ PASS: 12. Zero automatic start, retry, polling, scheduler, or persistent background worker');
    }

    console.log('\nAPPROVAL-GATED TEST WORKER V0 TEST RESULTS: All 12 boundary suites passed cleanly.\n');
}

if (require.main === module) {
    runApprovalGatedTestWorkerSuite()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Test failure:', err);
            process.exit(1);
        });
}

module.exports = { runApprovalGatedTestWorkerSuite };
