// Preload: smal, godkendt bro mellem UI og hovedproces.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'lib:choose', 'lib:open', 'lib:recent', 'lib:current',
  'lib:rescan', 'lib:driveStatus',
  'img:list', 'img:imageVersions', 'img:setRating', 'img:setStage', 'img:setEditor',
  'img:virtualCopy', 'img:renameVersion', 'img:deleteVersion', 'img:reveal', 'img:rotate', 'img:openWorkFolder', 'crop:save', 'crop:delete', 'crop:kaede', 'img:setCrop', 'img:filmstrip', 'edit:send', 'edit:makeMaster', 'work:discard', 'print:make', 'print:prisliste', 'print:maal', 'work:auto',
  'ser:list', 'ser:create', 'ser:assign', 'ser:rename', 'ser:delete', 'ser:setShop',
  'fold:tree', 'fold:create', 'fold:move', 'fold:cleanup',
  'ed:list', 'ed:statusNames', 'ed:open', 'ed:pick',
  'kw:top', 'kw:forFile', 'kw:add', 'kw:remove', 'kw:removeFromFiles', 'kw:serieOrd',
  'kw:status', 'kw:run', 'kw:stop', 'kw:setModel', 'kw:reanalyse',
  'work:get', 'work:save', 'work:setCrop', 'work:writeTexts', 'work:pickVideo',
  'shop:status', 'shop:send', 'shop:publish', 'shop:remove', 'shop:updateAllPrints', 'shop:updateTexts', 'shop:checkFormat',
  'thumbs:status', 'thumbs:retry',
  'search:status', 'app:counts', 'app:undo', 'app:redo',
  'app:info', 'app:setHfToken', 'app:setClaudeKey', 'app:setWooKey', 'app:setWpKey',
]);

contextBridge.exposeInMainWorld('artTriage', {
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
