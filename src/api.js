// Tynd adgang til preload-broen. Alt UI gaar gennem invoke/onEvent.
const bridge = window.billedflow;

export const harBro = Boolean(bridge);

export function invoke(channel, payload) {
  if (!bridge) return Promise.reject(new Error('Appen skal koere i Electron'));
  return bridge.invoke(channel, payload);
}

export function onEvent(callback) {
  if (!bridge) return () => {};
  return bridge.onEvent(callback);
}

export function thumbUrl(fileId, mtime, size = 512) {
  return `thumb://img/${fileId}?s=${size}&v=${mtime}`;
}
