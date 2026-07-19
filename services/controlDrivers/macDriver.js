import { spawn } from 'child_process';

export function openUrl(url) {
  console.log(`[Mac Driver] Opening URL: ${url}`);
  const child = spawn('open', [url]);
  child.unref();
  return { success: true };
}

export function openApp(appName) {
  console.log(`[Mac Driver] Opening App: ${appName}`);
  const child = spawn('open', ['-a', appName]);
  child.unref();
  return { success: true };
}

export function runScript(script) {
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
