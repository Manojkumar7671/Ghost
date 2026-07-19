import { WebSocketServer } from 'ws';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

let activeWs = null;
const pendingCalls = new Map();

export const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('[Local Control Server] Daemon client connected successfully.');
  activeWs = ws;

  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data.toString());
      const pending = pendingCalls.get(payload.id);
      if (pending) {
        pendingCalls.delete(payload.id);
        if (payload.success) {
          pending.resolve(payload.result);
        } else {
          pending.reject(new Error(payload.error || 'Daemon execution failed'));
        }
      }
    } catch (e) {
      console.error('[Local Control Server] Error handling message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[Local Control Server] Daemon client disconnected.');
    if (activeWs === ws) {
      activeWs = null;
    }
  });
});

export function authenticateUpgrade(req) {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const tokenParam = urlObj.searchParams.get('token');
    if (!tokenParam) return false;

    const sessionFile = path.join(os.homedir(), '.ghost', 'daemon-session.json');
    if (!fs.existsSync(sessionFile)) return false;

    const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    const currentPassphrase = process.env.ADMIN_PASSPHRASE;
    if (!currentPassphrase) return false;

    const currentHash = crypto.createHash('sha256').update(currentPassphrase).digest('hex');

    return sessionData.token &&
           sessionData.token === tokenParam &&
           sessionData.expiresAt > Date.now() &&
           sessionData.passphraseHash === currentHash;
  } catch (e) {
    return false;
  }
}

export function sendDaemonCommand(command, args) {
  return new Promise((resolve, reject) => {
    if ((process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public') {
      return reject(new Error('Access Denied: Local Control actions are restricted to local deployment mode.'));
    }
    if (!activeWs) {
      return reject(new Error('Local Control Daemon is not connected. Ensure the daemon is running on your host machine.'));
    }

    const callId = crypto.randomBytes(16).toString('hex');
    pendingCalls.set(callId, {
      resolve,
      reject,
      expiresAt: Date.now() + 30000
    });

    // Cleanup stale calls on timeout
    setTimeout(() => {
      if (pendingCalls.has(callId)) {
        pendingCalls.delete(callId);
        reject(new Error(`Daemon command [${command}] timed out after 30 seconds`));
      }
    }, 30000);

    activeWs.send(JSON.stringify({ id: callId, command, args }));
  });
}
export function getActiveWs() {
  return activeWs;
}
