const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../../');

// Resolves and guarantees path safety, blocking path traversal outside of the Ghost project directory
function resolveSafePath(relativePath) {
  let absolutePath;
  if (relativePath === '~') {
    absolutePath = os.homedir();
  } else if (relativePath.startsWith('~/') || relativePath.startsWith('~\\')) {
    absolutePath = path.resolve(os.homedir(), relativePath.slice(2));
  } else if (relativePath.startsWith('~')) {
    absolutePath = path.resolve(os.homedir(), relativePath.slice(1));
  } else {
    const isLocal = (process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'local';
    const resolvedProject = path.resolve(PROJECT_ROOT, relativePath);
    if (isLocal && !fs.existsSync(resolvedProject)) {
      const resolvedHome = path.resolve(os.homedir(), relativePath);
      if (fs.existsSync(resolvedHome)) {
        return resolvedHome;
      }
    }
    absolutePath = resolvedProject;
  }

  const isLocal = (process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'local';
  if (!isLocal && !absolutePath.startsWith(PROJECT_ROOT)) {
    throw new Error("Access Denied: Path traversal attempted outside project boundary.");
  }
  return absolutePath;
}

/**
 * View specific line ranges of a workspace file or list directory contents (1-indexed)
 */
async function viewFile(payload) {
  const { path: relPath, startLine = 1, endLine = 80 } = payload;
  try {
    const filePath = resolveSafePath(relPath);
    if (!fs.existsSync(filePath)) return { error: `File not found: ${relPath}` };
    
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(filePath);
      return {
        path: relPath,
        isDirectory: true,
        files: files.slice(0, 100)
      };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(lines.length, endLine);
    
    const sliced = lines.slice(startIdx, endIdx).map((l, i) => `${startIdx + i + 1}: ${l}`).join('\n');
    return { 
      path: relPath, 
      totalLines: lines.length, 
      linesShown: `${startLine}-${endIdx}`, 
      content: sliced 
    };
  } catch (err) {
    return { error: `viewFile failed: ${err.message}` };
  }
}

/**
 * Perform a safe, contiguous search-and-replace edit on a workspace file
 */
async function editFile(payload) {
  const { path: relPath, targetContent, replacementContent } = payload;
  try {
    const filePath = resolveSafePath(relPath);
    if (!fs.existsSync(filePath)) {
      if (!targetContent) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, replacementContent || '', 'utf-8');
        return { success: true, path: relPath, message: "File created successfully." };
      }
      return { error: `File not found: ${relPath}` };
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    
    if (!content.includes(targetContent)) {
      return { error: "Target content to replace was not found in the file. Matches must be exact including whitespace." };
    }
    
    // Check for multiple matches to prevent accidental multiple updates
    const occurrences = content.split(targetContent).length - 1;
    if (occurrences > 1) {
      return { error: `Multiple matches (${occurrences}) found. Specify a larger, unique block of lines.` };
    }
    
    const updated = content.replace(targetContent, replacementContent);
    fs.writeFileSync(filePath, updated, 'utf-8');
    return { success: true, path: relPath, message: "File modified successfully." };
  } catch (err) {
    return { error: `editFile failed: ${err.message}` };
  }
}

/**
 * Run a timed, non-blocking local shell command within the project workspace
 */
async function runWorkspaceCommand(payload) {
  const { command } = payload;
  
  // Guard check against dangerous system actions
  const blocklist = ['rm -rf /', 'sudo ', 'chown', 'chmod 777', 'mkfs', 'dd ', ':(){:|:&};:'];
  if (blocklist.some(term => command.includes(term))) {
    return { error: "Command blocked: contains restricted system modifiers." };
  }

  const { checkProcessSpawn } = await import('../../services/securityMonitor.js');
  try {
    checkProcessSpawn(command);
  } catch (err) {
    return { error: err.message };
  }

  const { classifyCommand } = await import('../../services/commandGate.js');
  const gateRes = classifyCommand(command);
  if (!gateRes.safe) {
    return { error: gateRes.reason };
  }
  
  return new Promise((resolve) => {
    exec(command, { cwd: PROJECT_ROOT, timeout: 20000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: err.message, stderr: stderr.trim(), stdout: stdout.trim() });
      } else {
        resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

module.exports = {
  viewFile,
  editFile,
  runWorkspaceCommand
};
