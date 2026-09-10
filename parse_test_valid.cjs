const { exec } = require("child_process");
const goal = "create a file called test.txt with content 'hello'";
const taskId = "task-" + Date.now();
// I will just use FreeLLMAPI (Render Cloud) by setting OPENAI_BASE_URL and OPENAI_API_KEY
// But wait, pevr_service.py uses litellm. We can pass a model that doesn't need auth, or mock it.
// Actually, let's just run it and see if it crashes before JSON.
const cmd = `cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/pevr_service.py --goal "${goal.replace(/"/g, '\\"')}" --task_id ${taskId}`;
exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    console.log("=== RAW STDOUT ===");
    console.log(stdout);
    console.log("=== RAW STDERR ===");
    console.log(stderr);
    console.log("=== END ===");
});
