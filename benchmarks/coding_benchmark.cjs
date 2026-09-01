const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.resolve('.env') });

const issues = require('./issues.json');

process.env.OPENAI_API_BASE = 'https://freellmapi-e17x.onrender.com/v1';
process.env.OPENAI_API_KEY = 'free';
process.env.MSWEA_CONFIGURED = 'true';
process.env.MSWEA_SILENT_STARTUP = '1';
process.env.MSWEA_COST_TRACKING = 'ignore_errors';
process.env.LITELLM_REQUEST_TIMEOUT = '90';
process.env.REQUEST_TIMEOUT = '90';
process.env.MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT = '1';

// We will simulate Ghost's behavior by preparing the workspace,
// checking out the vulnerable commit, and then running Ghost's configuration directly.
async function runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout.on('data', d => {
            out += d.toString();
            process.stdout.write(d);
        });
        proc.stderr.on('data', d => {
            out += d.toString();
            process.stderr.write(d);
        });
        proc.on('close', code => {
            resolve({ code, output: out });
        });
        proc.on('error', reject);
    });
}

async function runCodingBenchmark() {
    const results = [];
    console.log(`Starting Coding Benchmark on ${issues.length} issues...`);

    // Test environments map (very simple approximation for benchmark purposes)
    const testCommands = {
        'tj/commander.js': ['npm', ['install', '&&', 'npm', 'test']],
        'yargs/yargs': ['npm', ['install', '&&', 'npm', 'test']],
        'expressjs/express': ['npm', ['install', '&&', 'npm', 'test']],
        'chalk/chalk': ['npm', ['install', '&&', 'npm', 'test']],
        'pallets/flask': ['pip3', ['install', '-e', '.', '&&', 'pip3', 'install', 'pytest', '&&', 'python3', '-m', 'pytest']]
    };

    let i = 0;
    for (const issue of issues) {
        i++;
        console.log(`\n[${i}/${issues.length}] Testing ${issue.repo}#${issue.issue_number}`);

        console.log("  -> Throttling for 8 seconds to respect rate limits...");
        await new Promise(resolve => setTimeout(resolve, 8000));

        const workspaceDir = path.join(require('os').tmpdir(), `bench-workspace-${Date.now()}`);
        fs.mkdirSync(workspaceDir, { recursive: true });

        try {
            console.log(`  -> Cloning and checking out ${issue.base_commit}...`);
            await runCommand('git', ['clone', `https://github.com/${issue.repo}.git`, '.'], workspaceDir);
            await runCommand('git', ['checkout', issue.base_commit], workspaceDir);

            console.log(`  -> Running mini-swe-agent on issue...`);
            const prompt = `Issue: ${issue.title}\n\n${issue.body}\n\nPlease fix the bug described in this issue.`;
            const aiderProc = await runCommand('/opt/homebrew/bin/python3.11', [
                '-m', 'minisweagent.run.mini',
                '--model', 'openai/gemini-2.5-flash',
                '--environment-class', 'gondolin',
                '--yolo',
                '--exit-immediately',
                '--output', 'trajectory.json',
                '--task', prompt
            ], workspaceDir);

            // Add all untracked changes for testing
            await runCommand('git', ['add', '-A'], workspaceDir);

            console.log(`  -> Running Tests...`);
            let testPassed = false;
            let testOutput = '';

            const testCmd = testCommands[issue.repo];
            if (!testCmd) {
                console.log(`  -> Skipping tests for ${issue.repo}: Test command unknown or unsupported locally.`);
                results.push({
                    repo: issue.repo,
                    issue: issue.issue_number,
                    status: 'SKIPPED_UNSUPPORTED_ENV',
                    log: "Requires specific environment/Docker to run tests safely."
                });
                continue;
            }

            try {
                // simple hack to run && separated commands safely in spawn: use sh -c
                const fullCmd = testCmd[0] + ' ' + testCmd[1].join(' ');
                const testRun = await runCommand('sh', ['-c', fullCmd], workspaceDir);
                testPassed = (testRun.code === 0);
                testOutput = testRun.output;
            } catch(e) {
                testOutput = e.message;
            }

            console.log(`  -> Result: ${testPassed ? 'PASS' : 'FAIL'}`);
            results.push({
                repo: issue.repo,
                issue: issue.issue_number,
                status: testPassed ? 'PASS' : 'FAIL',
                log: aiderProc.output.slice(-1000) + '\n\nTEST OUT:\n' + testOutput.slice(-1000)
            });

        } catch (e) {
            console.log(`  -> Error: ${e.message}`);
            results.push({
                repo: issue.repo,
                issue: issue.issue_number,
                status: 'ERROR',
                log: e.message
            });
        }
    }

    fs.writeFileSync(path.join(__dirname, 'coding_results.json'), JSON.stringify(results, null, 2));

    const passCount = results.filter(r => r.status === 'PASS').length;
    const skipCount = results.filter(r => r.status === 'SKIPPED_UNSUPPORTED_ENV').length;
    console.log(`\nCoding Benchmark Complete: ${passCount} Passed, ${skipCount} Skipped.`);
}

runCodingBenchmark().catch(console.error);
