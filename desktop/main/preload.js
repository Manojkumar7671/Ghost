const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostAPI', {
  chat: (message) => ipcRenderer.invoke('chat-ghost', message),
  spawnAgent: (data) => ipcRenderer.invoke('spawn-agent', data),
  listAgents: () => ipcRenderer.invoke('list-agents'),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
});
