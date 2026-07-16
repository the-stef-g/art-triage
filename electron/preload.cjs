// Preload: smal, godkendt bro mellem UI og hovedproces.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'lib:choose', 'lib:open', 'lib:recent', 'lib:current',
  'img:list', 'img:imageVersions', 'img:setRating', 'img:setFlag',
  'img:virtualCopy', 'img:renameVersion', 'img:deleteVersion', 'img:reveal',
  'ser:list', 'ser:create', 'ser:assign', 'ser:delete',
  'fold:tree', 'fold:create', 'fold:move', 'fold:cleanup',
  'ed:list', 'ed:open', 'ed:pick',
  'kw:top', 'kw:forFile',
  'search:status', 'app:counts', 'app:undo', 'app:redo',
]);

contextBridge.exposeInMainWorld('billedflow', {
  invoke(channel, payload) {
    if (!CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Ukendt kanal: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  onEvent(callback) {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('evt', handler);
    return () => ipcRenderer.removeListener('evt', handler);
  },
});
