import assert from 'assert';
import fs from 'fs';
import path from 'path';
import MiniSweAdapter from '../adapters/mini-swe/v2-adapter.js';

// Setup fixtures
const fixturesDir = path.join(import.meta.dirname, 'fixtures', 'mini-swe');
fs.mkdirSync(fixturesDir, { recursive: true });

fs.writeFileSync(path.join(fixturesDir, 'success.json'), JSON.stringify({ success: true, task_id: "123", status: "SUCCESS" }));
fs.writeFileSync(path.join(fixturesDir, 'error.json'), JSON.stringify({ success: false, error: "failed" }));
fs.writeFileSync(path.join(fixturesDir, 'v1_legacy.json'), JSON.stringify({ status: "completed" }));
fs.writeFileSync(path.join(fixturesDir, 'malformed.json'), `{ "success": true, `);

async function runTests() {
    console.log("Running tests for MiniSweAdapter...");

    // Test 1: parseFinalOutput success
    const successStr = `This is mini-swe-agent v2.4.6.\n` + fs.readFileSync(path.join(fixturesDir, 'success.json'), 'utf8');
    const successOut = MiniSweAdapter.parseFinalOutput(successStr);
    assert.strictEqual(successOut.status, "SUCCESS");
    console.log("✅ success fixture parsed correctly");

    // Test 2: parseFinalOutput error
    const errorStr = `Some warnings...\n` + fs.readFileSync(path.join(fixturesDir, 'error.json'), 'utf8');
    const errorOut = MiniSweAdapter.parseFinalOutput(errorStr);
    assert.strictEqual(errorOut.success, false);
    console.log("✅ error fixture parsed correctly");

    // Test 3: parseFinalOutput malformed
    const malformedStr = fs.readFileSync(path.join(fixturesDir, 'malformed.json'), 'utf8');
    try {
        MiniSweAdapter.parseFinalOutput(malformedStr);
        assert.fail("Should have thrown on malformed JSON");
    } catch (e) {
        assert(e.message.includes("No JSON found"));
        console.log("✅ malformed fixture gracefully handled");
    }

    // Test 4: SQLite Event mapping
    const thoughtEvent = MiniSweAdapter.parseSqliteEvent('MODEL_CALL', 'fast', '{"model": "gpt-4"}');
    assert.strictEqual(thoughtEvent.type, 'thought');
    assert.strictEqual(thoughtEvent.tier, 'fast');
    console.log("✅ MODEL_CALL mapped to thought");

    const observationEvent = MiniSweAdapter.parseSqliteEvent('VERIFICATION', 'strong', '{"passed": true}');
    assert.strictEqual(observationEvent.type, 'observation');
    console.log("✅ VERIFICATION mapped to observation");

    console.log("All tests passed!");
}

runTests().catch(e => {
    console.error("Test failed:", e);
    process.exit(1);
});
