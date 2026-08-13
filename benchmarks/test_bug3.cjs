const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const CodeAgent = require('../src/agents/codeAgent.js');

const tasks = [
    {
        name: "Create and Read Configuration",
        prompt: "Create a directory named 'agent_test_1'. Inside it, write a JSON file named 'config.json' with { \"port\": 8080 }. Then read it and print the port to the console.",
        verify: async (workspace) => {
            const configPath = path.join(workspace, 'agent_test_1', 'config.json');
            if (!fs.existsSync(configPath)) return false;
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return data.port === 8080;
        }
    }
];

async function runAgentBenchmark() {
    const results = [];
    let i = 0;
    for (const task of tasks) {
        i++;
        const workspaceDir = path.join(os.tmpdir(), `agent-bench-test3-${Date.now()}`);
        fs.mkdirSync(workspaceDir, { recursive: true });
        const originalCwd = process.cwd();
        process.chdir(workspaceDir);

        try {
            const agent = new CodeAgent({ requestId: `bench-agent-b3-${i}` });
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
