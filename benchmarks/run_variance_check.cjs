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
    console.log("Running Task 8 five times to check model variance...");
    let passed = 0;
    
    for (let i = 1; i <= 5; i++) {
        console.log(`\nRun ${i}:`);
        const workspaceDir = path.join(os.tmpdir(), `agent-bench-var-${Date.now()}`);
        fs.mkdirSync(workspaceDir, { recursive: true });
        const originalCwd = process.cwd();
        process.chdir(workspaceDir);
        
        try {
            const agent = new CodeAgent({ requestId: `bench-agent-var-${i}` });
            await agent.run(task.prompt);
            const isPass = await task.verify(workspaceDir);
            console.log(`  -> Status: ${isPass ? 'PASS' : 'FAIL'}`);
            if (isPass) passed++;
        } catch (e) {
            console.log(`  -> Error: ${e.message}`);
        } finally {
            process.chdir(originalCwd);
        }
    }
    console.log(`\nTotal Passes for Task 8: ${passed}/5`);
}

run().catch(console.error);
