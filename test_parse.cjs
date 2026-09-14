const { exec } = require("child_process");
const cmd = "cd mini-swe-agent && PYTHONUNBUFFERED=1 .venv/bin/python src/minisweagent/pevr_service.py --goal 'echo test' --task_id test-123";
exec(cmd, (error, stdout, stderr) => {
    console.log("STDOUT:", stdout);
    const lines = stdout.trim().split('\n');
    let result = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('{')) {
            try {
                result = JSON.parse(line);
                break;
            } catch (e) {
                console.error("JSON Parse Error:", e);
            }
        }
    }
    if (!result) console.error("No JSON found in stdout");
    else console.log("Parsed JSON:", result.success);
});
