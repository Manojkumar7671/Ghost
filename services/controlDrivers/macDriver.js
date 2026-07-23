import { spawn, execSync } from 'child_process';
import { classifyCommand } from '../commandGate.js';
import { checkProcessSpawn } from '../securityMonitor.js';
import fs from 'fs';

function resolveAppPath(appName) {
  if (appName.startsWith('/') && appName.endsWith('.app') && fs.existsSync(appName)) {
    return appName;
  }
  const cleanName = appName.replace(/\.app$/, '');
  try {
    const query = `kMDItemContentType == "com.apple.application-bundle" && kMDItemFSName == "${cleanName}.app"`;
    const stdout = execSync(`mdfind '${query}'`, { encoding: 'utf8' }).trim();
    if (stdout) {
      const paths = stdout.split('\n');
      if (paths.length > 0 && paths[0].endsWith('.app')) {
        console.log(`[Mac Driver] Resolved app name "${appName}" to path: ${paths[0]}`);
        return paths[0];
      }
    }
  } catch (e) {
    console.warn(`[Mac Driver] Spotlight search exact match failed for "${appName}":`, e.message);
  }

  try {
    const fallbackQuery = `kMDItemContentType == "com.apple.application-bundle" && kMDItemFSName == "*${cleanName}*.app"`;
    const stdout = execSync(`mdfind '${fallbackQuery}'`, { encoding: 'utf8' }).trim();
    if (stdout) {
      const paths = stdout.split('\n');
      const validPath = paths.find(p => p.endsWith('.app'));
      if (validPath) {
        console.log(`[Mac Driver] Resolved app name "${appName}" to fallback path: ${validPath}`);
        return validPath;
      }
    }
  } catch (e) {
    console.warn(`[Mac Driver] Spotlight search fallback failed for "${appName}":`, e.message);
  }

  return appName;
}

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

  const resolved = resolveAppPath(appName);
  console.log(`[Mac Driver] Opening App: ${resolved}`);
  const child = resolved.startsWith('/') ? spawn('open', [resolved]) : spawn('open', ['-a', resolved]);
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
