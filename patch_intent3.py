import sys

with open('server.js', 'r') as f:
    code = f.read()

target = "const sqlite3 = (await import('sqlite3')).default.verbose();"

old_block = """                    const sqlite3 = (await import('sqlite3')).default.verbose();
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
                    db.close();"""

new_block = """                    const { execSync } = await import('child_process');
                    let foundStatus = null;
                    let evidence = [];
                    let pendingApproval = null;

                    for (let i = 0; i < 20; i++) {
                        await new Promise(r => setTimeout(r, 500));
                        try {
                            const statusOut = execSync(`sqlite3 mini-swe-agent/ghost_agent_runs.db "SELECT status FROM tasks WHERE task_id = '${taskId}'"`).toString().trim();
                            if (statusOut === 'SUCCESS' || statusOut === 'FAILED') {
                                foundStatus = statusOut;
                                const evOut = execSync(`sqlite3 mini-swe-agent/ghost_agent_runs.db "SELECT event_type, details FROM events WHERE task_id = '${taskId}'"`).toString().trim();
                                for (const line of evOut.split('\\n')) {
                                    const parts = line.split('|');
                                    if (parts.length >= 2) {
                                        const etype = parts[0];
                                        const edetails = parts.slice(1).join('|');
                                        if (etype === 'TOOL_SUCCESS') {
                                            try {
                                                const d = JSON.parse(edetails);
                                                if (d.tool) evidence.push("Used " + d.tool.tool_name + ": " + JSON.stringify(d.tool.args));
                                            } catch(e){}
                                        } else if (etype === 'PATH_CHECK' && edetails.includes('false')) {
                                            evidence.push("Blocked path escape.");
                                        } else if (etype === 'DENIED') {
                                            evidence.push("User denied action.");
                                        }
                                    }
                                }
                                break;
                            }
                            
                            const apprOut = execSync(`sqlite3 mini-swe-agent/ghost_agent_runs.db "SELECT approval_id, tool_name FROM pending_approvals WHERE task_id = '${taskId}' AND status = 'PENDING'"`).toString().trim();
                            if (apprOut) {
                                const parts = apprOut.split('|');
                                pendingApproval = { approval_id: parts[0], tool_name: parts[1] };
                                break;
                            }
                        } catch (err) {
                            console.error("DB check failed:", err.message);
                        }
                    }"""

if target in code:
    code = code.replace(old_block, new_block)
    with open('server.js', 'w') as f:
        f.write(code)
    print("Patched intent classification with execSync sqlite3!")
else:
    print("Target not found!")
