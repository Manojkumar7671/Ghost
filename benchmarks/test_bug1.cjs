const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const CodeAgent = require('../src/agents/codeAgent.js');

const tasks = [
    {
        name: "Python Script Execution",
        prompt: "Create a python script 'math_test.py' that prints the sum of 5 and 7. Run it and return the output.",
        verify: async (workspace) => {
            const scriptPath = path.join(workspace, 'math_test.py');
            if (!fs.existsSync(scriptPath)) return false;
            return fs.readFileSync(scriptPath, 'utf8').includes('5 + 7') || fs.readFileSync(scriptPath, 'utf8').includes('12');
        }
    },
    {
        name: "Environment Variable Test",
        prompt: "Write a node script 'env_test.js' that prints the value of TEST_VAR. Do not run it.",
        verify: async (workspace) => {
            const scriptPath = path.join(workspace, 'env_test.js');
            if (!fs.existsSync(scriptPath)) return false;
            return fs.readFileSync(scriptPath, 'utf8').includes('process.env.TEST_VAR');
        }
    }
];

async function runAgentBenchmark() {
    const results = [];
    let i = 0;
    for (const task of tasks) {
        i++;
        const workspaceDir = path.join(os.tmpdir(), `agent-bench-test-${Date.now()}`);
        fs.mkdirSync(workspaceDir, { recursive: true });
        const originalCwd = process.cwd();
        process.chdir(workspaceDir);

        try {
            const agent = new CodeAgent({ requestId: `bench-agent-${i}` });
            const output = await agent.run(task.prompt);
            const passed = await task.verify(workspaceDir);
            results.push({ task: task.name, status: passed ? 'PASS' : 'FAIL', output });
        } catch (e) {
            results.push({ task: task.name, status: 'ERROR', error: e.message });
        } finally {
            process.chdir(originalCwd);
        }
    }
    console.log(JSON.stringify(results, null, 2));
}

runAgentBenchmark().catch(console.error);
