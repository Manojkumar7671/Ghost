const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostDesktop', {
  notify: (title, body) => ipcRenderer.send('desktop-notify', { title, body }),
  isDesktop: true
});
