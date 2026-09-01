const assert = require('assert');
const cp = require('child_process');
const path = require('path');
const manifest = require('./golden_regression_v0_manifest.cjs');

async function runGoldenRegression() {
    console.log("--- STARTING GOLDEN REGRESSION SUITE V0 ---");
    const projectRoot = path.resolve(__dirname, '..');
    
    // 1. Dry-source assertion section
    assert.ok(Array.isArray(manifest), "Manifest must be an array");
    const keys = new Set();
    const paths = new Set();
    const shellMetachars = /[|&;<>()$`\\"'\s]/;
    
    for (const entry of manifest) {
        assert.ok(entry.key && typeof entry.key === 'string', "Key must be non-empty string");
        assert.ok(entry.path && typeof entry.path === 'string', "Path must be non-empty string");
        assert.ok(entry.path.startsWith('tests/') && entry.path.endsWith('_test.cjs'), "Path must start with tests/ and end with _test.cjs");
        assert.ok(!keys.has(entry.key), "Keys must be unique");
        assert.ok(!paths.has(entry.path), "Paths must be unique");
        keys.add(entry.key);
        paths.add(entry.path);
        
        assert.ok(!entry.path.includes('..'), "Path must not contain ..");
        assert.ok(!path.isAbsolute(entry.path), "Path must not be absolute");
        assert.ok(!shellMetachars.test(entry.path), "Path must not contain shell metacharacters or whitespace");
        assert.ok(!entry.path.includes('golden_regression_v0_test.cjs'), "Manifest must not contain the Golden runner itself");
        
        const resolvedPath = path.resolve(projectRoot, entry.path);
        assert.ok(resolvedPath.startsWith(projectRoot), "Path must resolve inside project root");
    }

    // Foundations existence check
    const requiredFoundations = ['session_context_v0', 'approval_gated_test_runner_v0', 'owner_action_approval_queue_v0', 'task_goals_view_v0'];
    for (const reqKey of requiredFoundations) {
        assert.ok(keys.has(reqKey), `Manifest must contain accepted foundation: ${reqKey}`);
    }
    
    console.log(`Manifest validation passed. ${manifest.length} suites queued.`);
    let passedCount = 0;
    const startTime = Date.now();
    
    // 2. Execute suites sequentially
    for (const entry of manifest) {
        console.log(`Running suite: ${entry.key}...`);
        const suiteStartTime = Date.now();
        
        try {
            await new Promise((resolve, reject) => {
                cp.execFile(process.execPath, [entry.path], {
                    cwd: projectRoot,
                    shell: false,
                    timeout: 30000,
                    maxBuffer: 2048
                }, (error, stdout, stderr) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
            const elapsed = Date.now() - suiteStartTime;
            console.log(`  [PASS] ${entry.key} (${elapsed}ms)`);
            passedCount++;
        } catch (error) {
            let category = 'start failure';
            if (error.killed) {
                category = 'timeout';
            } else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
                category = 'output bound';
            } else if (error.code !== undefined && error.code !== null) {
                category = 'nonzero exit';
            }
            console.log(`  [FAIL] ${entry.key} - Reason: ${category}`);
            console.log(`\nRegression Suite blocked at ${entry.key}. Passed: ${passedCount}/${manifest.length}`);
            process.exit(1);
        }
    }
    
    const totalElapsed = Date.now() - startTime;
    console.log(`\nGOLDEN BASELINE VALIDATED. All ${passedCount} suites passed in ${totalElapsed}ms.`);
    process.exit(0);
}

runGoldenRegression().catch(err => {
    console.log("Runner error:", err.message);
    process.exit(1);
});
