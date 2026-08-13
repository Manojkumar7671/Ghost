const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// We will use Ghost's CodeAgent for these multi-step tool-use benchmarks
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
    },
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
        name: "File Modification",
        prompt: "Create a file 'greeting.txt' with 'Hello World'. Then replace 'World' with 'Ghost' using a file modification tool.",
        verify: async (workspace) => {
            const filePath = path.join(workspace, 'greeting.txt');
            if (!fs.existsSync(filePath)) return false;
            return fs.readFileSync(filePath, 'utf8').trim() === 'Hello Ghost';
        }
    },
    {
        name: "Shell Command Chaining",
        prompt: "Run a shell command to list all files in the current directory and pipe it to a file named 'dir_list.txt'.",
        verify: async (workspace) => {
            const filePath = path.join(workspace, 'dir_list.txt');
            if (!fs.existsSync(filePath)) return false;
            return fs.readFileSync(filePath, 'utf8').length > 0;
        }
    },
    {
        name: "Directory Creation and Nesting",
        prompt: "Create a nested directory structure 'a/b/c'. Create an empty file 'deep.txt' inside 'c'.",
        verify: async (workspace) => {
            return fs.existsSync(path.join(workspace, 'a', 'b', 'c', 'deep.txt'));
        }
    },
    {
        name: "Log Parsing",
        prompt: "Create a file 'server.log' containing 'ERROR: Disk full' and 'INFO: Started'. Read the file and create 'errors_only.log' containing only the ERROR line.",
        verify: async (workspace) => {
            const errPath = path.join(workspace, 'errors_only.log');
            if (!fs.existsSync(errPath)) return false;
            return fs.readFileSync(errPath, 'utf8').includes('ERROR: Disk full') && !fs.readFileSync(errPath, 'utf8').includes('INFO: Started');
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
    },
    {
        name: "Regex Search",
        prompt: "Create a file 'data.txt' with lines 'apple', 'banana', 'cherry'. Write a python script 'search.py' that reads 'data.txt', finds 'banana', and writes it to 'result.txt'. Run the script.",
        verify: async (workspace) => {
            const resPath = path.join(workspace, 'result.txt');
            if (!fs.existsSync(resPath)) return false;
            return fs.readFileSync(resPath, 'utf8').trim() === 'banana';
        }
    }
];

async function runAgentBenchmark() {
    console.log(`Starting Agent/Tool-Use Benchmark on ${tasks.length} tasks...`);
    const results = [];
    let i = 0;

    for (const task of tasks) {
        i++;
        console.log(`\n[${i}/${tasks.length}] Task: ${task.name}`);
        
        const workspaceDir = path.join(os.tmpdir(), `agent-bench-${Date.now()}`);
        fs.mkdirSync(workspaceDir, { recursive: true });

        const originalCwd = process.cwd();
        process.chdir(workspaceDir);

        try {
            // Instantiate a new agent for this task
            const agent = new CodeAgent({ requestId: `bench-agent-${i}` });
            
            console.log(`  -> Running Ghost CodeAgent...`);
            const output = await agent.run(task.prompt);

            console.log(`  -> Verifying output...`);
            const passed = await task.verify(workspaceDir);
            
            console.log(`  -> Result: ${passed ? 'PASS' : 'FAIL'}`);
            results.push({
                task: task.name,
                status: passed ? 'PASS' : 'FAIL',
                agent_output: output
            });
        } catch (e) {
            console.log(`  -> Error: ${e.message}`);
            results.push({
                task: task.name,
                status: 'ERROR',
                agent_output: e.message
            });
        } finally {
            process.chdir(originalCwd);
        }
    }

    fs.writeFileSync(path.join(__dirname, 'agent_results.json'), JSON.stringify(results, null, 2));
    const passCount = results.filter(r => r.status === 'PASS').length;
    console.log(`\nAgent Benchmark Complete: ${passCount}/${tasks.length} Passed.`);
}

runAgentBenchmark().catch(console.error);
