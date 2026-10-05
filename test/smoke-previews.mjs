// Smoke-test af forhaandsvisninger i den rigtige app: en RAW-fil med en
// indbygget JPEG, en TIFF og en PNG skal alle vise et billede i griddet, og en
// RAW-fil uden JPEG skal ende i "N previews failed" med en Retry-knap.
// Koeres i CI under Xvfb: `xvfb-run npm run smoke:previews`.
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

setTimeout(() => {
  console.error('SMOKE FEJL: haard timeout efter 4 minutter');
  process.exit(1);
}, 240000);

const sharp = (await import('sharp')).default;
const lib = mkdtempSync(join(tmpdir(), 'art-triage-smoke-prev-'));

function tiffHoved(retning) {
  const b = Buffer.alloc(24);
  b.write('II', 0, 'latin1');
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(8, 4);
  b.writeUInt16LE(1, 8);
  b.writeUInt16LE(0x0112, 10);
  b.writeUInt16LE(3, 12);
  b.writeUInt32LE(1, 14);
  b.writeUInt16LE(retning, 18);
  return b;
}

const jpeg = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#3366cc' } }).jpeg().toBuffer();
writeFileSync(join(lib, 'Banegaarden.CR2'), Buffer.concat([tiffHoved(6), Buffer.alloc(64), jpeg]));
await sharp({ create: { width: 800, height: 600, channels: 3, background: '#cc6633' } }).tiff().toFile(join(lib, 'Roofs.tif'));
await sharp({ create: { width: 200, height: 100, channels: 3, background: '#33cc66' } }).png().toFile(join(lib, 'groen.png'));
writeFileSync(join(lib, 'tom.NEF'), Buffer.concat([tiffHoved(1), Buffer.alloc(2000)]));

const app = await electron.launch({
  executablePath: process.env.ELECTRON_PATH || undefined,
  args: ['.'],
  cwd: projectRoot,
  timeout: 60000,
  env: {
    ...process.env,
    ART_TRIAGE_OPEN: lib,
    ART_TRIAGE_DISABLE_AI: '1',
    ELECTRON_DISABLE_SANDBOX: '1',
  },
});
const proc = app.process();
proc.stdout?.on('data', (d) => process.stdout.write(`[app] ${d}`));
proc.stderr?.on('data', (d) => process.stderr.write(`[app] ${d}`));

let succes = false;
try {
  const page = await app.firstWindow({ timeout: 60000 });
  await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 4, null, { timeout: 45000 });

  // De tre rigtige billeder skal faa et indlaest billede.
  const status = await page.waitForFunction(() => {
    const out = {};
    for (const t of document.querySelectorAll('.tile')) {
      const navn = t.querySelector('.tile-navn')?.textContent;
      const img = t.querySelector('img');
      out[navn] = Boolean(img && img.complete && img.naturalWidth > 0);
    }
    return out['Banegaarden.CR2'] && out['Roofs.tif'] && out['groen.png'] ? out : false;
  }, null, { timeout: 30000 }).then((h) => h.jsonValue());
  if (!status['Banegaarden.CR2']) throw new Error('RAW-filen med en indbygget JPEG viste ikke et billede');

  // Den indbyggede JPEG er liggende (1600 x 1000), og RAW-filen siger
  // retning 6, saa forhaandsvisningen skal staa op.
  const maal = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.tile')].find((x) => x.querySelector('.tile-navn')?.textContent === 'Banegaarden.CR2');
    const i = t.querySelector('img');
    return { w: i.naturalWidth, h: i.naturalHeight };
  });
  if (!(maal.h > maal.w)) throw new Error(`RAW-forhaandsvisningen er ikke drejet efter RAW-filens retning (${maal.w} x ${maal.h})`);

  // Filen uden JPEG kan ikke vises, og statuslinjen siger det.
  await page.waitForFunction(
    () => /1 preview failed/.test(document.querySelector('.statusbar')?.textContent || ''),
    null,
    { timeout: 20000 }
  );
  const retry = page.locator('.statusbar button', { hasText: 'Retry' });
  if (await retry.count() !== 1) throw new Error('Retry-knappen mangler i statuslinjen');
  const svar = await page.evaluate(() => window.artTriage.invoke('thumbs:retry'));
  if (svar.antal !== 1) throw new Error(`Retry skulle melde 1 fejlet forhaandsvisning, fik ${svar.antal}`);

  // Modelfilerne til AI-vinduet skal serveres med Content-Length. Uden den
  // laeser transformers.js dem med en buffer der vokser et stykke ad gangen
  // og kopieres hver gang, og en 290 MB tekstmodel tog fem minutter at faa klar.
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  mkdirSync(join(userData, 'model-cache'), { recursive: true });
  writeFileSync(join(userData, 'model-cache', 'smoketest__model.bin'), Buffer.alloc(1048576, 3));
  const model = await app.evaluate(async ({ session }) => {
    const r = await session.fromPartition('persist:ai').fetch('https://billedflow-models.local/smoketest/model.bin');
    return { laengde: r.headers.get('content-length'), bytes: (await r.arrayBuffer()).byteLength };
  });
  if (model.laengde !== '1048576' || model.bytes !== 1048576) {
    throw new Error(`Modelfilen skal serveres med Content-Length 1048576, fik ${JSON.stringify(model)}`);
  }

  console.log('SMOKE OK: RAW med indbygget JPEG, TIFF og PNG viser billeder; en fejlet forhaandsvisning kan proeves igen; modelfiler serveres med Content-Length');
  succes = true;
} catch (err) {
  console.error('SMOKE FEJL:', err.message);
  try {
    const page = await app.firstWindow({ timeout: 5000 });
    await page.screenshot({ path: 'smoke-previews-fejl.png' });
  } catch { /* ingen skaermbillede */ }
} finally {
  await app.close().catch(() => {});
}
process.exit(succes ? 0 : 1);
