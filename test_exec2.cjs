const { exec } = require('child_process');
const cmd = `cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/pevr_service.py --goal "echo test" --task_id "test-exec-2"`;
exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    const lines = stdout.trim().split('\n');
    let result = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        console.log(`Line ${i}: startsWith{ = ${lines[i].startsWith('{')}`);
        if (lines[i].startsWith('{')) {
            result = JSON.parse(lines[i]);
            break;
        }
    }
    console.log("Result:", result);
});
