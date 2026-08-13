const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const CodeAgent = require('../src/agents/codeAgent.js');

const tasks = [
    {
        name: "File Modification",
        prompt: "Create a file 'greeting.txt' with 'Hello World'. Then replace 'World' with 'Ghost' using a file modification tool.",
        verify: async (workspace) => {
            const filePath = path.join(workspace, 'greeting.txt');
            if (!fs.existsSync(filePath)) return false;
            return fs.readFileSync(filePath, 'utf8').trim() === 'Hello Ghost';
        }
    },
    {
        name: "Directory Creation and Nesting",
        prompt: "Create a nested directory structure 'a/b/c'. Create an empty file 'deep.txt' inside 'c'.",
        verify: async (workspace) => {
            return fs.existsSync(path.join(workspace, 'a', 'b', 'c', 'deep.txt'));
        }
    }
];

async function runAgentBenchmark() {
    const results = [];
    let i = 0;
    for (const task of tasks) {
        i++;
        const workspaceDir = path.join(os.tmpdir(), `agent-bench-test-35-${Date.now()}`);
        fs.mkdirSync(workspaceDir, { recursive: true });
        const originalCwd = process.cwd();
        process.chdir(workspaceDir);

        try {
            const agent = new CodeAgent({ requestId: `bench-agent-35-${i}` });
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
