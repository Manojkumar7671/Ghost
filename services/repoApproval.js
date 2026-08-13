import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { pendingActions } from '../state/pendingActions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.join(__dirname, '../state/approved_repos.json');

export function loadApprovedRepos() {
  if (!fs.existsSync(STATE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function saveApprovedRepo(repo) {
  const repos = loadApprovedRepos();
  const repoName = repo.toLowerCase();
  if (!repos.includes(repoName)) {
    repos.push(repoName);
    fs.writeFileSync(STATE_FILE, JSON.stringify(repos, null, 2), 'utf8');
  }
}

export function checkRepoApproval(owner, repo, actionDesc) {
  const repoName = `${owner}/${repo}`.toLowerCase();
  const repos = loadApprovedRepos();
  
  if (!repos.includes(repoName)) {
    const actionId = crypto.randomBytes(16).toString('hex');
    pendingActions.set(actionId, {
      type: 'aider_repo_approval',
      context: repoName,
      agentType: 'AiderAgent',
      description: `AiderAgent needs explicit approval to interact with repository: ${repoName}`,
      options: ['Approve', 'Deny']
    });
    console.log(`[AiderAgent] Paused. Awaiting explicit approval for repo ${repoName}. (ActionID: ${actionId})`);

    return {
      status: 'awaiting_approval',
      actionId,
      message: `AiderAgent requires explicit user approval to operate on repository [${repoName}]. Action [${actionDesc}] paused.`
    };
  }
  return { status: 'approved' };
}
