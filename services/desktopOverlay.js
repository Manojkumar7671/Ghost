import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let overlayWindow = null;
let captureInterval = null;
let lastCursorPos = { x: 0, y: 0 };

function getCursorPosition() {
    // In a generic node environment without robotjs, we can't easily get cursor
    // If electron is available dynamically, we can use screen
    try {
        const { screen } = require('electron');
        if (screen && screen.getCursorScreenPoint) {
            return screen.getCursorScreenPoint();
        }
    } catch (e) {}
    return { x: 0, y: 0 };
}

let isCapturing = false;

export function takeNativeScreenshot(targetPath) {
    if (isCapturing) {
        return Promise.reject(new Error('Capture already in progress'));
    }
    isCapturing = true;

    return new Promise((resolve, reject) => {
        const cleanup = () => { isCapturing = false; };

        exec(`screencapture -x -C ${targetPath}`, (error) => {
            if (!error && fs.existsSync(targetPath)) {
                cleanup();
                return resolve(targetPath);
            }
            // Fallback via Terminal.app if subshell TCC is restricted on macOS 15+
            const osaCmd = `osascript -e 'tell application "Terminal" to do script "screencapture -x -C ${targetPath} && exit"'`;
            exec(osaCmd, (error2) => {
                setTimeout(() => {
                    cleanup();
                    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
                        resolve(targetPath);
                    } else {
                        reject(new Error(`Native screencapture failed: ${error ? error.message : ''} ${error2 ? error2.message : ''}`));
                    }
                }, 2000);
            });
        });
    });
}

function captureScreenshot() {
    if (process.env.GHOST_DEPLOYMENT_MODE !== 'local') return;
    
    const timestamp = Date.now();
    const tmpPath = path.join('/tmp', `ghost_screen_${timestamp}.png`);
    
    takeNativeScreenshot(tmpPath).then(() => {
        console.log(`[DesktopOverlay] Native screenshot captured to ${tmpPath}`);
        fs.unlink(tmpPath, () => {});
    }).catch((err) => {
        console.error('[DesktopOverlay] Native screenshot failed:', err.message);
    });
}

function createOverlayWindow() {
    if (overlayWindow) return;

    try {
        const { app, BrowserWindow, screen } = require('electron');
        if (!app || !app.isReady()) {
            return;
        }

        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        overlayWindow = new BrowserWindow({
            width: 300,
            height: 100,
            x: width - 320,
            y: 20,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        overlayWindow.setIgnoreMouseEvents(true);

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        margin: 0;
                        overflow: hidden;
                        font-family: -apple-system, sans-serif;
                        background: rgba(15, 23, 42, 0.85);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 12px;
                        color: white;
                        padding: 12px;
                        backdrop-filter: blur(10px);
                        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                    }
                    .indicator {
                        display: inline-block;
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        background: #22c55e;
                        box-shadow: 0 0 8px #22c55e;
                        animation: pulse 2s infinite;
                        margin-right: 8px;
                    }
                    @keyframes pulse {
                        0% { opacity: 1; }
                        50% { opacity: 0.4; }
                        100% { opacity: 1; }
                    }
                    .status {
                        font-size: 13px;
                        font-weight: 500;
                        display: flex;
                        align-items: center;
                        margin-bottom: 6px;
                    }
                    .preview {
                        font-size: 11px;
                        color: #94a3b8;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                </style>
            </head>
            <body>
                <div class="status"><span class="indicator"></span> Listening...</div>
                <div class="preview" id="action-preview">Awaiting input</div>
            </body>
            </html>
        `;

        overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    } catch (e) {
        console.warn('[DesktopOverlay] Electron not available, floating UI skipped.');
    }
}

export function initDesktopOverlay() {
    if (process.env.GHOST_DEPLOYMENT_MODE !== 'local') {
        console.log('[DesktopOverlay] Skipped: GHOST_DEPLOYMENT_MODE is not local.');
        return;
    }

    console.log('[DesktopOverlay] Initializing screen-aware companion...');
    
    try {
        const { app } = require('electron');
        if (app) {
            app.whenReady().then(createOverlayWindow);
        }
    } catch (e) {}

    captureInterval = setInterval(() => {
        captureScreenshot();
        lastCursorPos = getCursorPosition();
    }, 500);
}

export function stopDesktopOverlay() {
    if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
    }
    if (overlayWindow) {
        overlayWindow.close();
        overlayWindow = null;
    }
}
