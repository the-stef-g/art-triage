// Smoke test af beskaering i den byggede app: godkend et billede, laeg en
// masterfil i Master, beskaer den, og se at der kommer en ny fil i Master.
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, readdirSync, renameSync, copyFileSync, utimesSync } from 'node:fs';
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
  // Det foerste billede er markeret af sig selv og vises stort.
  await page.waitForSelector('.forstoerret', { timeout: 15000 });
  await page.keyboard.press('a');
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 0, null, { timeout: 15000 });
  await page.locator('.fase', { hasText: 'Edit' }).click();
  await page.waitForSelector('.tile-navn[title^="Approved/blaa/Original/"]', { timeout: 15000 });
  if (!existsSync(join(lib, 'Approved', 'blaa', 'Master'))) throw new Error('Master-mappen blev ikke oprettet');
  await page.locator('.tile').first().click();
  await page.waitForSelector('button:has-text("Make master")', { timeout: 10000 });

  // En masterfil lægges i Master, og appen finder den. Vaerket forlader
  // fase 2 og staar i fase 3 (Crops).
  await billede(join(lib, 'Approved', 'blaa', 'Master', 'blaa master.png'));
  await page.locator('button', { hasText: 'Scan again' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 0, null, { timeout: 20000 });
  await page.locator('.fase', { hasText: 'Crop' }).click();
  // Crop: vaerkerne i en filmstribe under beskaeringen, én pr. vaerk.
  await page.waitForSelector('.crop-strip .film-billede', { timeout: 20000 });
  if (await page.locator('.crop-strip .film-billede').count() !== 1) {
    throw new Error('Filmstriben i Crop har ikke praecis ét vaerk');
  }
  if (await page.locator('.hoved.beskaer > .inspector').isVisible()) throw new Error('Hoejre kolonne vises i Crop');

  // Beskaer masteren til 1:1. Beskaeringen staar midt i vinduet.
  await page.locator('.crop-strip .film-billede').first().click();
  await page.waitForSelector('.crop-midte .crop-inline .crop-vindue', { timeout: 10000 });
  // Metadata ved titlen og Show in Finder i hjoernet.
  await page.waitForSelector('.crop-top .crop-meta >> text=/Last edit/', { timeout: 10000 });
  await page.waitForSelector('.crop-top button:has-text("Show in Finder")', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.crop-flade img')?.naturalWidth > 0, null, { timeout: 10000 });
  // Masteren er 400 × 200, saa beskaeringen starter i 2:1.
  await page.waitForSelector('.crop-formater button.primaer:has-text("2:1")', { timeout: 10000 });
  await page.locator('.crop-formater button', { hasText: '1:1' }).click();
  // Drejet 5 grader og holdt inde i billedet: rammen bliver mindre end
  // billedets hoejde, og der kommer ingen tomme hjoerner i filen.
  // Fri drejning: traek uden for rammen, saa drejer billedet.
  const b = await page.locator('.crop-flade').boundingBox();
  await page.mouse.move(b.x + 5, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 5, b.y + b.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  const fri = Number(await page.locator('.crop-vinkel-tal').inputValue());
  if (!(Math.abs(fri) > 1)) throw new Error(`Traek uden for rammen drejede ikke billedet (${fri}°)`);
  await page.fill('.crop-vinkel-tal', '0');
  // Mens rammen traekkes, vises nettet; naar musen slippes, forsvinder det.
  const greb = await page.locator('.crop-greb.se').boundingBox();
  await page.mouse.move(greb.x + 6, greb.y + 6);
  await page.mouse.down();
  await page.mouse.move(greb.x - 20, greb.y - 20, { steps: 4 });
  await page.waitForSelector('.crop-net', { timeout: 5000 });
  await page.screenshot({ path: join(projectRoot, 'smoke-crop-net.png') });
  await page.mouse.up();
  await page.waitForSelector('.crop-net', { state: 'detached', timeout: 5000 });
  // Et klik paa formatet giver den stoerste ramme igen.
  await page.locator('.crop-formater button', { hasText: '1:1' }).click();
  const hoejdeFoer = await page.locator('.crop-ramme').evaluate((el) => el.getBoundingClientRect().height);
  await page.fill('.crop-vinkel-tal', '5');
  await page.waitForFunction(
    (h) => document.querySelector('.crop-ramme').getBoundingClientRect().height < h - 2,
    hoejdeFoer,
    { timeout: 5000 }
  );
  await page.screenshot({ path: join(projectRoot, 'smoke-crop.png') });
  // Genvejene maa ikke ramme billederne (X kasserer ikke i Crop).
  await page.keyboard.press('x');
  await page.locator('button', { hasText: 'Save crop' }).click();
  // Formatet er nu beskaaret: knappen kan ikke vaelges igen, og vaerket i
  // filmstriben har en beskaering.
  await page.waitForSelector('.crop-format.findes button:disabled:has-text("1:1")', { timeout: 20000 });
  await page.waitForSelector('.crop-strip .crop-antal:has-text("1")', { timeout: 10000 });
  // Beskaeringen staar i filmstriben lige efter masteren, med sit format.
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('.crop-strip .film-billede')];
    return b.length === 2 && b[0].classList.contains('master-film') && b[1].querySelector('.crop-antal')?.textContent === '1:1';
  }, null, { timeout: 10000 });
  // Et klik paa den viser den stort, uden formater og Save crop.
  await page.locator('.crop-strip .crop-film').first().click();
  await page.waitForSelector('.crop-visning .crop-top >> text=blaa master 1-1.png', { timeout: 10000 });
  if (await page.locator('button', { hasText: 'Save crop' }).count()) throw new Error('Save crop vises paa en beskaering');
  await page.screenshot({ path: join(projectRoot, 'smoke-crop-visning.png') });
  // Tilbage paa masteren kan der beskaeres igen.
  await page.locator('.crop-strip .master-film').first().click();
  await page.waitForSelector('button:has-text("Save crop")', { timeout: 10000 });
  // Masteren viser sine formater, og S lukker og aabner stakken.
  await page.waitForSelector('.crop-strip .master-film .stak-formater >> text=1:1', { timeout: 10000 });
  const antalFilm = () => page.locator('.crop-strip .film-billede').count();
  await page.locator('.crop-strip').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press('s');
  await page.waitForFunction(() => document.querySelectorAll('.crop-strip .film-billede').length === 1, null, { timeout: 5000 });
  await page.screenshot({ path: join(projectRoot, 'smoke-crop-stak.png') });
  await page.keyboard.press('s');
  await page.waitForFunction(() => document.querySelectorAll('.crop-strip .film-billede').length === 2, null, { timeout: 5000 });
  if (await antalFilm() !== 2) throw new Error('Stakken aabnede ikke igen');
  await page.waitForSelector('.crop-strip .stak.aaben', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.crop-flade img')?.naturalWidth > 0, null, { timeout: 10000 });

  const filer = readdirSync(join(lib, 'Approved', 'blaa', 'Master'));
  if (!filer.includes('blaa master 1-1.png') || !filer.includes('blaa master.png')) {
    throw new Error(`Master indeholder ${filer.join(', ')}`);
  }
  const m = await sharp(join(lib, 'Approved', 'blaa', 'Master', 'blaa master 1-1.png')).metadata();
  if (m.width !== m.height) throw new Error(`Beskaeringen er ikke kvadratisk: ${m.width} x ${m.height}`);
  const hjoerne = await sharp(join(lib, 'Approved', 'blaa', 'Master', 'blaa master 1-1.png'))
    .ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  if (hjoerne[3] !== 255) throw new Error(`Den drejede beskaering har et tomt hjoerne (alpha ${hjoerne[3]})`);
  if (await page.locator('.badge.kasseret').count() !== 0) throw new Error('X ramte et billede bag beskaeringsvinduet');

  // Valget er gaaet videre til et ledigt format (2:1, som ligner billedet
  // mest). Den beskaering fjernes igen med minus paa knappen.
  await page.waitForSelector('.crop-formater button.primaer:has-text("2:1")', { timeout: 10000 });
  await page.locator('button', { hasText: 'Save crop' }).click();
  await page.waitForSelector('.crop-format.findes:has-text("2:1") .crop-minus', { timeout: 20000 });
  // Minus fjerner hele kaeden: ogsaa forstoerrelsen i Edits. Foerst en
  // dialog, der viser filerne.
  mkdirSync(join(lib, 'Approved', 'blaa', 'Edits'), { recursive: true });
  const giga21 = join(lib, 'Approved', 'blaa', 'Edits', 'blaa master 2-1-giga.png');
  copyFileSync(join(lib, 'Approved', 'blaa', 'Master', 'blaa master 2-1.png'), giga21);
  await page.locator('button', { hasText: 'Scan again' }).click();
  await page.waitForTimeout(1500);
  await page.locator('.crop-format.findes:has-text("2:1") .crop-minus').click();
  await page.waitForSelector('.dialog >> text=blaa master 2-1-giga.png', { timeout: 10000 });
  await page.screenshot({ path: join(projectRoot, 'smoke-crop-slet.png') });
  await page.locator('.dialog button', { hasText: 'Move to Trash' }).click();
  await page.waitForSelector('.crop-format:not(.findes) button:has-text("2:1")', { timeout: 20000 });
  if (existsSync(join(lib, 'Approved', 'blaa', 'Master', 'blaa master 2-1.png'))) throw new Error('Minus fjernede ikke beskaeringen');
  if (existsSync(giga21)) throw new Error('Minus fjernede ikke forstoerrelsen');
  if (!existsSync(join(lib, 'Approved', 'blaa', 'Master', 'blaa master 1-1.png'))) throw new Error('Minus fjernede den forkerte beskaering');

  // Omdoeber man den selv i Finder, foelger appen med efter en genscanning.
  renameSync(join(lib, 'Approved', 'blaa', 'Master', 'blaa master 1-1.png'), join(lib, 'Approved', 'blaa', 'Master', 'blaa master 3-2.png'));
  await page.locator('button', { hasText: 'Scan again' }).click();
  await page.waitForSelector('.crop-format.findes button:has-text("3:2")', { timeout: 20000 });
  await page.waitForSelector('.crop-format:not(.findes) button:has-text("1:1")', { timeout: 20000 });
  await page.screenshot({ path: join(projectRoot, 'smoke-crop-knapper.png') });

  // Fase 4 (Print) er en liste: én linje pr. beskaering.
  await page.locator('.fase', { hasText: 'Print' }).click();
  await page.waitForFunction(
    () => {
      const l = [...document.querySelectorAll('.print-linje:not(.hoved)')];
      return l.length === 1 && l[0].querySelector('.navn')?.title.endsWith('blaa master 3-2.png');
    },
    null,
    { timeout: 10000 }
  );
  // Pixeltallet til Gigapixel kommer fra prislisten: det stoerste 3:2-print
  // er 150 × 100 cm, ved 300 DPI 17717 × 11811 px.
  await page.waitForSelector('.print-linje:not(.hoved) >> text=17717 × 11811', { timeout: 10000 });

  // Paa beskaeringen er der ingen printknap foer den er forstoerret.
  await page.locator('.print-linje:not(.hoved)').first().click();
  await page.waitForSelector('button:has-text("Enlarge in Gigapixel")', { timeout: 10000 });
  await page.waitForSelector('.gigapixel-maal >> text=17717 px', { timeout: 10000 });
  // Filstoerrelsen staar i listen, og formatknappen vaelger alle i formatet.
  await page.waitForSelector('.print-linje:not(.hoved) .stoerrelse', { timeout: 10000 });
  await page.locator('.format-valg button', { hasText: '3:2' }).click();
  await page.waitForSelector('.print-linje.valgt', { timeout: 5000 });
  if (!(await page.locator('.format-valg button', { hasText: '1:1' }).isDisabled())) throw new Error('1:1 er ikke graa uden 1:1-beskaeringer');
  if (await page.locator('button', { hasText: 'Make print file' }).count()) {
    throw new Error('Beskaeringen har en printknap foer den er forstoerret');
  }

  // "Forstoerrelsen" er en -giga-fil i Edits, dobbelt saa stor. Filen er
  // kvadratisk (den blev beskaaret 1:1 og saa omdoebt), og en printfil skal
  // vaere praecis i sit format: appen proever selv og siger nej.
  const edits = join(lib, 'Approved', 'blaa', 'Edits');
  mkdirSync(edits, { recursive: true });
  const kilde = join(lib, 'Approved', 'blaa', 'Master', 'blaa master 3-2.png');
  const km = await sharp(kilde).metadata();
  await sharp(kilde).resize(km.width * 2, km.height * 2).png().toFile(join(edits, 'blaa master 3-2-giga.png'));
  const foer = new Date(Date.now() - 10_000);
  utimesSync(join(edits, 'blaa master 3-2-giga.png'), foer, foer);
  await page.locator('button', { hasText: 'Scan again' }).click();
  await page.waitForSelector('text=/is not 3:2/', { timeout: 30000 });
  if (await page.locator('.print-linje:not(.hoved)').count() !== 1) throw new Error('-giga-filen staar paa sin egen linje');
  if (existsSync(join(lib, 'Approved', 'blaa', 'Print files', 'blaa master 3-2.jpg'))) {
    throw new Error('Der blev lavet en printfil i et forkert format');
  }

  // Med det rigtige format i navnet laver appen selv printfilen.
  renameSync(kilde, join(lib, 'Approved', 'blaa', 'Master', 'blaa master 1-1.png'));
  renameSync(join(edits, 'blaa master 3-2-giga.png'), join(edits, 'blaa master 1-1-giga.png'));
  await page.locator('button', { hasText: 'Scan again' }).click();
  const printfil = join(lib, 'Approved', 'blaa', 'Print files', 'blaa master 1-1.jpg');
  const t0 = Date.now() + 30_000;
  while (!existsSync(printfil) && Date.now() < t0) await page.waitForTimeout(250);
  if (!existsSync(printfil)) throw new Error('Printfilen blev ikke lavet');
  const pm = await sharp(printfil).metadata();
  if (pm.format !== 'jpeg' || pm.density !== 300) throw new Error(`Printfilen er ${pm.format} paa ${pm.density} DPI`);
  await page.waitForSelector('.print-linje:not(.hoved) >> text=✓ blaa master 1-1.jpg', { timeout: 20000 });
  // Og den kan laves igen i haanden fra beskaeringens linje.
  await page.locator('.print-linje:not(.hoved)').first().click();
  await page.locator('button', { hasText: 'Make print file again' }).click();
  await page.waitForSelector('text=/Print file saved as/', { timeout: 20000 });
  await page.screenshot({ path: join(projectRoot, 'smoke-print.png') });

  // Gemmer Gigapixel en stoerre fil oven i -giga-filen, laver appen selv
  // printfilen, naar filen har ligget stille et ojeblik.
  rmSync(printfil);
  const giga = join(edits, 'blaa master 1-1-giga.png');
  const gm = await sharp(giga).metadata();
  await sharp(giga).resize(gm.width * 2, gm.height * 2).png().toFile(`${giga}.tmp`);
  renameSync(`${giga}.tmp`, giga);
  const lidtSiden = new Date(Date.now() - 10_000);
  utimesSync(giga, lidtSiden, lidtSiden);
  await page.locator('button', { hasText: 'Scan again' }).click();
  const slut = Date.now() + 30_000;
  while (!existsSync(printfil) && Date.now() < slut) await page.waitForTimeout(250);
  if (!existsSync(printfil)) throw new Error('Printfilen blev ikke lavet automatisk');
  const am = await sharp(printfil).metadata();
  if (am.width !== gm.width * 2) throw new Error(`Den automatiske printfil er ${am.width} px bred`);

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
