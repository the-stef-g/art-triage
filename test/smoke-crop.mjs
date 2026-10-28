// Smoke test af beskaering i den byggede app: godkend et billede, laeg en
// masterfil i Master, beskaer den, og se at der kommer en ny fil i Master.
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
setTimeout(() => {
  console.error('SMOKE FEJL: haard timeout efter 4 minutter');
  process.exit(1);
}, 240000);

const sharp = (await import('sharp')).default;
const lib = mkdtempSync(join(tmpdir(), 'art-triage-smoke-crop-'));
mkdirSync(join(lib, 'Import'), { recursive: true });
const billede = (navn) => sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 200, g: 120, b: 40 } } })
  .png().toFile(navn);
await billede(join(lib, 'Import', 'blaa.png'));

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

let succes = false;
try {
  const page = await app.firstWindow({ timeout: 60000 });
  await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 60000 });
  // Fasen huskes fra sidste koersel, saa testen starter selv i fase 1.
  await page.locator('.fase', { hasText: 'Sort' }).click({ timeout: 60000 });
  await page.waitForSelector('.tile', { timeout: 60000 });

  // Fase 1, godkend: filen flytter ind i en arbejdsmappe og videre til fase 2.
  await page.locator('.tile').first().click();
  await page.keyboard.press('a');
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 0, null, { timeout: 15000 });
  await page.locator('.fase', { hasText: 'Edit' }).click();
  await page.waitForSelector('.tile-navn[title^="Approved/blaa/Original/"]', { timeout: 15000 });
  if (!existsSync(join(lib, 'Approved', 'blaa', 'Master'))) throw new Error('Master-mappen blev ikke oprettet');
  await page.locator('.tile').first().click();
  await page.waitForSelector('button:has-text("Make master")', { timeout: 10000 });

  // En masterfil lægges i Master, og appen finder den. Vaerket forlader
  // fase 2 og staar i fase 4 (Crops).
  await billede(join(lib, 'Approved', 'blaa', 'Master', 'blaa master.png'));
  await page.locator('button', { hasText: 'Scan again' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 0, null, { timeout: 20000 });
  await page.locator('.fase', { hasText: 'Crops' }).click();
  await page.waitForSelector('.tile-navn[title*="/Master/"]', { timeout: 20000 });
  if (await page.locator('.tile-navn[title*="/Original/"]').count() !== 0) {
    throw new Error('Originalen staar i fase 4');
  }

  // Beskaer masteren til 1:1.
  await page.locator('.tile', { has: page.locator('.tile-navn[title*="/Master/"]') }).click();
  await page.locator('button', { hasText: 'Crop master …' }).click();
  await page.waitForSelector('.crop-vindue', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.crop-flade img')?.naturalWidth > 0, null, { timeout: 10000 });
  await page.locator('.crop-formater button', { hasText: '1:1' }).click();
  // Genvejene maa ikke ramme billederne bag vinduet.
  await page.keyboard.press('x');
  await page.locator('button', { hasText: 'Save crop' }).click();
  await page.waitForSelector('.tile-navn[title$="blaa master 1-1.png"]', { timeout: 20000 });

  const filer = readdirSync(join(lib, 'Approved', 'blaa', 'Master'));
  if (!filer.includes('blaa master 1-1.png') || !filer.includes('blaa master.png')) {
    throw new Error(`Master indeholder ${filer.join(', ')}`);
  }
  const m = await sharp(join(lib, 'Approved', 'blaa', 'Master', 'blaa master 1-1.png')).metadata();
  if (m.width !== m.height) throw new Error(`Beskaeringen er ikke kvadratisk: ${m.width} x ${m.height}`);
  if (await page.locator('.badge.kasseret').count() !== 0) throw new Error('X ramte et billede bag beskaeringsvinduet');

  // Beskaeringen er en etiket paa filen, ligesom Master.
  const flise = (suffiks) => page.locator('.tile', { has: page.locator(`.tile-navn[title$="${suffiks}"]`) });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.tile')].some((t) => t.querySelector('.tile-navn')?.title.endsWith('blaa master 1-1.png') && t.querySelector('.badge.beskaering')?.textContent === '1:1' && t.querySelector('.badge.kopi')?.textContent === 'Master'),
    null,
    { timeout: 10000 }
  );

  // Et klik paa et andet format omdoeber filen, og etiketten foelger med.
  await flise('blaa master 1-1.png').click();
  await page.locator('button', { hasText: /^2:3$/ }).click();
  await page.waitForSelector('.tile-navn[title$="blaa master 2-3.png"]', { timeout: 15000 });
  if (!existsSync(join(lib, 'Approved', 'blaa', 'Master', 'blaa master 2-3.png'))) throw new Error('Filen blev ikke omdoebt');

  // Omdoeber man den selv i Finder, foelger appen med efter en genscanning.
  renameSync(join(lib, 'Approved', 'blaa', 'Master', 'blaa master 2-3.png'), join(lib, 'Approved', 'blaa', 'Master', 'blaa master 3-2.png'));
  await page.locator('button', { hasText: 'Scan again' }).click();
  await page.waitForFunction(
    () => [...document.querySelectorAll('.tile')].some((t) => t.querySelector('.tile-navn')?.title.endsWith('blaa master 3-2.png') && t.querySelector('.badge.beskaering')?.textContent === '3:2'),
    null,
    { timeout: 20000 }
  );

  // Fase 5 (Print) viser beskaeringerne.
  await page.locator('.fase', { hasText: 'Print' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 1
      && document.querySelector('.tile-navn')?.title.endsWith('blaa master 3-2.png'),
    null,
    { timeout: 10000 }
  );

  // Printfilen: en PNG i vaerkets Print files, og flisen faar en Print-etiket.
  await page.locator('.tile').first().click();
  await page.locator('button', { hasText: 'Make print file' }).click();
  await page.waitForSelector('.tile .badge.print', { timeout: 20000 });
  const printfil = join(lib, 'Approved', 'blaa', 'Print files', 'blaa master 3-2.png');
  if (!existsSync(printfil)) throw new Error('Printfilen blev ikke lavet');
  const pm = await sharp(printfil).metadata();
  if (pm.format !== 'png' || pm.density !== 300) throw new Error(`Printfilen er ${pm.format} paa ${pm.density} DPI`);

  console.log('SMOKE OK: beskaering gemmer en ny fil i Master');
  succes = true;
} catch (err) {
  console.error(`SMOKE FEJL: ${err?.message || err}`);
  if (err?.stack) console.error(String(err.stack).split('\n').filter((l) => l.includes('smoke-crop.mjs')).join('\n'));
  const win = app.windows()[0];
  if (win) await win.screenshot({ path: join(projectRoot, 'smoke-crop-fejl.png') }).catch(() => {});
} finally {
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
  rmSync(lib, { recursive: true, force: true });
  process.exit(succes ? 0 : 1);
}
