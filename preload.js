const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial) => ipcRenderer.invoke('settings:set', partial),
    onUpdated: (cb) => {
      const fn = (_e, data) => cb(data);
      ipcRenderer.on('settings:updated', fn);
      return () => ipcRenderer.removeListener('settings:updated', fn);
    },
  },
  overlay: {
    onSetup: (cb) => {
      const fn = (_e, data) => cb(data);
      ipcRenderer.on('overlay:setup', fn);
    },
    onReset: (cb) => {
      ipcRenderer.on('overlay:reset', () => cb());
    },
    ready: () => ipcRenderer.send('overlay:ready'),
    done: (payload) => ipcRenderer.invoke('overlay:done', payload),
    cancel: () => ipcRenderer.send('overlay:cancel'),
  },
});
