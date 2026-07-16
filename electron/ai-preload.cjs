// Preload til det skjulte AI-vindue: modtag jobs, send resultater,
// hent opstartskonfiguration (bl.a. valgfri Hugging Face-token).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiBridge', {
  onJob(callback) {
    ipcRenderer.on('ai:job', (_event, job) => callback(job));
  },
  send(msg) {
    ipcRenderer.send('ai:msg', msg);
  },
  getInit() {
    return ipcRenderer.invoke('ai:init');
  },
});
