import { spawn } from 'child_process';
import { classifyCommand } from '../commandGate.js';
import { checkProcessSpawn } from '../securityMonitor.js';

export function openUrl(url) {
  checkProcessSpawn(url);
  const gateRes = classifyCommand(url);
  if (!gateRes.safe) {
    throw new Error(gateRes.reason);
  }

  console.log(`[Mac Driver] Opening URL: ${url}`);
  const child = spawn('open', [url]);
  child.unref();
  return { success: true };
}

export function openApp(appName) {
  checkProcessSpawn(appName);
  const gateRes = classifyCommand(appName);
  if (!gateRes.safe) {
    throw new Error(gateRes.reason);
  }

  console.log(`[Mac Driver] Opening App: ${appName}`);
  const child = spawn('open', ['-a', appName]);
  child.unref();
  return { success: true };
}

export function runScript(script) {
  checkProcessSpawn(script);
  const gateRes = classifyCommand(script);
  if (!gateRes.safe) {
    throw new Error(gateRes.reason);
  }

  console.log(`[Mac Driver] Running AppleScript...`);
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', script]);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

import fs from 'fs';
import path from 'path';
import os from 'os';

function resolvePath(filePath) {
  if (!filePath) throw new Error('Path is required');
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

export function readFile(filePath) {
  const resolved = resolvePath(filePath);
  console.log(`[Mac Driver] Reading file: ${resolved}`);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(resolved, 'utf8');
  return { content };
}

export function editFile(filePath, oldStr, newStr) {
  const resolved = resolvePath(filePath);
  console.log(`[Mac Driver] Editing file: ${resolved}`);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const fileContent = fs.readFileSync(resolved, 'utf8');
  const occurrences = fileContent.split(oldStr).length - 1;
  if (occurrences === 0) {
    throw new Error("Replacement failed: Target string not found.");
  }
  if (occurrences > 1) {
    throw new Error(`Replacement failed: Multiple matches (${occurrences}) found.`);
  }
  const newContent = fileContent.replace(oldStr, newStr);
  fs.writeFileSync(resolved, newContent, 'utf8');
  return { success: true };
}

export function createFile(filePath, content = '') {
  const resolved = resolvePath(filePath);
  console.log(`[Mac Driver] Creating file: ${resolved}`);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, 'utf8');
  return { success: true };
}
