import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

class MiniSweAdapter {
    static parseSqliteEvent(etype, tier, details) {
        let parsedDetails = {};
        try { parsedDetails = JSON.parse(details); } catch(e) {}
        
        let internalEvent = null;
        if (etype === 'MODEL_CALL' || etype === 'PLAN_GENERATED') internalEvent = 'thought';
        else if (etype === 'TOOL_SUCCESS' || etype === 'PATH_CHECK') internalEvent = 'command_finished';
        else if (etype === 'VERIFICATION') internalEvent = 'observation';
        else if (etype === 'STEP_FAIL' || etype === 'TOOL_MALFORMED' || etype === 'ESCALATION') internalEvent = 'error';
        
        if (internalEvent) {
            return {
                type: internalEvent,
                rawType: etype,
                tier,
                details: parsedDetails
            };
        }
        return null;
    }

    static parseFinalOutput(stdout) {
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
        if (!result) throw new Error("No JSON found in stdout.");
        return result;
    }

    static async runPevrTask(goal, taskId, options = {}) {
        return new Promise((resolve, reject) => {
            const { 
                scheduleId, 
                workspace, 
                env = {}, 
                timeout = 90000, 
                onEvent 
            } = options;

            const dbPath = path.join(import.meta.dirname, '..', '..', 'mini-swe-agent', 'ghost_agent_runs.db');

            const scriptPath = 'src/minisweagent/pevr_service.py';
            const args = [scriptPath, '--goal', goal, '--task_id', taskId];
            
            if (scheduleId) args.push('--schedule_id', scheduleId.toString());
            if (workspace) args.push('--workspace', workspace);

            const childEnv = { ...process.env, PATH: process.env.PATH, PYTHONUNBUFFERED: '1', ...env };
            delete childEnv.VIRTUAL_ENV;

            let pythonBin = 'python3';
            const venvPython = path.join(import.meta.dirname, '..', '..', 'mini-swe-agent', '.venv', 'bin', 'python');
            if (fs.existsSync(venvPython)) {
                try {
                    fs.accessSync(venvPython, fs.constants.X_OK);
                    pythonBin = venvPython;
                } catch (e) {}
            }

            const child = spawn(pythonBin, args, {
                cwd: path.join(import.meta.dirname, '..', '..', 'mini-swe-agent'),
                env: childEnv,
                timeout: timeout
            });

            global.activeAgentProcess = child;
            child.taskId = taskId;

            let stdout = '';
            let stderr = '';
            
            let lastEventId = 0;
            const pollInterval = onEvent ? setInterval(() => {
                try {
                    const sql = `SELECT id, event_type, tier, details FROM events WHERE task_id = '${taskId}' AND id > ${lastEventId} ORDER BY id ASC`;
                     
                    const out = execSync(`sqlite3 "${dbPath}" "${sql}"`, { encoding: 'utf-8' }).trim();
                    if (out) {
                        for (const line of out.split('\n')) {
                            const parts = line.split('|');
                            if (parts.length >= 4) {
                                const id = parseInt(parts[0]);
                                if (id > lastEventId) lastEventId = id;
                                const etype = parts[1];
                                const tier = parts[2];
                                const details = parts.slice(3).join('|');
                                
                                const event = MiniSweAdapter.parseSqliteEvent(etype, tier, details);
                                if (event) onEvent(event);
                            }
                        }
                    }
                } catch(e) {}
            }, 500) : null;

            child.stdout.on('data', (data) => stdout += data.toString());
            child.stderr.on('data', (data) => stderr += data.toString());

            child.on('close', (code) => {
                if (pollInterval) clearInterval(pollInterval);
                if (global.activeAgentProcess === child) global.activeAgentProcess = null;

                if (code !== 0 && !stdout.trim()) {
                    return reject(new Error(`Agent process failed with code ${code}. Stderr: ${stderr}`));
                }

                try {
                    const result = MiniSweAdapter.parseFinalOutput(stdout);
                    if (onEvent) onEvent({ type: 'final', details: result });
                    resolve({ result, stdout, stderr });
                } catch (parseError) {
                    reject(new Error(`Agent output parsing failed: ${parseError.message}. Stdout: ${stdout}`));
                }
            });

            child.on('error', (err) => {
                if (pollInterval) clearInterval(pollInterval);
                if (global.activeAgentProcess === child) global.activeAgentProcess = null;
                reject(err);
            });
        });
    }
}

export default MiniSweAdapter;
