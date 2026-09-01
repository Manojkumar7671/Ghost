import sys

with open('server.js', 'r') as f:
    code = f.read()

target = "            // Autonomy Foundations V0: Explicit Owner Plan Draft & Preview Route"

intent_code = """
            // INTENT CLASSIFICATION
            if (isAdmin && !message.startsWith('/') && !message.match(/^prepare\s+plan/i)) {
                let intentResult = 'CONVERSATION';
                try {
                    const { callGroq } = await import('./src/tools/llm.js');
                    const intentRes = await callGroq([
                        { role: 'system', content: 'Classify this message as either CONVERSATION or TASK. TASK means it requires real file/code/command execution to fulfill. Respond with only one word.' },
                        { role: 'user', content: message }
                    ], 10);
                    if (intentRes && intentRes.toLowerCase().includes('task')) {
                        intentResult = 'TASK';
                    }
                } catch(e) {
                    console.error("Intent classification failed:", e.message);
                }

                if (intentResult === 'TASK') {
                    console.log("[Intent] Routing to PEVR (TASK):", message);
                    const taskId = "task-" + Date.now();
                    const cmd = `cd mini-swe-agent && PYTHONUNBUFFERED=1 uv run --python 3.11 python src/minisweagent/pevr_service.py --goal "${message.replace(/"/g, '\\"')}" --task_id ${taskId}`;
                    const { exec } = await import('child_process');
                    exec(cmd); // spawn in background
                    
                    const sqlite3 = (await import('sqlite3')).default.verbose();
                    const db = new sqlite3.Database('mini-swe-agent/ghost_agent_runs.db');
                    
                    let foundStatus = null;
                    let evidence = [];
                    let pendingApproval = null;
                    
                    for (let i = 0; i < 20; i++) {
                        await new Promise(r => setTimeout(r, 500));
                        const taskRow = await new Promise(resolve => db.get("SELECT status FROM tasks WHERE task_id = ?", [taskId], (err, row) => resolve(row)));
                        if (taskRow && (taskRow.status === 'SUCCESS' || taskRow.status === 'FAILED')) {
                            foundStatus = taskRow.status;
                            const evRows = await new Promise(resolve => db.all("SELECT event_type, details FROM events WHERE task_id = ?", [taskId], (err, rows) => resolve(rows||[])));
                            for (const ev of evRows) {
                                if (ev.event_type === 'TOOL_SUCCESS') {
                                    try {
                                        const d = JSON.parse(ev.details);
                                        if (d.tool) evidence.push("Used " + d.tool.tool_name + ": " + JSON.stringify(d.tool.args));
                                    } catch(e){}
                                } else if (ev.event_type === 'PATH_CHECK' && ev.details.includes('false')) {
                                    evidence.push("Blocked path escape.");
                                } else if (ev.event_type === 'DENIED') {
                                    evidence.push("User denied action.");
                                }
                            }
                            break;
                        }
                        
                        const apprRow = await new Promise(resolve => db.get("SELECT approval_id, tool_name FROM pending_approvals WHERE task_id = ? AND status = 'PENDING'", [taskId], (err, row) => resolve(row)));
                        if (apprRow) {
                            pendingApproval = apprRow;
                            break;
                        }
                    }
                    db.close();
                    
                    if (pendingApproval) {
                        return res.json({
                            success: true,
                            text: `An approval is pending for ${pendingApproval.tool_name} (ID: ${pendingApproval.approval_id}).\nPlease approve or deny using /api/agent/approvals/${pendingApproval.approval_id}/approve`,
                            execution: { state: "pending", taskId, summary: "Approval pending." }
                        });
                    }
                    
                    if (foundStatus) {
                        return res.json({
                            success: true,
                            text: `Task finished with status: ${foundStatus}.\nEvidence:\n${evidence.join('\\n')}`,
                            execution: { state: "completed", taskId, summary: `Task ${foundStatus}`, evidence }
                        });
                    }
                    
                    return res.json({
                        success: true,
                        text: `Task started in background (ID: ${taskId}).`,
                        execution: { state: "running", taskId, summary: "Running in background." }
                    });
                }
            }
"""

if target in code:
    code = code.replace(target, intent_code + "\n" + target)
    with open('server.js', 'w') as f:
        f.write(code)
    print("Patched intent classification!")
else:
    print("Target not found!")
