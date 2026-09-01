import { execSync } from 'child_process';
import { request } from 'undici';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const daemonId = 'daemon-' + randomUUID();
const schedulerToken = process.env.INTERNAL_SCHEDULER_TOKEN || jwt.sign({ role: 'admin' }, process.env.JWT_SECRET || 'secret');

console.log(`[Ghost Daemon] Starting with ID: ${daemonId}`);

// Heartbeat
setInterval(() => {
    try {
        execSync(`sqlite3 mini-swe-agent/ghost_agent_runs.db "UPDATE daemon_status SET last_heartbeat = $(date +%s) WHERE id = 'daemon1'"`);
    } catch (e) {
        console.error('Heartbeat error', e);
    }
}, 5000);

// Schedule check
setInterval(() => {
    try {
        const out = execSync(`cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/scheduler.py check ${daemonId}`).toString();
        const due = JSON.parse(out);
        if (due && due.length > 0) {
            for (const task of due) {
                console.log('[Daemon] Firing scheduled task: ' + task.schedule_id);
                request('http://localhost:3000/api/agent/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Cookie': 'ghost_session=' + schedulerToken },
                    body: JSON.stringify({ goal: task.goal, schedule_id: task.schedule_id })
                }).then(res => res.body.text()).then(text => console.log('[Daemon] run result:', text)).catch(e => console.error(e));
            }
        }
    } catch(e) {}
}, 10000);

// Objectives check
setInterval(() => {
    try {
        const out = execSync(`cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/objectives.py check ${daemonId}`).toString();
        const due = JSON.parse(out);
        if (due && due.length > 0) {
            for (const obj of due) {
                console.log('[Daemon] Firing objective: ' + obj.id);
                const combinedGoal = `STANDING OBJECTIVE: ${obj.goal_text}\n\nPREVIOUS MEMORY/STATE: ${obj.metadata}\n\nYou MUST output a final summary of your findings which will be saved as the new state/memory for the next run.`;
                request('http://localhost:3000/api/agent/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Cookie': 'ghost_session=' + schedulerToken },
                    body: JSON.stringify({ goal: combinedGoal, objective_id: obj.id })
                }).then(res => res.body.text()).then(text => {
                    try {
                        const parsed = JSON.parse(text);
                        const newState = JSON.stringify(parsed.evidence || parsed.plan || { status: parsed.status });
                        const postStr = Buffer.from(newState).toString('base64');
                        execSync(`cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python -c "import sys, base64; from src.minisweagent.objectives import post_run; print(post_run('${obj.id}', base64.b64decode('${postStr}').decode('utf-8')))"`);
                    } catch(err) {}
                }).catch(err => {});
            }
        }
    } catch(e) {}
}, 10000);

console.log("[Ghost Daemon] Loops started.");
