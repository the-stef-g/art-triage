// Koerer en smoke-test, og én gang til, hvis den sluttede med GLIB_KODE:
// appen blev stoppet af den kendte GLib-fejl paa Linux (se smoke-glib.mjs).
// Alle andre fejl tæller med det samme.
import { spawnSync } from 'node:child_process';
import { GLIB_KODE } from './smoke-glib.mjs';

const script = process.argv[2];
const koer = () => spawnSync(process.execPath, [script], { stdio: 'inherit' }).status ?? 1;

let kode = koer();
if (kode === GLIB_KODE) {
  console.log(`::warning::${script}: appen blev stoppet af GLib (SIGTRAP i sharp) paa Linux. Koeres én gang til.`);
  kode = koer();
  if (kode === GLIB_KODE) console.error(`${script}: GLib stoppede appen to gange i traek.`);
}
process.exit(kode === 0 ? 0 : 1);
