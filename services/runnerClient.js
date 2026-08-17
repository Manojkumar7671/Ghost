import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';

const RUNNER_PORT = process.env.RUNNER_PORT || 4185;
const RUNNER_URL = `http://127.0.0.1:${RUNNER_PORT}`;

function getRunnerToken() {
  try {
    const tokenFile = path.join(os.homedir(), '.ghost', 'runner-token.json');
    if (fs.existsSync(tokenFile)) {
      const data = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      if (data.expiresAt > Date.now()) {
        return data.token;
      }
    }
  } catch (e) {
    console.error('[RunnerClient] Failed to read token:', e.message);
  }
  return null;
}

export async function callRunner(tool, params) {
  const token = getRunnerToken();
  if (!token) {
    throw new Error('Local companion runner not connected or session token expired. Please connect runner in UI.');
  }

  const response = await axios.post(`${RUNNER_URL}/api/tool`, { tool, params }, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.data.success) {
    throw new Error(response.data.error || 'Runner command failed');
  }

  return response.data;
}

export async function createWorktree(repoPath, taskId) {
  const token = getRunnerToken();
  if (!token) {
    throw new Error('Local companion runner not connected or session token expired. Please connect runner in UI.');
  }

  const response = await axios.post(`${RUNNER_URL}/api/worktree`, { repoPath, taskId }, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return response.data;
}

export async function cleanupWorktree(repoPath, taskId) {
  const token = getRunnerToken();
  if (!token) {
    throw new Error('Local companion runner not connected or session token expired. Please connect runner in UI.');
  }

  const response = await axios.post(`${RUNNER_URL}/api/worktree/cleanup`, { repoPath, taskId }, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return response.data;
}
