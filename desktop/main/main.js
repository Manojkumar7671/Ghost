const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const axios = require('axios');

const GHOST_URL = 'http://localhost:3000';
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000, height: 700,
    title: 'GHOST — Brother Eye System',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    frame: false,
    transparent: true,
    resizable: true,
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

app.whenReady().then(() => { createWindow(); });

ipcMain.handle('chat-ghost', async (event, message) => {
  try {
    const response = await axios.post(`${GHOST_URL}/api/chat`, { message, channel: 'desktop' });
    return response.data;
  } catch { return { ghost: '🔴 Connection lost. Start the Ghost server first.' }; }
});

ipcMain.handle('spawn-agent', async (event, data) => {
  try {
    const response = await axios.post(`${GHOST_URL}/api/agents/spawn`, data);
    return response.data;
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('list-agents', async () => {
  try {
    const response = await axios.get(`${GHOST_URL}/api/agents`);
    return response.data;
  } catch { return []; }
});

ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('window-close', () => mainWindow.hide());

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
