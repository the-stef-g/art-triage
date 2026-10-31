// Electron paa Linux har systemets GLib indlaest, og sharp (libvips) binder
// sig til den i stedet for sin egen. Derfor staar loggen fuld af
// "g_object_unref: assertion 'G_IS_OBJECT (object)' failed", og en gang
// imellem (ca. hver 40. koersel) stopper GLib hele appen med SIGTRAP inde
// i sharp. Det sker kun paa Linux, altsaa kun i testene; appen koerer paa
// macOS, hvor der ikke er nogen system-GLib.
//
// En smoke-test der fejler, fordi appen doede paa netop den maade, slutter
// med GLIB_KODE, og smoke-koer.mjs koerer den én gang til. Alle andre fejl
// faar testen til at fejle som foer.
import { writeSync } from 'node:fs';

export const GLIB_KODE = 75;

// Hvordan appens proces sluttede: signalet, eller null hvis den stadig
// koerer efter ms millisekunder (saa var det ikke et nedbrud).
export function appSignal(proc, ms = 3000) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(proc.signalCode);
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), ms);
    proc.once('exit', (_code, signal) => { clearTimeout(t); ok(signal); });
  });
}

// Kaldes i catch, foer appen lukkes. Returnerer den kode testen skal slutte med.
export async function fejlKode(proc) {
  const signal = await appSignal(proc);
  if (signal === 'SIGTRAP') {
    writeSync(2, 'SMOKE: appen blev stoppet af GLib (SIGTRAP i sharp), den kendte Linux-fejl. Testen koeres igen.\n');
    return GLIB_KODE;
  }
  if (signal) writeSync(2, `SMOKE: appen doede med ${signal}\n`);
  return 1;
}
