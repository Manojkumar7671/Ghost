const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { checkRepoApproval } = require('../../services/repoApproval');
const { saveMessage } = require('../tools/memory');

class AiderAgent {
  constructor(requestContext) {
    this.requestContext = requestContext || { requestId: 'sys-aider' };
  }

  async run(task, context, owner, repo) {
    if (!owner || !repo) {
      return "Error: AiderAgent requires a GitHub owner and repo.";
    }

    // 1. Repository Access Approval Gate
    const approval = checkRepoApproval(owner, repo, task);
    if (approval.status === 'awaiting_approval') {
      return approval.message;
    }

    const repoName = `${owner}/${repo}`;
    const workspaceDir = path.join(os.tmpdir(), `aider-workspace-${Date.now()}`);
    
    // Background the actual heavy lifting
    this._executeAiderTask(repoName, workspaceDir, task).catch(err => {
      console.error(`[AiderAgent] Background task error:`, err);
    });

    return `AiderAgent has started working on [${repoName}] in the background. You will receive an update here when the changes are ready for review.`;
  }

  async _executeAiderTask(repoName, workspaceDir, task) {
    try {
        console.log(`[AiderAgent] Preparing workspace at ${workspaceDir}`);
        
        // Ensure clean workspace
        if (!fs.existsSync(workspaceDir)) {
          fs.mkdirSync(workspaceDir, { recursive: true });
        }

        let cloneError = '';
        const cloneProcess = spawn('git', ['clone', `https://github.com/${repoName}.git`, '.'], {
            cwd: workspaceDir,
            env: { ...process.env, HOME: workspaceDir }
        });

        cloneProcess.stderr.on('data', data => {
            cloneError += data.toString();
        });

        await new Promise((resolve, reject) => {
            cloneProcess.on('close', (code) => {
                if (code !== 0) reject(new Error(`Git clone failed with code ${code}. Error: ${cloneError}`));
                else resolve();
            });
            cloneProcess.on('error', reject);
        });

        console.log(`[AiderAgent] Cloned ${repoName} successfully. Spawning Aider...`);

        // 2. Determine best model and configure env for mini-swe-agent
        const env = { ...process.env };
        env.PATH = `/opt/homebrew/bin:${process.env.PATH || ''}`;
        env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY;
        env.NVIDIA_NIM_API_KEY = env.NVIDIA_API_KEY;
        env.MSWEA_CONFIGURED = 'true';
        env.MSWEA_SILENT_STARTUP = '1';
        env.MSWEA_COST_TRACKING = 'ignore_errors';
        
        // 3. Spawn mini-swe-agent non-interactively
        const aiderProcess = spawn('/opt/homebrew/bin/python3.11', [
            '-m', 'minisweagent.run.mini',
            '--model', 'nvidia_nim/meta/llama-3.1-8b-instruct',
            '--environment-class', 'gondolin',
            '--yolo',
            '--exit-immediately',
            '--task', task
        ], {
            cwd: workspaceDir,
            env
        });

        let outputLog = '';

        aiderProcess.stdout.on('data', (data) => {
            outputLog += data.toString();
        });

        aiderProcess.stderr.on('data', (data) => {
            outputLog += data.toString();
        });

        const exitCode = await new Promise((resolve) => {
            aiderProcess.on('close', resolve);
            aiderProcess.on('error', (err) => {
                outputLog += `\nError spawning aider: ${err.message}`;
                resolve(1);
            });
        });

        console.log(`[AiderAgent] OpenCode finished with code ${exitCode}. Extracting diff...`);

        // 4. Capture Diff
        let diffOutput = '';
        try {
            // Add all files (tracked and untracked) to staging so we can get a complete diff
            const addProcess = spawn('git', ['add', '-A'], { cwd: workspaceDir });
            await new Promise(r => addProcess.on('close', r));

            const diffProcess = spawn('git', ['diff', '--cached'], { cwd: workspaceDir });
            diffProcess.stdout.on('data', data => diffOutput += data.toString());
            await new Promise(r => diffProcess.on('close', r));
        } catch (e) {
            diffOutput = `Could not extract git diff: ${e.message}`;
        }

        const summary = `**OpenCode Execution Complete** for ${repoName}\n\n` +
            `**Status Code:** ${exitCode}\n\n` +
            `**OpenCode Log Snippet:**\n\`\`\`\n${outputLog.slice(-1500)}\n\`\`\`\n\n` +
            `**Git Diff (Local Only, Review Required):**\n\`\`\`diff\n${diffOutput || 'No diff generated.'}\n\`\`\``;

        saveMessage(this.requestContext.requestId, 'agent', summary);

    } catch (err) {
        console.error(`[AiderAgent] Error processing task:`, err);
        saveMessage(this.requestContext.requestId, 'agent', `AiderAgent encountered an error working on ${repoName}:\n\`\`\`\n${err.message}\n\`\`\``);
    }
  }
}

module.exports = { AiderAgent };
