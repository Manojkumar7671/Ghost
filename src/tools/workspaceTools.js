const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../../');

// Resolves and guarantees path safety, blocking path traversal outside of the Ghost project directory
function resolveSafePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    relativePath = './';
  }

  const homeDir = os.homedir();
  let absolutePath;

  // Handle common home folder expansion (/Downloads, Downloads, ~/Downloads)
  const stripped = relativePath.replace(/^[\/\\]+/, '');
  const lowerStripped = stripped.toLowerCase();
  
  if (lowerStripped === 'downloads' || lowerStripped.startsWith('downloads/') || lowerStripped.startsWith('downloads\\') ||
      lowerStripped === 'desktop' || lowerStripped.startsWith('desktop/') || lowerStripped.startsWith('desktop\\') ||
      lowerStripped === 'documents' || lowerStripped.startsWith('documents/') || lowerStripped.startsWith('documents\\')) {
    const candidateHome = path.resolve(homeDir, stripped);
    if (fs.existsSync(candidateHome)) {
      return candidateHome;
    }
  }

  if (relativePath === '~') {
    absolutePath = homeDir;
  } else if (relativePath.startsWith('~/') || relativePath.startsWith('~\\')) {
    absolutePath = path.resolve(homeDir, relativePath.slice(2));
  } else if (relativePath.startsWith('~')) {
    absolutePath = path.resolve(homeDir, relativePath.slice(1));
  } else {
    const resolvedProject = path.resolve(PROJECT_ROOT, relativePath);
    if (!fs.existsSync(resolvedProject)) {
      const resolvedHome = path.resolve(homeDir, stripped);
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
  const relPath = payload.path || payload.filePath || './';
  const startLine = payload.startLine || 1;
  const endLine = payload.endLine || 80;
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
  let relPath = payload.path || payload.filePath || payload.file || 'outputs/notes.txt';
  const { targetContent, replacementContent } = payload;
  try {
    let filePath = resolveSafePath(relPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      relPath = path.join(relPath, 'notes.txt');
      filePath = resolveSafePath(relPath);
    }

    const relNorm = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const filename = path.basename(relNorm);
    let downloadSubPath = relNorm.startsWith('outputs/') ? relNorm.replace(/^outputs\//, '') : filename;
    const downloadUrl = `http://localhost:3000/downloads/${downloadSubPath}`;

    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, replacementContent || '', 'utf-8');
      return {
        success: true,
        path: relPath,
        downloadUrl,
        message: `File created successfully at \`${relPath}\`.\n\n⬇️ **Download Link**: [${filename}](${downloadUrl})`
      };
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    
    if (targetContent && !content.includes(targetContent)) {
      return { error: "Target content to replace was not found in the file. Matches must be exact including whitespace." };
    }
    
    if (targetContent) {
      const occurrences = content.split(targetContent).length - 1;
      if (occurrences > 1) {
        return { error: `Multiple matches (${occurrences}) found. Specify a larger, unique block of lines.` };
      }
    }
    
    const updated = targetContent ? content.replace(targetContent, replacementContent) : replacementContent;
    fs.writeFileSync(filePath, updated, 'utf-8');
    return {
      success: true,
      path: relPath,
      downloadUrl,
      message: `File modified successfully at \`${relPath}\`.\n\n⬇️ **Download Link**: [${filename}](${downloadUrl})`
    };
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
  
  const { redactSecrets } = await import('../../services/secretRedactor.js');
  return new Promise((resolve) => {
    exec(command, { cwd: PROJECT_ROOT, timeout: 20000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const cleanStdout = redactSecrets(stdout.trim());
      const cleanStderr = redactSecrets(stderr.trim());
      if (err) {
        resolve({ success: false, error: redactSecrets(err.message), stderr: cleanStderr, stdout: cleanStdout });
      } else {
        resolve({ success: true, stdout: cleanStdout, stderr: cleanStderr });
      }
    });
  });
}

module.exports = {
  viewFile,
  editFile,
  runWorkspaceCommand
};
