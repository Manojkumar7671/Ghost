import { spawn } from 'child_process';

const WINDOWS_APP_LOOKUP = {
  browser: 'msedge.exe',
  notepad: 'notepad.exe',
  explorer: 'explorer.exe'
};

export function openUrl(url) {
  console.log(`[Windows Driver] Opening URL: ${url}`);
  // Start-Process in PowerShell opens the URL in the default web browser safely
  const child = spawn('powershell.exe', ['Start-Process', url]);
  child.unref();
  return { success: true };
}

export function openApp(appName) {
  const cleanApp = appName.toLowerCase().trim();
  const exe = WINDOWS_APP_LOOKUP[cleanApp] || cleanApp;
  console.log(`[Windows Driver] Opening App: ${exe}`);
  const child = spawn(exe, [], { detached: true });
  child.unref();
  return { success: true };
}

export function runScript(script) {
  console.log(`[Windows Driver] Running PowerShell automation...`);
  return new Promise((resolve) => {
    // Spawns powershell safely with no profile and passes the command in arguments
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
