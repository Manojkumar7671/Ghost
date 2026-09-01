const { exec } = require('child_process');
const cmd = `cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/pevr_service.py --goal "echo test" --task_id "test-exec-1"`;
exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    console.log("STDOUT:\n" + stdout);
    console.log("STDERR:\n" + stderr);
    const lines = stdout.trim().split('\n');
    let result = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().startsWith('{')) { // Added trim just in case
            try {
                result = JSON.parse(lines[i]);
                break;
            } catch (e) {
                console.error("JSON parse error:", e.message);
            }
        }
    }
    console.log("Result:", result);
});
