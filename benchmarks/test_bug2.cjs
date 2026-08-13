const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const CodeAgent = require('../src/agents/codeAgent.js');

const tasks = [
    {
        name: "Shell Command Chaining",
        prompt: "Run a shell command to list all files in the current directory and pipe it to a file named 'dir_list.txt'.",
        verify: async (workspace) => {
            const filePath = path.join(workspace, 'dir_list.txt');
            if (!fs.existsSync(filePath)) return false;
            return fs.readFileSync(filePath, 'utf8').length > 0;
        }
    }
];

async function runAgentBenchmark() {
    const results = [];
    let i = 0;
    for (const task of tasks) {
        i++;
        const workspaceDir = path.join(os.tmpdir(), `agent-bench-test2-${Date.now()}`);
        fs.mkdirSync(workspaceDir, { recursive: true });
        const originalCwd = process.cwd();
        process.chdir(workspaceDir);

        try {
            const agent = new CodeAgent({ requestId: `bench-agent-b2-${i}` });
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
