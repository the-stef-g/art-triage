// Preload til det skjulte AI-vindue: modtag jobs, send resultater.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiBridge', {
  onJob(callback) {
    ipcRenderer.on('ai:job', (_event, job) => callback(job));
  },
  send(msg) {
    ipcRenderer.send('ai:msg', msg);
  },
});
