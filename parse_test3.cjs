const { exec } = require("child_process");
const goal = "list files in current directory";
const taskId = "task-" + Date.now();
const cmd = `cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/pevr_service.py --goal "${goal.replace(/"/g, '\\"')}" --task_id ${taskId}`;
exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    console.log("=== STDOUT ===");
    console.log(stdout);
});
