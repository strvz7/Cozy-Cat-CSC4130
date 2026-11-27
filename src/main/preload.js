const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cozyApi', {
  getConfig: () => ipcRenderer.invoke('cozy:get-config'),
  dragWindow: (dx, dy) => ipcRenderer.send('cozy:drag-window', { dx, dy }),
  closeRoomWindow: () => ipcRenderer.send('cozy:close-room'),
  minimizeRoomWindow: () => ipcRenderer.send('cozy:minimize-room'),
  openRoom: () => ipcRenderer.send('cozy:open-room'),
  sendToDesktop: () => ipcRenderer.send('cozy:send-to-desktop'),
  quitApp: () => ipcRenderer.send('cozy:quit-app'),
  setOverlayInteractive: (interactive) => ipcRenderer.send('cozy:overlay-interactive', Boolean(interactive)),
  focusOverlay: () => ipcRenderer.send('cozy:focus-overlay'),
  onOverlayShortcut: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('cozy:overlay-command', listener);
    return () => ipcRenderer.removeListener('cozy:overlay-command', listener);
  },
});
