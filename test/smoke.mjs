// Smoke test: starter den byggede app i Electron (kraever `npm run build`
// foerst), aabner et testbibliotek og gennemgaar kerneflowet i UI'et.
// Koeres i CI under Xvfb: `xvfb-run npm run smoke`.
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Haard deadline: uanset hvad der haenger, doer processen her.
setTimeout(() => {
  console.error('SMOKE FEJL: haard timeout efter 5 minutter');
  process.exit(1);
}, 300000);

async function lavTestbilleder(dir) {
  const sharp = (await import('sharp')).default;
  const farver = [
    { navn: 'gul.png', rgb: { r: 240, g: 200, b: 40 } },
    { navn: 'blaa.png', rgb: { r: 40, g: 90, b: 220 } },
    { navn: 'roed.png', rgb: { r: 210, g: 50, b: 40 } },
  ];
  mkdirSync(join(dir, 'undermappe'), { recursive: true });
  for (const { navn, rgb } of farver) {
    await sharp({ create: { width: 96, height: 64, channels: 3, background: rgb } })
      .png()
      .toFile(join(dir, navn));
  }
  await sharp({ create: { width: 64, height: 96, channels: 3, background: { r: 80, g: 160, b: 80 } } })
    .png()
    .toFile(join(dir, 'undermappe', 'groen.png'));
}

const lib = mkdtempSync(join(tmpdir(), 'art-triage-smoke-'));
await lavTestbilleder(lib);

const app = await electron.launch({
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

// Vis appens egen output i CI-loggen, saa fejl kan diagnosticeres.
const proc = app.process();
proc.stdout?.on('data', (d) => process.stdout.write(`[app] ${d}`));
proc.stderr?.on('data', (d) => process.stderr.write(`[app] ${d}`));

let succes = false;
try {
  const page = await app.firstWindow({ timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');

  // Hovedvinduet oprettes med show: false og vises foerst paa ready-to-show.
  // Playwright faar fat i vinduet inden da, og et skjult Chromium-vindue
  // lader vaere med at lave layout: elementerne staar i DOM'en, men uden
  // stoerrelse. Uden den her ventetid bliver alt nedenfor et lotteri, hvor
  // testen falder paa "fandt elementet, men det blev aldrig synligt".
  await page.waitForFunction(
    () => document.visibilityState === 'visible',
    null,
    { timeout: 60000 }
  );

  // Grid med 4 billeder (3 i roden + 1 i undermappe, traeet viser alle).
  // Der maales paa selve kassen i stedet for Playwrights synlighedstjek,
  // saa ventetiden slutter praecis naar fliserne er lagt ud.
  await page.waitForFunction(
    () => {
      const foerste = document.querySelector('.tile');
      if (!foerste) return false;
      const kasse = foerste.getBoundingClientRect();
      return kasse.width > 0 && kasse.height > 0;
    },
    null,
    { timeout: 45000 }
  );
  const tiles = await page.locator('.tile').count();
  if (tiles !== 4) throw new Error(`ventede 4 billeder i grid, fik ${tiles}`);

  // Vaelg foerste billede og godkend med G.
  await page.locator('.tile').first().click();
  await page.keyboard.press('g');
  await page.waitForSelector('.badge.godkendt', { timeout: 10000 });

  // Kandidat med K paa naeste billede: eget badge, egen markering paa
  // flisen, og arbejdslisten i sidepanelet skal taelle med.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('k');
  await page.waitForSelector('.badge.kandidat', { timeout: 10000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.tile.kandidat').length === 1,
    null,
    { timeout: 10000 }
  );
  await page.waitForFunction(
    () => document.querySelector('.kandidatliste .antal')?.textContent.trim() === '1',
    null,
    { timeout: 10000 }
  );
  // Sidepanelet er navigation: et klik et nyt sted skal foere derhen, uden
  // at man foerst skal klikke sig ud af den forrige visning.
  await page.locator('.kandidatliste').click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 1,
    null,
    { timeout: 10000 }
  );
  await page.locator('.mappe', { hasText: 'All images' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 4,
    null,
    { timeout: 10000 }
  );

  // Cloud-noegleordene har deres eget panel over ordene. Uden API-noegle
  // skal det sige hvor noeglen saettes, ikke bare vaere tomt. Kanalen
  // 'kw:status' skal ogsaa staa paa preloadens liste; gjorde den ikke det,
  // fejlede hele metadata-hentningen i tavshed.
  await page.waitForSelector('.kw-koe', { timeout: 10000 });
  const koeTekst = await page.locator('.kw-koe').innerText();
  if (!/API key/i.test(koeTekst)) {
    throw new Error(`Noegleordspanelet siger ikke hvor noeglen saettes: ${koeTekst}`);
  }

  // Tilbage til foerste billede, saa resten af flowet staar som foer.
  await page.locator('.tile').first().click();

  // Arbejdstrin er ét ad gangen. R saetter "being edited", F skifter til
  // "finished", og saa maa den foerste knap ikke stadig staa taendt: det
  // var praecis fejlen, hvor der stod baade det ene og det andet.
  await page.keyboard.press('r');
  await page.waitForSelector('.aktiv-redigeres', { timeout: 10000 });
  await page.keyboard.press('f');
  await page.waitForFunction(
    () => document.querySelectorAll('.aktiv-faerdig').length === 1
      && document.querySelectorAll('.aktiv-redigeres').length === 0,
    null,
    { timeout: 10000 }
  );
  // Samme genvej igen rydder trinnet.
  await page.keyboard.press('f');
  await page.waitForFunction(
    () => document.querySelectorAll('.aktiv-faerdig').length === 0,
    null,
    { timeout: 10000 }
  );

  // Ny virtuel kopi med V: en ekstra flise dukker op.
  await page.keyboard.press('v');
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 5,
    null,
    { timeout: 10000 }
  );

  // Kassér den valgte version med X: skjules som standard, og det
  // naeste foto skal automatisk vaere markeret.
  await page.locator('.tile').first().click();
  await page.keyboard.press('x');
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 4
      && document.querySelectorAll('.tile.valgt').length === 1,
    null,
    { timeout: 10000 }
  );

  // Mappefilter: klik paa undermappen i traeet.
  await page.locator('.mappe', { hasText: 'undermappe' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 1,
    null,
    { timeout: 10000 }
  );

  await page.screenshot({ path: join(projectRoot, 'smoke-grid.png') });
  console.log('SMOKE OK: grid, godkend, kandidat, virtuel kopi, kassér og mappefilter virker');
  succes = true;
} catch (err) {
  console.error(`SMOKE FEJL: ${err?.message || err}`);
  const win = app.windows()[0];
  if (win) {
    await win.screenshot({ path: join(projectRoot, 'smoke-fejl.png') }).catch(() => {});
  }
} finally {
  await Promise.race([
    app.close().catch(() => {}),
    new Promise((r) => setTimeout(r, 10000)),
  ]);
  rmSync(lib, { recursive: true, force: true });
  process.exit(succes ? 0 : 1);
}
