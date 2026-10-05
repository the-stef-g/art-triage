// Overvaager biblioteksmappen og udloeser en synkronisering naar der sker
// aendringer udefra: redigeringer gemt fra en editor, nye filer, flytninger.
//
// Det var chokidar, men det aabner én fs.watch pr. fil, og paa macOS er det
// én aaben filhaandtering pr. fil (kqueue). Ved 15.000 billeder var
// processens filtabel fyldt, og saa kunne appen hverken starte sips eller
// aabne andre filer ("spawn EBADF"). fs.watch med recursive bruger paa macOS
// FSEvents: én overvaagning for hele traeet, uanset hvor mange filer.
import { watch } from 'node:fs';
import { debounce, isSupported } from './util.mjs';

// Er det en aendring der kan betyde noget for kataloget? Skjulte filer og
// mapper (.art-triage, .DS_Store) og filer der ikke er billeder gor ikke.
export function relevantAendring(filnavn) {
  if (!filnavn) return true; // ukendt: hellere en skanning for meget
  const dele = String(filnavn).split(/[\\/]/).filter(Boolean);
  if (dele.some((d) => d.startsWith('.') || d === 'node_modules')) return false;
  const sidste = dele[dele.length - 1] || '';
  // En mappe har ingen endelse; en fil skal vaere en billedfil.
  return !sidste.includes('.') || isSupported(sidste);
}

export function watchLibrary(root, onChange, { onError = null } = {}) {
  const trigger = debounce(onChange, 700);
  let w = null;
  try {
    w = watch(root, { recursive: true, persistent: false }, (_event, filnavn) => {
      if (relevantAendring(filnavn)) trigger();
    });
    w.on('error', (err) => onError?.(err));
  } catch (err) {
    // Overvaagningen er en bekvemmelighed; den periodiske skanning baerer
    // alligevel. Fejlen skal bare ikke vaelte aabningen af biblioteket.
    onError?.(err);
  }
  return {
    close: async () => {
      try { w?.close(); } catch { /* allerede lukket */ }
    },
  };
}
