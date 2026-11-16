// Indlaeser sharp fra den pakkede Linux-app og laver et lille billede.
// Det viser, at sharp er med i appen og kan koere.
//
// Paa GitHubs Linux-maskiner hang Electron som Node (ELECTRON_RUN_AS_NODE)
// fra november 2026 i flere minutter og doede med SIGSEGV, foer det
// skrev noget som helst; paa en anden Linux-maskine tog det samme 0,2 s.
// Det er Electrons GLib paa Linux (se test/smoke-glib.mjs), ikke sharp, og
// appen koerer paa macOS. Derfor: en tidsgraense, og ellers
// sharps pakkede binaerfil indlaest med almindelig Node, med en advarsel.
// En rigtig fejl fra sharp faar trinnet til at fejle som foer.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [appBin, appDir] = process.argv.slice(2);
const sharpSti = resolve(appDir, 'resources/app.asar/node_modules/sharp');
// sharps egen binaerfil, som den ligger udpakket ved siden af app.asar.
const binding = resolve(appDir, 'resources/app.asar.unpacked/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node');

const kode = (sti) => `
  const t0 = Date.now();
  const log = (m) => console.log(((Date.now() - t0) / 1000).toFixed(2) + 's ' + m);
  log('loading sharp');
  const sharp = require(${JSON.stringify(sti)});
  log('sharp loaded');
  sharp({ create: { width: 300, height: 200, channels: 3, background: '#0963c7' } }).tiff().toBuffer()
    .then((b) => sharp(b).resize(100, 100, { fit: 'inside' }).jpeg().toBuffer())
    .then((o) => log('packed sharp ok, ' + o.length + ' bytes'))
    .catch((e) => { console.error('packed sharp FAILED: ' + e.message); process.exit(1); });
`;

function koer(bin, args, env) {
  // SIGKILL: den haengende Electron-proces ignorerede SIGTERM, saa
  // tidsgraensen paa 60 s blev til fem minutter.
  const r = spawnSync(bin, args, { env: { ...process.env, ...env }, encoding: 'utf8', timeout: Number(process.env.SHARP_TIMEOUT_MS || 60_000), killSignal: 'SIGKILL' });
  const ud = `${r.stdout || ''}${(r.stderr || '').split('\n').filter((l) => !/GLib-GObject|^\s*$/.test(l)).join('\n')}`;
  process.stdout.write(ud.endsWith('\n') ? ud : `${ud}\n`);
  return { ok: r.status === 0 && /packed sharp ok/.test(r.stdout || ''), fejl: /packed sharp FAILED/.test(ud), signal: r.signal, status: r.status, tidUd: r.error?.code === 'ETIMEDOUT' };
}

const electron = { ELECTRON_RUN_AS_NODE: '1', ELECTRON_DISABLE_SANDBOX: '1' };
// Ét forsoeg: naar det haenger, haenger det hver gang (sharp er indlaest
// efter 0,05 s, og saa staar billedarbejdet stille).
console.log('Electron as Node:');
const r = koer(appBin, ['-e', kode(sharpSti)], electron);
if (r.ok) process.exit(0);
if (r.fejl) process.exit(1);
console.log(`  ended without an answer (${r.tidUd ? 'no answer in 60 s' : `signal ${r.signal}, code ${r.status}`})`);
// Almindelig Node kan ikke laese app.asar, men den pakkede binaerfil, som
// er det der kunne mangle eller vaere bygget til den forkerte maskine.
console.log('Plain Node, the packed sharp binary:');
const n = spawnSync(process.execPath, ['-e', `
  const b = require(${JSON.stringify(binding)});
  const v = b.libvipsVersion();
  console.log('packed sharp binary ok, libvips ' + v.semver);
`], { encoding: 'utf8', timeout: Number(process.env.SHARP_TIMEOUT_MS || 60_000), killSignal: 'SIGKILL' });
process.stdout.write(n.stdout || '');
if (n.status !== 0 || !/packed sharp binary ok/.test(n.stdout || '')) {
  process.stderr.write(n.stderr || '');
  process.exit(1);
}
console.log('::warning::Electron as Node did not answer on this machine (the Linux GLib problem); the packed sharp binary loads with plain Node.');
