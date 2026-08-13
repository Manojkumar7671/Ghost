const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const CodeAgent = require('../src/agents/codeAgent.js');

const task = {
    name: "Regex Search",
    prompt: "Create a file 'data.txt' with lines 'apple', 'banana', 'cherry'. Write a python script 'search.py' that reads 'data.txt', finds 'banana', and writes it to 'result.txt'. Run the script.",
    verify: async (workspace) => {
        const resPath = path.join(workspace, 'result.txt');
        if (!fs.existsSync(resPath)) return false;
        return fs.readFileSync(resPath, 'utf8').trim() === 'banana';
    }
};

async function run() {
    console.log("Running Task 8 once to debug...");
    
    const workspaceDir = path.join(os.tmpdir(), `agent-bench-var-${Date.now()}`);
    fs.mkdirSync(workspaceDir, { recursive: true });
    const originalCwd = process.cwd();
    process.chdir(workspaceDir);
    
    try {
        const agent = new CodeAgent({ requestId: `bench-agent-debug` });
        const output = await agent.run(task.prompt);
        console.log("Agent output:\n", JSON.stringify(output, null, 2));
    } catch (e) {
        console.log(`  -> Error: ${e.message}`);
    } finally {
        process.chdir(originalCwd);
    }
}

run().catch(console.error);
