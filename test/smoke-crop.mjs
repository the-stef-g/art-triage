// Smoke test af beskaering i den byggede app: godkend et billede, laeg en
// masterfil i Masters, beskaer den, og se at der kommer en ny fil i Masters.
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
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
  await page.waitForSelector('.tile', { timeout: 60000 });

  // Godkend: filen flytter ind i en arbejdsmappe.
  await page.locator('.tile').first().click();
  await page.keyboard.press('a');
  await page.waitForSelector('.tile-navn[title^="Approved/blaa/Originals/"]', { timeout: 15000 });
  if (!existsSync(join(lib, 'Approved', 'blaa', 'Masters'))) throw new Error('Masters-mappen blev ikke oprettet');

  // Originalen kan ikke beskaeres, kun filer i Masters.
  await page.locator('.tile').first().click();
  await page.waitForSelector('text=Only finished works can be cropped', { timeout: 10000 });

  // En masterfil lægges i Masters, og appen finder den.
  await billede(join(lib, 'Approved', 'blaa', 'Masters', 'blaa master.png'));
  await page.locator('button', { hasText: 'Scan again' }).click();
  await page.waitForSelector('.tile-navn[title*="/Masters/"]', { timeout: 20000 });

  // Beskaer masteren til 1:1.
  await page.locator('.tile', { has: page.locator('.tile-navn[title*="/Masters/"]') }).click();
  await page.locator('button', { hasText: 'Crop …' }).click();
  await page.waitForSelector('.crop-vindue', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.crop-flade img')?.naturalWidth > 0, null, { timeout: 10000 });
  await page.locator('.crop-formater button', { hasText: '1:1' }).click();
  // Genvejene maa ikke ramme billederne bag vinduet.
  await page.keyboard.press('x');
  await page.locator('button', { hasText: 'Save crop' }).click();
  await page.waitForSelector('.tile-navn[title$="blaa master 1-1.png"]', { timeout: 20000 });

  const filer = readdirSync(join(lib, 'Approved', 'blaa', 'Masters'));
  if (!filer.includes('blaa master 1-1.png') || !filer.includes('blaa master.png')) {
    throw new Error(`Masters indeholder ${filer.join(', ')}`);
  }
  const m = await sharp(join(lib, 'Approved', 'blaa', 'Masters', 'blaa master 1-1.png')).metadata();
  if (m.width !== m.height) throw new Error(`Beskaeringen er ikke kvadratisk: ${m.width} x ${m.height}`);
  if (await page.locator('.badge.kasseret').count() !== 0) throw new Error('X ramte et billede bag beskaeringsvinduet');

  console.log('SMOKE OK: beskaering gemmer en ny fil i Masters');
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
