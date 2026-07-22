const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, Notification, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow = null;
let tray = null;
let serverProcess = null;

const SERVER_URL = 'http://localhost:3000';
const ROOT_DIR = path.join(__dirname, '..');

/**
 * Checks if the Ghost server is already listening on localhost:3000
 */
function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(SERVER_URL, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/**
 * Spawns the Ghost Node.js server (server.js) locally with dotenv loaded
 */
function startGhostServer() {
  console.log('[Desktop Main] Spawning local Ghost server (server.js)...');
  serverProcess = spawn('node', ['-r', 'dotenv/config', 'server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: '3000' },
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('[Desktop Main] Server spawn error:', err.message);
  });
}

/**
 * Creates the primary Electron BrowserWindow
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#07090e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

/**
 * Sets up System Tray (Mac Menu Bar / Windows Taskbar Tray)
 */
function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('Ghost AI Desktop');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Ghost AI',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Hide Window',
      click: () => {
        if (mainWindow) mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Ghost AI',
      click: () => {
        app.isQuitting = true;
        cleanupAndQuit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

/**
 * Cleanly terminates child processes and exits app
 */
function cleanupAndQuit() {
  if (serverProcess) {
    console.log('[Desktop Main] Terminating spawned Ghost server process...');
    try {
      serverProcess.kill('SIGTERM');
    } catch (e) {}
  }
  app.quit();
}

// IPC Listener for Native Desktop Notifications
ipcMain.on('desktop-notify', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || 'Ghost AI', body: body || '' }).show();
  }
});

// Main Electron Lifecycle Init
app.whenReady().then(async () => {
  const running = await isServerRunning();
  if (!running) {
    startGhostServer();
    // Wait for server port 3000 to become ready
    for (let i = 0; i < 15; i++) {
      await new Promise((res) => setTimeout(res, 500));
      if (await isServerRunning()) break;
    }
  }

  createWindow();
  createTray();

  // Register Global Hotkey (Cmd/Ctrl+Shift+G)
  const shortcutKey = 'CommandOrControl+Shift+G';
  const registered = globalShortcut.register(shortcutKey, () => {
    if (mainWindow) {
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  if (registered) {
    console.log(`[Desktop Main] Global hotkey registered (${shortcutKey})`);
  } else {
    console.warn(`[Desktop Main] Failed to register global hotkey (${shortcutKey})`);
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  cleanupAndQuit();
});
