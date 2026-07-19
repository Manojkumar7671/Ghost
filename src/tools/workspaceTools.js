const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../');

// Resolves and guarantees path safety, blocking path traversal outside of the Ghost project directory
function resolveSafePath(relativePath) {
  const resolved = path.resolve(PROJECT_ROOT, relativePath);
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error("Access Denied: Path traversal attempted outside project boundary.");
  }
  return resolved;
}

/**
 * View specific line ranges of a workspace file (1-indexed)
 */
async function viewFile(payload) {
  const { path: relPath, startLine = 1, endLine = 80 } = payload;
  try {
    const filePath = resolveSafePath(relPath);
    if (!fs.existsSync(filePath)) return { error: `File not found: ${relPath}` };
    
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
    if (!fs.existsSync(filePath)) return { error: `File not found: ${relPath}` };
    
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

  const { classifyCommand } = await import('../../../services/commandGate.js');
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
