const { exec } = require("child_process");
const goal = "list files in current directory";
const taskId = "task-1234";
const cmd = `cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/pevr_service.py --goal "${goal.replace(/"/g, '\\"')}" --task_id ${taskId}`;
exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    console.log("=== STDOUT ===");
    console.log(stdout);
    console.log("=== STDERR ===");
    console.log(stderr);
    console.log("=== PARSING ===");
    const lines = stdout.trim().split("\n");
    let result = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith("{")) {
            try {
                result = JSON.parse(line);
                break;
            } catch (e) {
            }
        }
    }
    if (!result) console.log("No JSON found in stdout");
    else console.log("Parsed result:", result);
});
