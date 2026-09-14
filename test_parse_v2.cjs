const { exec } = require("child_process");
const cmd = "cd mini-swe-agent && PYTHONUNBUFFERED=1 .venv/bin/python src/minisweagent/pevr_service.py --goal 'echo test' --task_id test-123";
exec(cmd, (error, stdout, stderr) => {
    console.log("=== RAW STDOUT ===");
    console.log(stdout);
    console.log("=== END RAW STDOUT ===\n");
    
    const lines = stdout.trim().split('\n');
    let result = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('{')) {
            try {
                result = JSON.parse(line);
                break;
            } catch (e) {}
        }
    }
    
    if (!result) {
        const firstBrace = stdout.indexOf('{');
        if (firstBrace !== -1) {
            try {
                result = JSON.parse(stdout.substring(firstBrace));
            } catch (e) {}
        }
    }
    
    if (!result) {
        console.error("No JSON found in stdout");
    } else {
        console.log("=== PARSED JSON RESULT ===");
        console.log(JSON.stringify(result, null, 2));
    }
});
