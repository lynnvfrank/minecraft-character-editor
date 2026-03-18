/**
 * Preload script: exposes safe APIs to renderer via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getStatus: () => ipcRenderer.invoke('getStatus'),
  startServer: () => ipcRenderer.invoke('startServer'),
  stopServer: () => ipcRenderer.invoke('stopServer')
});
