const { exec } = require('child_process');
const cmd = `cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/pevr_service.py --goal "echo 'final validation'" --task_id "task-verify-1"`;
exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    console.log("=== RAW STDOUT ===");
    console.log(stdout);
    console.log("==================");

    const lines = stdout.trim().split('\n');
    let result = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('{')) {
            try {
                result = JSON.parse(line);
                console.log("SUCCESSFULLY PARSED JSON AT LINE " + i);
                break;
            } catch (e) {}
        }
    }
    if (!result) {
        console.log("No JSON found in stdout");
    } else {
        console.log("FINAL PARSED RESULT:", JSON.stringify(result, null, 2));
    }
});
