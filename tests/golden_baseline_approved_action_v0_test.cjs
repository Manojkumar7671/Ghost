const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function runTest() {
    console.log("--- RUNNING GOLDEN BASELINE APPROVED ACTION V0 TEST SUITE ---");

    const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

    // Extract exact intent regexes safely without eval
    const prepareGoldenMatch = serverSource.match(/isPrepareGoldenIntent = \/([^/]+)\/i\.test/);
    assert.ok(prepareGoldenMatch, "Could not find isPrepareGoldenIntent regex");
    const prepareGoldenRegex = new RegExp(prepareGoldenMatch[1], 'i');

    assert.ok(prepareGoldenRegex.test('prepare test: golden baseline'.trim()), "Should match exact phrase");
    assert.ok(prepareGoldenRegex.test('PREPARE test:  golden baseline '.trim()), "Should match case-insensitive whitespace-padded");
    assert.ok(!prepareGoldenRegex.test('prepare test: golden baseline please'.trim()), "Should reject trailing junk");
    assert.ok(!prepareGoldenRegex.test('prepare test: another test'.trim()), "Should reject unrelated test");

    // Verify owner gating is applied globally to prepare block
    assert.ok(serverSource.includes('if (!testOwner || !testOwner.isOwner) {'), "Must include owner gate for prepare/confirm");
    
    // Test the Helper Service
    const helperUrl = pathToFileURL(path.resolve(__dirname, '../services/approvedTestRunner.js')).href;
    const runner = await import(helperUrl);

    // Mock Date.now for expiry testing
    const originalDateNow = Date.now;
    let mockTime = 1000000000000;
    Date.now = () => mockTime;

    try {
        const ownerId = "test_owner_456";
        const proposalId = runner.createProposal(ownerId, 'golden_baseline');
        assert.ok(proposalId, "Proposal must be created");
        
        // Cannot overwrite existing
        const duplicateId = runner.createProposal(ownerId, 'golden_baseline');
        assert.strictEqual(duplicateId, null, "Must not overwrite existing valid proposal");

        // Expiry test
        mockTime += 6 * 60 * 1000; // Fast forward 6 minutes
        const expiredConsumed = runner.consumeProposal(ownerId);
        assert.strictEqual(expiredConsumed, null, "Expired proposal must not be consumed");

        // Re-create and test correct consumption
        mockTime = 1000000000000;
        runner.createProposal(ownerId, 'golden_baseline');
        
        // Confirmation consumes proposal before execution
        const correctConsumed = runner.consumeProposal(ownerId);
        assert.strictEqual(correctConsumed, 'golden_baseline', "Correct owner should consume proposal and return key");

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
            const result = await runner.executeAllowlistedTest(ownerId, 'golden_baseline');
            
            assert.deepStrictEqual(Object.keys(result).sort(), ['execution', 'runId', 'success', 'text'], "Must return exactly the 4 required fields");
            assert.strictEqual(result.runId, null, "runId must be null by default in helper");
            assert.strictEqual(execFileArgs.cmd, process.execPath, "Must use process.execPath");
            assert.deepStrictEqual(execFileArgs.args, ['tests/golden_regression_v0_test.cjs'], "Must use exact literal array arg");
            assert.strictEqual(execFileArgs.options.shell, false, "Must use shell: false");
            assert.strictEqual(execFileArgs.options.cwd, path.resolve(__dirname, '..'), "Must use fixed project cwd");
            assert.strictEqual(execFileArgs.options.timeout, 30000, "Must use 30s timeout");
            assert.strictEqual(execFileArgs.options.maxBuffer, 2048, "Must use strict small maxBuffer");

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.execution.state, 'succeeded');
            assert.ok(!result.text.includes('RAW_STDOUT'), "Raw output must not appear");
            assert.ok(result.text.includes('Golden Baseline'), "Result text should identify Golden Baseline");

        } finally {
            cp.execFile = originalExecFile;
        }
    } finally {
        Date.now = originalDateNow;
    }

    console.log("✓ All golden baseline approved action requirements validated.");
}

runTest().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
