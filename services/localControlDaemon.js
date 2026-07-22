import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import readline from 'readline';
import WebSocket from 'ws';

if (process.env.GHOST_DEPLOYMENT_MODE !== 'local') {
  console.error('[Daemon] Local Control Daemon can only run when GHOST_DEPLOYMENT_MODE=local. Exiting.');
  process.exit(0);
}

const sessionDir = path.join(os.homedir(), '.ghost');
const sessionFile = path.join(sessionDir, 'daemon-session.json');

// Ensure ~/.ghost directory exists
try {
  fs.mkdirSync(sessionDir, { recursive: true });
} catch (e) {
  console.warn('[Daemon] Failed to create session directory:', e.message);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

function promptPassphrase() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('\n🔐 Enter Ghost Admin Passphrase to authenticate Local Control Daemon: ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function getOrInitSessionToken() {
  const currentPassphrase = process.env.ADMIN_PASSPHRASE;
  if (!currentPassphrase) {
    console.error('[Daemon] ADMIN_PASSPHRASE is not set in environment. Exiting.');
    process.exit(1);
  }
  const currentHash = sha256(currentPassphrase);

  let sessionData = null;
  if (fs.existsSync(sessionFile)) {
    try {
      sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    } catch (e) {
      console.warn('[Daemon] Failed to read existing session file:', e.message);
    }
  }

  const isValid = sessionData &&
                  sessionData.token &&
                  sessionData.expiresAt > Date.now() &&
                  sessionData.passphraseHash === currentHash;

  if (isValid) {
    console.log('[Daemon] Authenticated successfully via cached local session token.');
    return sessionData.token;
  }

  // Session token expired, invalid, or passphrase changed -> prompt for passphrase
  console.log('[Daemon] Local daemon session token expired or invalid.');
  const enteredPassphrase = await promptPassphrase();
  const enteredHash = sha256(enteredPassphrase);

  if (enteredHash !== currentHash) {
    console.error('[Daemon Auth] Invalid ADMIN_PASSPHRASE. Exiting.');
    process.exit(1);
  }

  // Create new session
  const newToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  try {
    fs.writeFileSync(sessionFile, JSON.stringify({
      token: newToken,
      expiresAt,
      passphraseHash: currentHash
    }, null, 2), 'utf8');
    console.log('[Daemon] Successfully created new 7-day daemon session token.');
  } catch (e) {
    console.warn('[Daemon] Failed to persist session token to disk:', e.message);
  }

  return newToken;
}

async function start() {
  // 1. Load platform driver
  let driver;
  if (process.platform === 'darwin') {
    driver = await import('./controlDrivers/macDriver.js');
  } else if (process.platform === 'win32') {
    driver = await import('./controlDrivers/windowsDriver.js');
  } else {
    console.error(`[Daemon] Unsupported OS platform: ${process.platform}. Exiting.`);
    process.exit(1);
  }

  // 2. Authenticate and retrieve token
  const token = await getOrInitSessionToken();

  // 3. Connect to WebSocket Server
  const PORT = process.env.PORT || 10000;
  const wsUrl = `ws://127.0.0.1:${PORT}/api/local-control?token=${token}`;

  function connect() {
    console.log(`[Daemon] Connecting to Ghost Local Control Endpoint at ws://127.0.0.1:${PORT}...`);
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('[Daemon] Connected to Ghost Server successfully. Listening for automation events...');
    });

    ws.on('message', async (data) => {
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch (e) {
        console.error('[Daemon] Received invalid payload format');
        return;
      }

      const { id, command, args = {} } = payload;
      console.log(`[Daemon] Received automation request [${command}] id: ${id}`);

      let result;
      try {
        if (command === 'openUrl') {
          result = await driver.openUrl(args.url);
        } else if (command === 'openApp') {
          result = await driver.openApp(args.appName);
        } else if (command === 'runScript') {
          result = await driver.runScript(args.script);
        } else if (command === 'readFile') {
          result = await driver.readFile(args.path);
        } else if (command === 'editFile') {
          result = await driver.editFile(args.path, args.oldStr, args.newStr);
        } else if (command === 'createFile') {
          result = await driver.createFile(args.path, args.content);
        } else {
          throw new Error(`Unknown automation command: ${command}`);
        }
        ws.send(JSON.stringify({ id, success: true, result }));
      } catch (err) {
        console.error(`[Daemon] Automation [${command}] failed:`, err.message);
        ws.send(JSON.stringify({ id, success: false, error: err.message }));
      }
    });

    ws.on('close', () => {
      console.warn('[Daemon] Connection closed. Reconnecting in 5 seconds...');
      setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
      console.error('[Daemon] WebSocket Error:', err.message);
    });
  }

  connect();
}

start();
