const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ws', {
  barHeight: (px) => ipcRenderer.send('bar-height', px),
  listWindows: () => ipcRenderer.invoke('list-windows'),
  picker: (open) => ipcRenderer.send('picker', open),
  add: (hwnd) => ipcRenderer.send('add', hwnd),
  activate: (hwnd) => ipcRenderer.send('activate', hwnd),
  detach: (hwnd) => ipcRenderer.send('detach', hwnd),
  detachDrop: (hwnd) => ipcRenderer.send('detach-drop', hwnd),
  reorder: (hwnd, to) => ipcRenderer.send('reorder', hwnd, to),
  restore: () => ipcRenderer.invoke('restore'),
  onTabs: (cb) => ipcRenderer.on('tabs', (_e, state) => cb(state)),
  onDropHint: (cb) => ipcRenderer.on('drop-hint', (_e, on) => cb(on)),
});
