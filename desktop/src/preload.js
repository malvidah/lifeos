const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dayloopDesktop', {
  version: process.env.npm_package_version || '1.0.0',
  platform: process.platform,
});
