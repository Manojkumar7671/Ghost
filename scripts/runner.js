import express from 'express';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const PORT = process.env.RUNNER_PORT || 4185;
const RUNNER_TOKEN = process.env.RUNNER_TOKEN;

if (!RUNNER_TOKEN) {
  console.error('❌ Error: RUNNER_TOKEN environment variable is required to start the runner.');
  process.exit(1);
}

// Security Check: Ensure not running as root
if (os.userInfo().username === 'root' || process.getuid?.() === 0) {
  console.error('❌ Error: The Ghost Runner must not be run as root/sudo.');
  process.exit(1);
}

const ALLOWLIST_PATH = path.join(os.homedir(), '.ghost', 'runner-allowlist.json');

// Ensure allowlist exists with default
try {
  fs.mkdirSync(path.dirname(ALLOWLIST_PATH), { recursive: true });
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify([path.join(os.homedir(), 'Ghost')], null, 2));
  }
} catch (e) {
  console.warn('⚠️ Warning: Failed to initialize allowlist:', e.message);
}

function getApprovedRepos() {
  try {
    if (fs.existsSync(ALLOWLIST_PATH)) {
      return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('❌ Error reading allowlist:', e.message);
  }
  return [];
}

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  return res.json({ status: 'ok', service: 'ghost-companion-runner' });
});

// Token Authentication Middleware
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format' });
  }
  const token = authHeader.substring(7);
  if (token !== RUNNER_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
  next();
});

// Helper: Validate repository is in allowlist
function validateRepoPath(repoPath) {
  const resolved = path.resolve(repoPath);
  const allowed = getApprovedRepos();
  if (!allowed.some(approved => resolved === path.resolve(approved) || resolved.startsWith(path.resolve(approved) + path.sep))) {
    throw new Error('Access Denied: Repository path not in allowlist');
  }
  return resolved;
}

// Helper: Ensure path is inside worktree and does not escape
function validatePathInside(targetPath, worktreePath) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedWorktree = path.resolve(worktreePath);
  if (!resolvedTarget.startsWith(resolvedWorktree + path.sep) && resolvedTarget !== resolvedWorktree) {
    throw new Error('Access Denied: Path escapes worktree boundary');
  }
  // Prevent sensitive files
  const filename = path.basename(resolvedTarget);
  if (filename === '.env' || resolvedTarget.includes('.git/') || resolvedTarget.includes('.ssh/')) {
    throw new Error('Access Denied: Access to sensitive file blocked');
  }
  return resolvedTarget;
}

