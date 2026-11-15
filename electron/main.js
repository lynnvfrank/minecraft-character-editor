/**
 * Electron main process: tray, window, embedded server.
 */

const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const { startServer, DEFAULT_PORT } = require('./server.js');

const APP_NAME = 'Blockygotchi';
const IS_MAC = process.platform === 'darwin';
let mainWindow = null;
let tray = null;
let serverInstance = null;
let serverPort = DEFAULT_PORT;
let store = null;
let isFirstRun = false;

async function initStore() {
  if (store) return store;

  const { default: Store } = await import('electron-store');
  store = new Store();
  isFirstRun = !store.get('hasLaunchedBefore');
  if (isFirstRun) {
    store.set('hasLaunchedBefore', true);
  }
  return store;
}

function getDistDir() {
  return path.join(__dirname, '..', 'dist');
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    },
    show: false,
    title: APP_NAME
  });

  const url = `http://localhost:${serverPort}`;
  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // On macOS, closing the window keeps the app in the dock/tray (platform convention).
  // Elsewhere, closing the window quits the app.
  mainWindow.on('close', (e) => {
    if (IS_MAC && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icons', 'icon.png');
  const fs = require('fs');
  const { nativeImage } = require('electron');
  const fileIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;
  const placeholder = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVQ4T2NkYGD4z0ABYBwNxhHpBgb/Gf4z/GdggGcYAwMDIwMDPAMDAwMjAwMAqQgL/o1R9u0AAAAASUVORK5CYII='
  );
  const trayIcon = fileIcon && !fileIcon.isEmpty() ? fileIcon : placeholder;
  tray = new Tray(trayIcon);

  tray.setToolTip(`${APP_NAME} — Running`);
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createWindow();
    }
  });
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => createWindow() },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
}

function updateTrayTooltip(status) {
  if (tray) {
    tray.setToolTip(`${APP_NAME} — ${status}`);
  }
}

async function startAppServer() {
  if (serverInstance) return serverPort;
  await initStore();
  const distDir = getDistDir();
  // Always try the default port first. Older builds saved a port in the store; it's
  // ignored now, so a past fallback (or Vite's 5173) never sticks.
  let instance;
  try {
    instance = await startServer({ distDir, port: DEFAULT_PORT });
  } catch (err) {
    if (err.code !== 'EADDRINUSE') {
      updateTrayTooltip('Error');
      throw err;
    }
    // Preferred port is busy: let the OS pick a free one.
    instance = await startServer({ distDir, port: 0 });
  }
  serverInstance = instance;
  serverPort = instance.port;
  updateTrayTooltip('Running');
  return serverPort;
}

/** Close Socket.IO and the HTTP server, dropping open connections so nothing keeps the process alive. */
function stopAppServer() {
  const instance = serverInstance;
  serverInstance = null;
  updateTrayTooltip('Stopped');
  if (!instance) return Promise.resolve();
  return new Promise((resolve) => {
    instance.io.close();
    instance.server.closeAllConnections?.();
    instance.server.close(() => resolve());
    setTimeout(resolve, 1000); // never block quitting on a stuck socket
  });
}

if (!app.requestSingleInstanceLock()) {
  // Another copy is already running; it will show its window (see 'second-instance').
  app.quit();
} else {
  app.on('second-instance', () => createWindow());
  app.whenReady().then(onReady);
}

async function onReady() {
  app.setName(APP_NAME);
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = path.join(__dirname, 'icons', 'dock.png');
    const fs = require('fs');
    if (fs.existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath);
    }
  }
  try {
    await initStore();
    await startAppServer();
  } catch (err) {
    console.error('Failed to start server:', err);
  }
  createTray();
  createWindow();
}

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});

app.on('activate', () => createWindow());

app.on('before-quit', (e) => {
  app.isQuitting = true;
  if (!serverInstance) return;
  // Hold the quit until the server has shut down, then quit for real.
  e.preventDefault();
  stopAppServer().then(() => {
    tray?.destroy();
    tray = null;
    app.quit();
  });
});

ipcMain.handle('getStatus', () => ({
  running: !!serverInstance,
  port: serverPort,
  url: `http://localhost:${serverPort}`,
  isFirstRun
}));

ipcMain.handle('startServer', async () => {
  await startAppServer();
  return { port: serverPort, url: `http://localhost:${serverPort}` };
});

ipcMain.handle('stopServer', async () => {
  await stopAppServer();
  return { port: serverPort };
});
