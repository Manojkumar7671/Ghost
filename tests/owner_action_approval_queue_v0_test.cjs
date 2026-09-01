const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function runTest() {
    console.log("--- RUNNING OWNER ACTION & APPROVAL QUEUE V0 TEST SUITE ---");

    const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

    // Extract exact intent regex
    const queueMatch = serverSource.match(/isApprovalQueueIntent = \/([^/]+)\/i\.test/);
    assert.ok(queueMatch, "Could not find isApprovalQueueIntent regex");
    const queueRegex = new RegExp(queueMatch[1], 'i');

    // Intent test
    assert.ok(queueRegex.test('show my approval queue'.trim()), "Should match exact phrase");
    assert.ok(queueRegex.test('   SHOW my Approval Queue   '.trim()), "Should match case-insensitive whitespace-padded");
    assert.ok(!queueRegex.test('show my approval queue please'.trim()), "Should reject trailing junk");
    assert.ok(!queueRegex.test('show my approval'.trim()), "Should reject incomplete");

    // Location test
    const queueIndex = serverSource.indexOf('isApprovalQueueIntent');
    const prepareIndex = serverSource.indexOf('isPrepareSessionIntent');
    const fallbackIndex = serverSource.indexOf('isClearContextIntent');
    assert.ok(queueIndex < prepareIndex, "Queue branch must be before test runner branches");
    assert.ok(queueIndex < fallbackIndex, "Queue branch must be before clear context branch");

    // Field assertions & safety
    assert.ok(serverSource.includes('execution: { state: "not_started"'), "Queue branch must not start execution");

    // Test the Helper Service
    const helperUrl = pathToFileURL(path.resolve(__dirname, '../services/approvedTestRunner.js')).href;
    const runner = await import(helperUrl);

    // Mock Date.now
    const originalDateNow = Date.now;
    let mockTime = 1000000000000;
    Date.now = () => mockTime;

    try {
        const owner1 = "test_owner_1";
        const owner2 = "test_owner_2";
        
        // 1. Snapshot empty state
        assert.strictEqual(runner.getPendingProposalSnapshot(owner1), null, "Empty state must return null");
        assert.strictEqual(runner.getLatestResultSnapshot(owner1), null, "Empty result must return null");
        
        // 2. Create proposal and check isolation & ID omission
        const pId = runner.createProposal(owner1, 'session_context');
        const snapshot1 = runner.getPendingProposalSnapshot(owner1);
        assert.ok(snapshot1, "Snapshot must exist");
        assert.strictEqual(snapshot1.proposalId, undefined, "Snapshot must omit proposalId");
        assert.strictEqual(snapshot1.testKey, 'tests/session_context_v0_test.cjs');
        assert.strictEqual(snapshot1.label, 'Session Context');
        
        assert.strictEqual(runner.getPendingProposalSnapshot(owner2), null, "Snapshot must be owner-isolated");

        // 3. Expiry check (no extension)
        mockTime += 6 * 60 * 1000; // fast forward
        assert.strictEqual(runner.getPendingProposalSnapshot(owner1), null, "Expired proposal must not be displayed");

        // 4. Test terminal outcome recording
        // Recreate and execute
        mockTime = 1000000000000;
        runner.createProposal(owner1, 'session_context');
        runner.consumeProposal(owner1);

        const cp = require('child_process');
        const originalExecFile = cp.execFile;
        cp.execFile = (cmd, args, options, callback) => {
            setTimeout(() => callback(new Error("RAW"), "stdout", "stderr"), 10);
            return {};
        };

        try {
            await runner.executeAllowlistedTest(owner1, 'session_context');
            const resSnapshot = runner.getLatestResultSnapshot(owner1);
            assert.ok(resSnapshot, "Result snapshot must exist");
            assert.strictEqual(resSnapshot.state, 'failed');
            assert.ok(!resSnapshot.summary.includes('RAW'), "Must not include raw error");
            assert.strictEqual(runner.getLatestResultSnapshot(owner2), null, "Result snapshot must be owner-isolated");
        } finally {
            cp.execFile = originalExecFile;
        }

    } finally {
        Date.now = originalDateNow;
    }

    console.log("✓ Owner Action & Approval Queue V0 requirements validated.");
}

runTest().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
