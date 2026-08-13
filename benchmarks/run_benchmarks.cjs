const { spawn } = require('child_process');
const path = require('path');

async function runScript(scriptName) {
    console.log(`\n======================================================`);
    console.log(`>>> RUNNING: ${scriptName}`);
    console.log(`======================================================\n`);
    
    return new Promise((resolve, reject) => {
        const proc = spawn('node', [path.join(__dirname, scriptName)], { stdio: 'inherit' });
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`${scriptName} failed with code ${code}`));
        });
        proc.on('error', reject);
    });
}

async function runAll() {
    try {
        console.log("🚀 STARTING GHOST BENCHMARK SUITE\n");
        await runScript('coding_benchmark.cjs');
        await runScript('agent_benchmark.cjs');
        await runScript('head_to_head_benchmark.cjs');
        console.log(`\n✅ ALL BENCHMARKS COMPLETED SUCCESSFULLY.`);
        console.log(`Check the .json files in the benchmarks/ directory for raw outputs.`);
    } catch (e) {
        console.error(`\n❌ BENCHMARK SUITE FAILED: ${e.message}`);
    }
}

runAll();
