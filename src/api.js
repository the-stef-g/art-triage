// Tynd adgang til preload-broen. Alt UI gaar gennem invoke/onEvent.
const bridge = window.artTriage;

export const harBro = Boolean(bridge);

export function invoke(channel, payload) {
  if (!bridge) return Promise.reject(new Error('Appen skal koere i Electron'));
  return bridge.invoke(channel, payload);
}

export function onEvent(callback) {
  if (!bridge) return () => {};
  return bridge.onEvent(callback);
}

// "Retry failed previews" skifter dette tal. Det haenges paa adressen, saa
// browseren spoerger igen i stedet for at huske at billedet ikke kunne hentes.
let thumbRetry = 0;

export function setThumbRetry(n) {
  thumbRetry = n;
}

// rotation er brugerens egen drejning. Den staar i adressen, saa browseren
// henter forhaandsvisningen igen naar den aendres.
export function thumbUrl(fileId, mtime, size = 512, rotation = 0) {
  return `thumb://img/${fileId}?s=${size}&v=${mtime}${rotation ? `&o=${rotation}` : ''}${thumbRetry ? `&r=${thumbRetry}` : ''}`;
}
