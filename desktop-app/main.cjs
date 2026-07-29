const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, Notification, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let serverProcess = null;

const SERVER_URL = 'http://localhost:3000';
const PROJECT_DIR = '/Users/manojkumarmathangi/Ghost';
const ROOT_DIR = fs.existsSync(PROJECT_DIR) ? PROJECT_DIR : path.join(__dirname, '..');

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
 * Starts the Ghost and FreeLLMAPI backend processes via PM2
 */
function startGhostServer() {
  console.log('[Desktop Main] Starting PM2 processes (ghost-ai & freellmapi)...');
  // Use spawn to run 'pm2 start ecosystem.config.cjs'
  const pm2Process = spawn('pm2', ['start', 'ecosystem.config.cjs'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true
  });

  pm2Process.on('error', (err) => {
    console.error('[Desktop Main] PM2 process startup error:', err.message);
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
    show: false,
    backgroundColor: '#07090e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Browser Console] ${message} (from ${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Browser Load Error] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`[Browser Error] Render process gone: ${JSON.stringify(details)}`);
  });

  mainWindow.on('unresponsive', () => {
    console.error('[Browser Error] Window became unresponsive.');
  });


  mainWindow.loadURL(SERVER_URL);
  mainWindow.webContents.openDevTools();

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
  console.log('[Desktop Main] Stopping PM2 processes (ghost-ai & freellmapi)...');
  try {
    // Run 'pm2 stop ecosystem.config.cjs' synchronously before exiting
    spawnSync('pm2', ['stop', 'ecosystem.config.cjs'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true
    });
    console.log('[Desktop Main] PM2 backend stopped.');
  } catch (e) {
    console.error('[Desktop Main] Failed to stop PM2 on exit:', e.message);
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
  try {
    app.setLoginItemSettings({
      openAtLogin: false,
      openAsHidden: false
    });
    console.log('[Desktop Main] Disabled native openAtLogin setting.');
  } catch (err) {
    console.warn('[Desktop Main] Failed to set login item settings:', err.message);
  }

  const running = await isServerRunning();
  if (!running) {
    startGhostServer();
    // Wait for server port 3000 to become ready (up to 15 seconds)
    for (let i = 0; i < 30; i++) {
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

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  cleanupAndQuit();
});
