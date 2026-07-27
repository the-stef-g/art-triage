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

  // Vaelg foerste billede og godkend med A. Genvejene foelger de engelske
  // ord paa knapperne: A approve, C candidate, E editing, F finished.
  await page.locator('.tile').first().click();
  await page.keyboard.press('a');
  await page.waitForSelector('.badge.godkendt', { timeout: 10000 });

  // Kandidat med C paa naeste billede: eget badge, egen markering paa
  // flisen, og arbejdslisten i sidepanelet skal taelle med.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('c');
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

  // Tabulator maa ikke flytte fokus rundt mellem knapperne: arbejdet
  // foregaar med mus og bogstavgenveje, og et vandrende fokus gjorde det
  // uklart hvad en tast rammer.
  // Der sammenlignes paa selve elementet, ikke paa dets klasse: de fleste
  // knapper i appen har ingen klasse, saa to forskellige knapper ligner
  // hinanden fuldstaendig paa tekst, og tjekket ville bestaa af sig selv.
  await page.evaluate(() => { window.__foerFokus = document.activeElement; });
  await page.keyboard.press('Tab');
  const flyttet = await page.evaluate(() => {
    const nu = document.activeElement;
    return nu === window.__foerFokus ? null : `${nu?.tagName}:${nu?.textContent?.slice(0, 30)}`;
  });
  if (flyttet) throw new Error(`Tabulator flyttede fokus til ${flyttet}`);

  // Arbejdstrin er ét ad gangen. E saetter "being edited", F skifter til
  // "finished", og saa maa den foerste knap ikke stadig staa taendt: det
  // var praecis fejlen, hvor der stod baade det ene og det andet.
  await page.keyboard.press('e');
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

  // Forstoerrelsen skal blive inden for midterfeltet, saa sidepanel og
  // inspektoer bliver staaende. Var den bundet til vinduet igen, ville
  // den daekke begge kolonner.
  await page.keyboard.press(' ');
  await page.waitForSelector('.forstoerret', { timeout: 10000 });
  const daekker = await page.evaluate(() => {
    const stor = document.querySelector('.forstoerret').getBoundingClientRect();
    const side = document.querySelector('.sidebar').getBoundingClientRect();
    const insp = document.querySelector('.inspector').getBoundingClientRect();
    return stor.left < side.right - 1 || stor.right > insp.left + 1;
  });
  if (daekker) throw new Error('Forstoerrelsen daekker sidepanelet eller inspektoeren');
  await page.keyboard.press(' ');
  await page.waitForSelector('.forstoerret', { state: 'detached', timeout: 10000 });

  // Piletast-navigation gaar i ring. Der er fire billeder, saa fire tryk
  // paa hoejre pil fra det foerste skal lande paa det foerste igen.
  await page.locator('.tile').first().click();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
  const iRing = await page.evaluate(() => {
    const fliser = [...document.querySelectorAll('.tile')];
    return fliser.findIndex((t) => t.classList.contains('valgt')) === 0;
  });
  if (!iRing) throw new Error('Piletasterne gik ikke i ring til det foerste billede');

  // Skift+pil udvider markeringen, og det aktive billede foelger med ud
  // til den ende man udvider mod.
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForFunction(
    () => document.querySelectorAll('.tile.valgt').length === 3
      && document.querySelectorAll('.tile.aktiv').length === 1,
    null,
    { timeout: 10000 }
  );
  const aktivEfterUdvidelse = await page.evaluate(() => {
    const fliser = [...document.querySelectorAll('.tile')];
    return fliser.findIndex((t) => t.classList.contains('aktiv'));
  });
  if (aktivEfterUdvidelse !== 2) {
    throw new Error(`Det aktive billede fulgte ikke med udvidelsen (stod paa ${aktivEfterUdvidelse})`);
  }

  // Pil uden Skift maa ikke forlade multi-select. Den flytter det aktive
  // billede rundt inde i markeringen og gaar i ring dér.
  await page.keyboard.press('ArrowRight');
  const efterPil = await page.evaluate(() => {
    const fliser = [...document.querySelectorAll('.tile')];
    return {
      valgte: fliser.filter((t) => t.classList.contains('valgt')).length,
      aktiv: fliser.findIndex((t) => t.classList.contains('aktiv')),
    };
  });
  if (efterPil.valgte !== 3) {
    throw new Error(`Hoejre pil forlod multi-select (${efterPil.valgte} markerede tilbage)`);
  }
  if (efterPil.aktiv !== 0) {
    throw new Error(`Det aktive billede gik ikke i ring inde i markeringen (stod paa ${efterPil.aktiv})`);
  }

  // Escape forlader multi-select og beholder det aktive billede.
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.querySelectorAll('.tile.valgt').length === 1,
    null,
    { timeout: 10000 }
  );
  const beholdtAktiv = await page.evaluate(() => {
    const fliser = [...document.querySelectorAll('.tile')];
    return fliser.findIndex((t) => t.classList.contains('aktiv'));
  });
  if (beholdtAktiv !== 0) {
    throw new Error(`Escape beholdt ikke det aktive billede (stod paa ${beholdtAktiv})`);
  }

  // Escape maa ikke rydde markeringen mens forstoerrelsen er aaben: saa
  // ville man miste den hver gang man lukkede et stort billede.
  await page.keyboard.press(' ');
  await page.waitForSelector('.forstoerret', { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.forstoerret', { state: 'detached', timeout: 10000 });
  const beholdt = await page.locator('.tile.valgt').count();
  if (beholdt !== 1) throw new Error(`Escape ryddede markeringen sammen med forstoerrelsen (${beholdt})`);

  // Handlingsknapperne i vaerktoejslinjen goer det samme som tasterne.
  await page.locator('.handling', { hasText: 'candidate' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tile.kandidat').length === 2,
    null,
    { timeout: 10000 }
  );
  await page.locator('.handling', { hasText: 'unrated' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tile.kandidat').length === 1,
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

  // Filter-chips i vaerktoejslinjen er visninger, ikke afkrydsninger:
  // der er én aktiv ad gangen. Stod to taendt, skar de hinanden bort, og
  // grid'et kunne blive tomt uden at det var til at se hvorfor. Discarded
  // er med i raekken paa lige fod med de andre.
  await page.locator('.chip', { hasText: 'Approved' }).click();
  await page.locator('.chip', { hasText: 'Discarded' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.filtre .chip.aktiv').length === 1,
    null,
    { timeout: 10000 }
  );
  // Discarded skal vise de kasserede, ikke ingenting: visningen slaar
  // ogsaa synligheden til, som ellers er slukket som standard.
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 1,
    null,
    { timeout: 10000 }
  );
  await page.locator('.chip', { hasText: 'Discarded' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.filtre .chip.aktiv').length === 0,
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
