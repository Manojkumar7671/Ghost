const assert = require('assert');

console.log('Starting Integration Benchmark for New Subsystems...\n');
let passed = 0;
let total = 3;

async function runTests() {
    try {
        console.log('[1/3] Testing Desktop Overlay Initialization...');
        const desktopOverlay = await import('../services/desktopOverlay.js');
        assert.ok(typeof desktopOverlay.initDesktopOverlay === 'function');
        console.log('  -> Result: PASS\n');
        passed++;
    } catch (e) {
        console.log(`  -> Result: FAIL (${e.message})\n`);
    }

    try {
        console.log('[2/3] Testing Telephony Bridge...');
        const telephonyBridge = await import('../services/telephonyBridge.js');
        assert.ok(typeof telephonyBridge.initTelephonyBridge === 'function');
        console.log('  -> Result: PASS\n');
        passed++;
    } catch (e) {
        console.log(`  -> Result: FAIL (${e.message})\n`);
    }

    try {
        console.log('[3/3] Testing Agent Bridge...');
        const agentBridge = await import('../services/agentBridge.js');
        assert.ok(typeof agentBridge.initAgentBridge === 'function');
        console.log('  -> Result: PASS\n');
        passed++;
    } catch (e) {
        console.log(`  -> Result: FAIL (${e.message})\n`);
    }

    console.log(`Integration Benchmark Complete: ${passed}/${total} Passed.`);
}

runTests();
