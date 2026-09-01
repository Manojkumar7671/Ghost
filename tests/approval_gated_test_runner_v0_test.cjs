const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function runTest() {
    console.log("--- RUNNING APPROVAL-GATED TEST RUNNER V0 TEST SUITE ---");

    const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

    // Extract exact intent regexes safely without eval
    const prepareMatch = serverSource.match(/isPrepareSessionIntent = \/([^/]+)\/i\.test/);
    assert.ok(prepareMatch, "Could not find isPrepareSessionIntent regex");
    const prepareRegex = new RegExp(prepareMatch[1], 'i');

    assert.ok(prepareRegex.test('prepare test: session context'.trim()), "Should match exact phrase");
    assert.ok(prepareRegex.test('PREPARE test:  session context '.trim()), "Should match case-insensitive whitespace-padded");
    assert.ok(!prepareRegex.test('prepare test: session context please'.trim()), "Should reject trailing junk");
    assert.ok(!prepareRegex.test('prepare test: another test'.trim()), "Should reject unrelated test");

    const confirmMatch = serverSource.match(/isConfirmTestIntent = \/([^/]+)\/i\.test/);
    assert.ok(confirmMatch, "Could not find isConfirmTestIntent regex");
    const confirmRegex = new RegExp(confirmMatch[1], 'i');

    assert.ok(confirmRegex.test('confirm test run'.trim()), "Should match exact confirm phrase");
    assert.ok(confirmRegex.test('   CONFIRM TEST RUN   '.trim()), "Should match case-insensitive padded");
    assert.ok(!confirmRegex.test('confirm test run now'.trim()), "Should reject trailing junk");

    // Verify owner gating and safe fallback existence
    assert.ok(serverSource.includes('if (!testOwner || !testOwner.isOwner) {'), "Must include owner gate for prepare/confirm");
    
    // Assert exactly four fields and runId handled correctly
    assert.ok(serverSource.includes("runId: (typeof currentRun !== 'undefined' && currentRun) ? currentRun.runId : null"), "Must handle runId null fallback");
    
    // Test the Helper Service
    const helperUrl = pathToFileURL(path.resolve(__dirname, '../services/approvedTestRunner.js')).href;
    const runner = await import(helperUrl);

    // Mock Date.now for expiry testing
    const originalDateNow = Date.now;
    let mockTime = 1000000000000;
    Date.now = () => mockTime;

    try {
        const ownerId = "test_owner_123";
        const proposalId = runner.createProposal(ownerId, 'session_context');
        assert.ok(proposalId, "Proposal must be created");
        
        // Missing confirmation runs nothing
        const wrongOwnerConsumed = runner.consumeProposal("wrong_owner");
        assert.strictEqual(wrongOwnerConsumed, null, "Wrong owner should consume nothing");

        // Expiry test
        mockTime += 6 * 60 * 1000; // Fast forward 6 minutes
        const expiredConsumed = runner.consumeProposal(ownerId);
        assert.strictEqual(expiredConsumed, null, "Expired proposal must not be consumed");

        // Re-create and test correct consumption
        mockTime = 1000000000000;
        runner.createProposal(ownerId, 'session_context');
        
        // Confirmation consumes proposal before execution
        const correctConsumed = runner.consumeProposal(ownerId);
        assert.strictEqual(correctConsumed, 'session_context', "Correct owner should consume proposal and return key");
        const retryConsumed = runner.consumeProposal(ownerId);
        assert.strictEqual(retryConsumed, null, "Proposal MUST not be replayable");

        // Test execution mechanism with stubbed child_process
        const cp = require('child_process');
        const originalExecFile = cp.execFile;
        
        let execFileArgs = null;
        let mockError = null;
        let mockStdout = "RAW_STDOUT_SHOULD_NOT_APPEAR";
        let mockStderr = "RAW_STDERR_SHOULD_NOT_APPEAR";

        cp.execFile = (cmd, args, options, callback) => {
            execFileArgs = { cmd, args, options };
            setTimeout(() => {
                callback(mockError, mockStdout, mockStderr);
            }, 10);
            return {};
        };

        try {
            const result = await runner.executeAllowlistedTest(ownerId, 'session_context');
            
            assert.deepStrictEqual(Object.keys(result).sort(), ['execution', 'runId', 'success', 'text'], "Must return exactly the 4 required fields");
            assert.strictEqual(result.runId, null, "runId must be null by default in helper");
            assert.strictEqual(execFileArgs.cmd, process.execPath, "Must use process.execPath");
            assert.deepStrictEqual(execFileArgs.args, ['tests/session_context_v0_test.cjs'], "Must use exact literal array arg");
            assert.strictEqual(execFileArgs.options.shell, false, "Must use shell: false");
            assert.strictEqual(execFileArgs.options.cwd, path.resolve(__dirname, '..'), "Must use fixed project cwd");
            assert.strictEqual(execFileArgs.options.timeout, 30000, "Must use 30s timeout");
            assert.strictEqual(execFileArgs.options.maxBuffer, 2048, "Must use strict small maxBuffer");

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.execution.state, 'succeeded');
            assert.ok(!result.text.includes('RAW_STDOUT'), "Raw output must not appear");
            assert.ok(!result.text.includes('RAW_STDERR'), "Raw output must not appear");
            assert.ok(result.text.length < 500, "Returned text must be short");

            // Non-zero exit test
            mockError = new Error('RAW_ERROR_MESSAGE_SHOULD_NOT_APPEAR');
            mockError.code = 1;
            const failedResult = await runner.executeAllowlistedTest(ownerId, 'session_context');
            assert.strictEqual(failedResult.success, false, "Non-zero exit must have success: false");
            assert.strictEqual(failedResult.execution.state, 'failed');
            assert.strictEqual(failedResult.execution.summary, 'Test exited with error: 1');
            assert.deepStrictEqual(Object.keys(failedResult).sort(), ['execution', 'runId', 'success', 'text'], "Must return exactly the 4 required fields");
            assert.ok(!failedResult.text.includes('RAW_ERROR_MESSAGE'), "Raw error message must not appear");

            // Timeout test
            mockError = new Error('RAW_ERROR_MESSAGE_SHOULD_NOT_APPEAR');
            mockError.killed = true;
            const timeoutResult = await runner.executeAllowlistedTest(ownerId, 'session_context');
            assert.strictEqual(timeoutResult.success, false, "Timeout must have success: false");
            assert.strictEqual(timeoutResult.execution.state, 'failed');
            assert.strictEqual(timeoutResult.execution.summary, 'Test timed out');
            assert.ok(!timeoutResult.text.includes('RAW_ERROR_MESSAGE'), "Raw error message must not appear");

            // Cap error test
            mockError = new Error('RAW_ERROR_MESSAGE_SHOULD_NOT_APPEAR');
            mockError.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
            const capResult = await runner.executeAllowlistedTest(ownerId, 'session_context');
            assert.strictEqual(capResult.success, false, "Buffer error must have success: false");
            assert.strictEqual(capResult.execution.state, 'failed');
            assert.strictEqual(capResult.execution.summary, 'Test output exceeded the safety bound');
            assert.ok(!capResult.text.includes('RAW_ERROR_MESSAGE'), "Raw error message must not appear");

            // Spawn error test (no code, no kill, just generic error)
            mockError = new Error('RAW_ERROR_MESSAGE_SHOULD_NOT_APPEAR');
            const spawnResult = await runner.executeAllowlistedTest(ownerId, 'session_context');
            assert.strictEqual(spawnResult.success, false);
            assert.strictEqual(spawnResult.execution.summary, 'Test process failed to start');
            assert.ok(!spawnResult.text.includes('RAW_ERROR_MESSAGE'), "Raw error message must not appear");

        } finally {
            cp.execFile = originalExecFile;
        }
    } finally {
        Date.now = originalDateNow;
    }

    console.log("✓ All approval-gated test runner safety requirements validated.");
}

runTest().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
