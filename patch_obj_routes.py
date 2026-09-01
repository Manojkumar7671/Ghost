import sys

with open('server.js', 'r') as f:
    code = f.read()

target = "app.post('/api/agent/schedule'"

new_code = """
// --- OBJECTIVES ROUTES ---
app.post('/api/objectives', securityMiddleware, async (req, res) => {
    if (!checkIsAdmin(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { execSync } = await import('child_process');
    try {
        const out = execSync(`cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/objectives.py create "${req.user.username}" "${req.body.goal_text.replace(/"/g, '\\"')}" "${req.body.check_interval_seconds || 'null'}" "${req.body.max_runs || 'null'}"`).toString();
        return res.json(JSON.parse(out));
    } catch (e) { return res.status(500).json({ success: false }); }
});
app.get('/api/objectives', securityMiddleware, async (req, res) => {
    if (!checkIsAdmin(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { execSync } = await import('child_process');
    try {
        const out = execSync('cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/objectives.py list').toString();
        return res.json({ success: true, objectives: JSON.parse(out) });
    } catch (e) { return res.status(500).json({ success: false }); }
});
app.get('/api/objectives/:id', securityMiddleware, async (req, res) => {
    if (!checkIsAdmin(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { execSync } = await import('child_process');
    try {
        const out = execSync(`cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/objectives.py get "${req.params.id}"`).toString();
        return res.json({ success: true, objective: JSON.parse(out) });
    } catch (e) { return res.status(500).json({ success: false }); }
});
app.patch('/api/objectives/:id', securityMiddleware, async (req, res) => {
    if (!checkIsAdmin(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { execSync } = await import('child_process');
    try {
        const out = execSync(`cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/objectives.py patch "${req.params.id}" "${req.body.status || 'undefined'}" "${(req.body.goal_text || 'undefined').replace(/"/g, '\\"')}"`).toString();
        return res.json(JSON.parse(out));
    } catch (e) { return res.status(500).json({ success: false }); }
});
app.delete('/api/objectives/:id', securityMiddleware, async (req, res) => {
    if (!checkIsAdmin(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { execSync } = await import('child_process');
    try {
        const out = execSync(`cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/objectives.py delete "${req.params.id}"`).toString();
        return res.json(JSON.parse(out));
    } catch (e) { return res.status(500).json({ success: false }); }
});

// Objectives polling loop
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
}, 10000);

"""

if target in code:
    code = code.replace(target, new_code + target)
    with open('server.js', 'w') as f:
        f.write(code)
    print("Patched server.js with objectives routes!")
else:
    print("Target not found!")
