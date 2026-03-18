/**
 * Electron main process: tray, window, embedded server.
 */

const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const { startServer, DEFAULT_PORT } = require('./server.js');

const APP_NAME = 'Blockygotchi';
let mainWindow = null;
let tray = null;
let serverInstance = null;
let serverPort = DEFAULT_PORT;
const PORT_KEY = 'serverPort';
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

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
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
  const port = store.get(PORT_KEY, DEFAULT_PORT);
  const distDir = getDistDir();
  try {
    const { server, port: actualPort } = await startServer({
      distDir,
      port
    });
    serverInstance = { server };
    serverPort = actualPort;
    store.set(PORT_KEY, actualPort);
    updateTrayTooltip('Running');
    return actualPort;
  } catch (err) {
    const fallbackPort = port === DEFAULT_PORT ? 5174 : DEFAULT_PORT;
    try {
      const { server, port: actualPort } = await startServer({
        distDir,
        port: fallbackPort
      });
      serverInstance = { server };
      serverPort = actualPort;
      store.set(PORT_KEY, actualPort);
      updateTrayTooltip('Running');
      return actualPort;
    } catch (e) {
      updateTrayTooltip('Error');
      throw e;
    }
  }
}

function stopAppServer() {
  if (serverInstance?.server) {
    serverInstance.server.close();
    serverInstance = null;
  }
  updateTrayTooltip('Stopped');
}

app.whenReady().then(async () => {
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopAppServer();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopAppServer();
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

ipcMain.handle('stopServer', () => {
  stopAppServer();
  return { port: serverPort };
});
