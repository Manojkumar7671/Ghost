import sys

with open('server.js', 'r') as f:
    code = f.read()

# Remove Scheduler loop
scheduler_loop = """// Scheduler loop
let schedulerToken = process.env.INTERNAL_SCHEDULER_TOKEN;
if (!schedulerToken) {
    const jwt = require('jsonwebtoken');
    schedulerToken = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET);
}
setInterval(async () => {
    const { execSync } = require('child_process');
    try {
        const out = execSync('cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/scheduler.py check').toString();
        const due = JSON.parse(out);
        if (due && due.length > 0) {
            for (const task of due) {
                console.log('[Scheduler] Firing scheduled task: ' + task.schedule_id);
                require('undici').request('http://localhost:3000/api/agent/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Cookie': 'ghost_session=' + schedulerToken },
                    body: JSON.stringify({ goal: task.goal, schedule_id: task.schedule_id })
                }).then(res => res.body.text()).then(text => console.log('[Scheduler] run result:', text)).catch(err => console.error('[Scheduler] Fire error:', err));
            }
        }
    } catch (e) {}
}, 10000);"""

if scheduler_loop in code:
    code = code.replace(scheduler_loop, "")
else:
    print("Could not find Scheduler loop")

# Remove Objectives loop
objectives_loop = """// Objectives polling loop
setInterval(async () => {
    const { execSync } = await import('child_process');
    try {
        const out = execSync('cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/objectives.py check').toString();
        const due = JSON.parse(out);
        if (due && due.length > 0) {
            for (const obj of due) {
                console.log('[Objectives] Firing objective: ' + obj.id);
                
                const combinedGoal = `STANDING OBJECTIVE: ${obj.goal_text}\\n\\nPREVIOUS MEMORY/STATE: ${obj.metadata}\\n\\nYou MUST output a final summary of your findings which will be saved as the new state/memory for the next run.`;
                
                require('undici').request('http://localhost:3000/api/agent/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Cookie': 'ghost_session=' + (typeof schedulerToken !== 'undefined' ? schedulerToken : '') },
                    body: JSON.stringify({ goal: combinedGoal, objective_id: obj.id })
                }).then(res => res.body.text()).then(text => {
                    try {
                        const parsed = JSON.parse(text);
                        const newState = JSON.stringify(parsed.evidence || parsed.plan || { status: parsed.status });
                        const postStr = Buffer.from(newState).toString('base64');
                        
                        execSync(`cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python -c "import sys, base64; from src.minisweagent.objectives import post_run; print(post_run('${obj.id}', base64.b64decode('${postStr}').decode('utf-8')))"`);
                        console.log('[Objectives] run completed and state updated:', obj.id);
                    } catch(err) {
                        console.error('[Objectives] Failed to parse/update run result:', err);
                    }
                }).catch(err => console.error('[Objectives] Fire error:', err));
            }
        }
    } catch (e) {}
}, 10000);"""

if objectives_loop in code:
    code = code.replace(objectives_loop, "")
else:
    print("Could not find Objectives loop")

# Add Daemon Status Route
daemon_route = """
// --- DAEMON STATUS ROUTE ---
app.get('/api/daemon/status', async (req, res) => {
    const { execSync } = await import('child_process');
    try {
        const out = execSync(`sqlite3 mini-swe-agent/ghost_agent_runs.db "SELECT last_heartbeat FROM daemon_status WHERE id = 'daemon1'"`).toString().trim();
        const lastHeartbeat = parseFloat(out) || 0;
        const now = Date.now() / 1000;
        const isAlive = (now - lastHeartbeat) < 30; // 30 seconds threshold
        return res.json({ success: true, isAlive, lastHeartbeat, now });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});
"""

target_insert = "app.post('/api/objectives'"
if target_insert in code:
    code = code.replace(target_insert, daemon_route + "\n" + target_insert)
else:
    print("Could not find /api/objectives route to insert above")

with open('server.js', 'w') as f:
    f.write(code)

print("Patched server.js daemon loops")
