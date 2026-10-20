const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  quitGame: () => ipcRenderer.send('quit-game'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  platform: process.platform,
});
