const { exec } = require("child_process");
const goal = "create a file called test.txt with content 'hello'";
const taskId = "task-" + Date.now();
const cmd = `cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/pevr_service.py --goal "${goal.replace(/"/g, '\\"')}" --task_id ${taskId}`;
exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    console.log("=== RAW STDOUT ===");
    console.log(stdout);
    console.log("=== RAW STDERR ===");
    console.log(stderr);
    console.log("=== PARSED RESULT ===");
    const lines = stdout.trim().split("\n");
    let result = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith("{")) {
            try {
                result = JSON.parse(line);
                break;
            } catch (e) {
                // ignore
            }
        }
    }
    if (!result) console.log("No JSON found in stdout");
    else console.log(result);
});