// Helper: Redact secrets in logs
function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/ghp_[a-zA-Z0-9]{36}/g, '***REDACTED_GITHUB_TOKEN***')
    .replace(/postgres:\/\/([^:]+):([^@]+)@/g, 'postgres://***REDACTED_USER***:***REDACTED_PASSWORD***@')
    .replace(/(password|secret|token|key|passphrase)\s*[:=]\s*["']?[a-zA-Z0-9_-]{8,}["']?/gi, '$1 = ***REDACTED***');
}

// Store of active running commands so they can be killed on cancel
const activeProcesses = new Map();

// --- ROUTE: TOOL EXECUTION ---
app.post('/api/tool', async (req, res) => {
  const { tool, params = {} } = req.body;

  try {
    const repoPath = validateRepoPath(params.repoPath);
    const worktreePath = params.worktreePath ? validatePathInside(params.worktreePath, repoPath) : repoPath;

    switch (tool) {
      case 'repo.inspect': {
        const files = fs.readdirSync(worktreePath)
          .filter(f => f !== '.git' && f !== 'node_modules')
          .map(f => {
            const stats = fs.statSync(path.join(worktreePath, f));
            return { name: f, isDirectory: stats.isDirectory(), size: stats.size };
          });
        return res.json({ success: true, files });
      }

      case 'repo.search': {
        const { query } = params;
        if (!query || typeof query !== 'string') {
          return res.status(400).json({ error: 'Query parameter is required' });
        }
        // Run safe limited grep search
        const safeQuery = query.replace(/['"$;]/g, '');
        let output = '';
        try {
          output = execSync(`grep -rn --exclude-dir={node_modules,.git} -m 50 "${safeQuery}" .`, {
            cwd: worktreePath,
            encoding: 'utf8',
            timeout: 5000
          });
        } catch (e) {
          output = e.stdout || '';
        }
        return res.json({ success: true, results: redactSecrets(output) });
      }

      case 'repo.read_file': {
        const targetFile = validatePathInside(params.filePath, worktreePath);
        if (!fs.existsSync(targetFile)) {
          return res.status(404).json({ error: 'File not found' });
        }
        const stats = fs.statSync(targetFile);
        if (stats.size > 1024 * 1024) {
          return res.status(400).json({ error: 'File size exceeds 1MB limit' });
        }
        const content = fs.readFileSync(targetFile, 'utf8');
        return res.json({ success: true, content: redactSecrets(content) });
      }

      case 'repo.write_patch': {
        const { filePath, content } = params;
        if (!filePath || typeof content !== 'string') {
          return res.status(400).json({ error: 'filePath and content are required' });
        }
        const targetFile = validatePathInside(filePath, worktreePath);
        fs.writeFileSync(targetFile, content, 'utf8');
        return res.json({ success: true, message: 'File written successfully' });
      }

      case 'repo.run_test': {
        const { command } = params;
        if (!command || typeof command !== 'string') {
          return res.status(400).json({ error: 'Test command is required' });
        }
        // Policy: Allow only "npm test", "npm run test", "npm run build", "npm run compile" type scripts
        const allowedCommands = ['npm test', 'npm run test', 'npm run build', 'npm run compile'];
        if (!allowedCommands.includes(command.trim())) {
          return res.status(403).json({ error: `Command blocked by policy: ${command}` });
        }

        const runId = crypto.randomBytes(8).toString('hex');
        const child = spawn('sh', ['-c', command], {
          cwd: worktreePath,
          env: { ...process.env, NODE_ENV: 'test' }
        });

        activeProcesses.set(runId, child);

        let output = '';
        child.stdout.on('data', data => { output += data.toString(); });
        child.stderr.on('data', data => { output += data.toString(); });

        const code = await new Promise(resolve => {
          child.on('close', resolve);
        });

        activeProcesses.delete(runId);
        return res.json({ success: code === 0, code, output: redactSecrets(output) });
      }

      case 'repo.git_diff': {
        const diff = execSync('git diff', { cwd: worktreePath, encoding: 'utf8' });
        return res.json({ success: true, diff: redactSecrets(diff) });
      }

      case 'repo.commit_branch': {
        const { message } = params;
        if (!message) return res.status(400).json({ error: 'Commit message is required' });

        execSync('git add -A', { cwd: worktreePath });
        execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: worktreePath });
        return res.json({ success: true, message: 'Commit successful' });
      }

      default:
        return res.status(400).json({ error: `Unknown runner tool: ${tool}` });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- ROUTE: WORKTREE CREATION ---
app.post('/api/worktree', (req, res) => {
  const { repoPath, taskId } = req.body;
  if (!repoPath || !taskId) return res.status(400).json({ error: 'repoPath and taskId are required' });

  try {
    const validatedRepo = validateRepoPath(repoPath);
    const worktreePath = path.join(validatedRepo, 'workspace', 'runs', taskId);
    const branchName = `agent-${taskId}`;

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Create Git worktree
    execSync(`git worktree add -b ${branchName} "${worktreePath}" origin/main`, { cwd: validatedRepo });

    return res.json({ success: true, worktreePath, branchName });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- ROUTE: WORKTREE CLEANUP ---
app.post('/api/worktree/cleanup', (req, res) => {
  const { repoPath, taskId } = req.body;
  if (!repoPath || !taskId) return res.status(400).json({ error: 'repoPath and taskId are required' });

  try {
    const validatedRepo = validateRepoPath(repoPath);
    const worktreePath = path.join(validatedRepo, 'workspace', 'runs', taskId);
    const branchName = `agent-${taskId}`;

    // Prune worktree
    if (fs.existsSync(worktreePath)) {
      execSync(`git worktree remove --force "${worktreePath}"`, { cwd: validatedRepo });
      execSync(`git branch -D ${branchName}`, { cwd: validatedRepo });
    }

    return res.json({ success: true, message: 'Worktree cleaned up successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- ROUTE: CANCEL RUN ---
app.post('/api/cancel', (req, res) => {
  console.log('[Runner] Received cancel command. Stopping all active subprocesses.');
  for (const [id, child] of activeProcesses.entries()) {
    try {
      child.kill('SIGKILL');
    } catch (e) {}
  }
  activeProcesses.clear();
  return res.json({ success: true, message: 'All runner processes terminated.' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`📡 Ghost Local Companion Runner listening on http://127.0.0.1:${PORT}`);
});
