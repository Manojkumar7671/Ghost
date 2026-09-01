require('dotenv').config({ override: true });
const { exec } = require('child_process');
const cmd = `cd mini-swe-agent && PYTHONUNBUFFERED=1 LITELLM_LOG="DEBUG" uv run --python 3.11 python src/minisweagent/pevr_service.py --goal "echo 'final validation'" --task_id "task-verify-7"`;
exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    console.log("=== STDERR ===");
    console.log(stderr);
});
