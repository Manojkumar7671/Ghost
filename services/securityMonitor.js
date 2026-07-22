import fs from 'fs';
import path from 'path';
import os from 'os';

let failedAuthAttempts = new Map(); // ip -> array of timestamps

export function checkProcessSpawn(command) {
  const suspiciousKeywords = [
    'nc ', 'netcat', 'socat', 'bash -i', '/dev/tcp', 'sh -i', 'perl -e', 'python -c', 'ruby -e', 'php -r', 'powershell -noprofile', 'reverse_shell'
  ];
  const cmdLower = (command || '').toLowerCase();
  const matched = suspiciousKeywords.find(kw => cmdLower.includes(kw));
  if (matched) {
    console.error(`[Security Monitor] BLOCKING PROCESS SPAWN: "${command}"`);
    lockDownDaemonSession();
    throw new Error(`Security Violation: Process spawn blocked by defensive monitor (matched pattern: "${matched}").`);
  }
}

export function recordFailedAuth(ip) {
  const now = Date.now();
  const history = failedAuthAttempts.get(ip) || [];
  
  // Keep attempts in last 10 seconds
  const recent = history.filter(time => now - time < 10000);
  recent.push(now);
  failedAuthAttempts.set(ip, recent);

  if (recent.length >= 5) {
    console.warn(`[Security Monitor] Auth spike detected from ${ip}! Overwriting session to lock down.`);
    lockDownDaemonSession();
    return true; // Lock down active
  }
  return false;
}

export function lockDownDaemonSession() {
  const sessionFile = path.join(os.homedir(), '.ghost', 'daemon-session.json');
  if (fs.existsSync(sessionFile)) {
    try {
      fs.unlinkSync(sessionFile);
      console.warn('[Security Monitor] Session file deleted. Local Control Daemon is now logged out.');
    } catch (e) {
      console.error('[Security Monitor] Failed to delete session file:', e.message);
    }
  }
}
