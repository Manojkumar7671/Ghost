import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { classifyCommand } = require('../commandGate.js');

const WINDOWS_APP_LOOKUP = {
  browser: 'msedge.exe',
  notepad: 'notepad.exe',
  explorer: 'explorer.exe'
};

export function openUrl(url) {
  const gateRes = classifyCommand(url);
  if (!gateRes.safe) {
    throw new Error(gateRes.reason);
  }

  console.log(`[Windows Driver] Opening URL: ${url}`);
  const child = spawn('powershell.exe', ['Start-Process', url]);
  child.unref();
  return { success: true };
}

export function openApp(appName) {
  const gateRes = classifyCommand(appName);
  if (!gateRes.safe) {
    throw new Error(gateRes.reason);
  }

  const cleanApp = appName.toLowerCase().trim();
  const exe = WINDOWS_APP_LOOKUP[cleanApp] || cleanApp;
  console.log(`[Windows Driver] Opening App: ${exe}`);
  const child = spawn(exe, [], { detached: true });
  child.unref();
  return { success: true };
}

export function runScript(script) {
  const gateRes = classifyCommand(script);
  if (!gateRes.safe) {
    throw new Error(gateRes.reason);
  }

  console.log(`[Windows Driver] Running PowerShell automation...`);
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script]);
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
