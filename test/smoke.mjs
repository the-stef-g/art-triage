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
    .toFile(join(dir, 'undermappe', 'zgroen.png'));
}

const lib = mkdtempSync(join(tmpdir(), 'art-triage-smoke-'));
await lavTestbilleder(lib);

const app = await electron.launch({
  // ELECTRON_PATH: en anden Electron-binaer, fx en udpakket fra electron-builder.
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

  // Fasen huskes fra sidste koersel, saa testen starter selv i fase 1.
  await page.locator('.fase', { hasText: 'Sort' }).click({ timeout: 60000 });

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

  // Filmstrimlen nederst viser mappens billeder i skudraekkefoelge: de tre
  // i roden, ikke den i undermappen.
  await page.locator('.tile').first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('.filmstrip .film-billede').length === 3
      && document.querySelectorAll('.filmstrip .film-billede.aktiv').length === 1,
    null,
    { timeout: 10000 }
  );
  // Den bliver staaende under den store visning.
  await page.keyboard.press(' ');
  await page.waitForSelector('.forstoerret', { timeout: 10000 });
  const stripSynlig = await page.evaluate(() => {
    const stor = document.querySelector('.forstoerret').getBoundingClientRect();
    const strip = document.querySelector('.filmstrip')?.getBoundingClientRect();
    return Boolean(strip) && strip.height > 0 && strip.top >= stor.bottom - 1;
  });
  if (!stripSynlig) throw new Error('Filmstrimlen forsvandt bag den store visning');
  await page.keyboard.press(' ');
  await page.waitForSelector('.forstoerret', { state: 'detached', timeout: 10000 });

  // Vaelg foerste billede og godkend med A. Genvejene foelger de engelske
  // ord paa knapperne: A approve, C candidate, X discard, U unrated.
  // Et godkendt billede gaar videre til fase 2 og forlader fase 1, og det
  // naeste billede bliver markeret.
  await page.locator('.tile').first().click();
  await page.keyboard.press('a');
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 3
      && document.querySelectorAll('.tile.valgt').length === 1,
    null,
    { timeout: 10000 }
  );
  const editTal = await page.locator('.fase', { hasText: 'Edit' }).locator('.antal').innerText();
  if (editTal.trim() !== '1') throw new Error(`Fase 2 taeller ${editTal} og ikke 1`);

  // Kandidat med C: eget badge og egen markering paa flisen.
  await page.locator('.tile').first().click();
  await page.keyboard.press('c');
  await page.waitForSelector('.badge.kandidat', { timeout: 10000 });
  // Bedoemmelserne er et trafiklys, saa kandidat er et spoergsmaalstegn
  // og ikke et K fra det danske "kandidat".
  const kandidatTegn = await page.locator('.badge.kandidat').first().innerText();
  if (kandidatTegn.trim() !== '?') {
    throw new Error(`Kandidat-badgen viser "${kandidatTegn}" og ikke "?"`);
  }
  await page.waitForFunction(
    () => document.querySelectorAll('.tile.kandidat').length === 1,
    null,
    { timeout: 10000 }
  );
  // Mappetallene staar i trafiklysets farver. Paa dette tidspunkt er ét
  // billede godkendt og ét kandidat, saa begge tal skal staa der, og
  // resten skal vaere ubedoemt.
  const mappetal = await page.evaluate(() => {
    const rod = document.querySelector('.mappe');
    const tag = (k) => rod.querySelector(k)?.textContent?.trim() ?? null;
    return {
      godkendt: tag('.tal-godkendt'),
      kandidat: tag('.tal-kandidat'),
      ubedomt: tag('.tal-ubedomt'),
      kasseret: tag('.tal-kasseret'),
    };
  });
  if (mappetal.godkendt !== '1' || mappetal.kandidat !== '1' || mappetal.ubedomt !== '2') {
    throw new Error(`Mappetallene passer ikke: ${JSON.stringify(mappetal)}`);
  }
  if (mappetal.kasseret !== null) {
    throw new Error('Et nul blev vist i mappetallene i stedet for at blive udeladt');
  }

  // Kandidatlisten er Candidates-chippen i vaerktoejslinjen. Den stod
  // ogsaa som sin egen sektion i sidepanelet, men to veje til den samme
  // visning er én for meget.
  await page.locator('.chip', { hasText: 'Candidates' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 1,
    null,
    { timeout: 10000 }
  );
  await page.locator('.chip', { hasText: 'Candidates' }).click();

  // Sidepanelet er navigation: et klik et nyt sted skal foere derhen, uden
  // at man foerst skal klikke sig ud af den forrige visning.
  await page.locator('.mappe', { hasText: 'All images' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 3,
    null,
    { timeout: 10000 }
  );

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

  await page.locator('.tile').nth(2).click();

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

  // Skyderen i bundlinjen styrer hvor mange billeder der staar i bredden,
  // og fliserne skal fylde hele midterfeltet. Foer var flisebredden fast,
  // saa de kolonner der ikke gik op blev til en stribe bar baggrund langs
  // hoejre kant.
  for (const antal of [3, 7]) {
    await page.locator('.kolonnevalg input').fill(String(antal));
    await page.waitForFunction(
      (n) => document.querySelector('.kolonnevalg .antal')?.textContent.trim() === String(n),
      antal,
      { timeout: 10000 }
    );
    const maal = await page.evaluate(() => {
      const omraade = document.querySelector('.grid-omraade').getBoundingClientRect();
      const celler = [...document.querySelectorAll('.celle')].map((c) => c.getBoundingClientRect());
      const foerste = celler[0];
      const iFoersteRaekke = celler.filter((c) => Math.abs(c.top - foerste.top) < 2);
      const hoejst = Math.max(...iFoersteRaekke.map((c) => c.right));
      return { rest: omraade.right - hoejst, iRaekken: iFoersteRaekke.length };
    });
    // Der er tre billeder, saa ved syv kolonner fyldes raekken ikke, og
    // der maales kun paa bredden ved tre.
    if (antal === 3 && maal.iRaekken !== 3) {
      throw new Error(`Skyderen gav ${maal.iRaekken} billeder i bredden og ikke ${antal}`);
    }
    if (antal === 3 && maal.rest > 20) {
      throw new Error(`Der stod ${Math.round(maal.rest)} px bar baggrund til hoejre for fliserne`);
    }
  }
  await page.locator('.kolonnevalg input').fill('4');

  // Piletast-navigation gaar i ring. Der er tre billeder, saa tre tryk
  // paa hoejre pil fra det foerste skal lande paa det foerste igen.
  await page.locator('.tile').first().click();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
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

  // Videre til det andet billede, som ikke er bedoemt endnu.
  await page.keyboard.press('ArrowRight');

  // Bedoemmelse rammer kun det aktive billede, ikke hele markeringen.
  // Ellers kunne et enkelt tastetryk aendre tyve billeder man ikke havde
  // set paa, og en markering kunne ikke gennemgaas billede for billede.
  const kandidaterFoer = await page.locator('.tile.kandidat').count();
  await page.keyboard.press('c');
  await page.waitForFunction(
    (foer) => document.querySelectorAll('.tile.kandidat').length === foer + 1,
    kandidaterFoer,
    { timeout: 10000 }
  );
  const stadigValgt = await page.locator('.tile.valgt').count();
  if (stadigValgt !== 3) {
    throw new Error(`Bedoemmelsen aendrede markeringen (${stadigValgt} tilbage)`);
  }
  // Ryd igen, saa resten af flowet staar som foer.
  await page.keyboard.press('u');
  await page.waitForFunction(
    (foer) => document.querySelectorAll('.tile.kandidat').length === foer,
    kandidaterFoer,
    { timeout: 10000 }
  );

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
  if (beholdtAktiv !== 1) {
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

  // Kassér med X: skjules som standard, og det naeste foto skal
  // automatisk vaere markeret.
  await page.locator('.tile').first().click();
  await page.keyboard.press('x');
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 2
      && document.querySelectorAll('.tile.valgt').length === 1,
    null,
    { timeout: 10000 }
  );

  // Filter-chips i vaerktoejslinjen er visninger, ikke afkrydsninger:
  // der er én aktiv ad gangen.
  await page.locator('.chip', { hasText: 'Candidates' }).click();
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

  // Fase 2: det godkendte billede. Make master laver en kopi i Master, og
  // vaerket gaar videre til fase 3 og 5.
  await page.keyboard.press('Control+2');
  await page.waitForFunction(
    () => document.querySelector('.fase.aktiv')?.textContent.includes('Edit')
      && document.querySelectorAll('.tile').length === 1,
    null,
    { timeout: 10000 }
  );
  // Sidepanelet viser vaerkernes mapper i fase 2, og ikke Import.
  // Traeet hentes for sig, saa der ventes paa det.
  const mapperOk = await page.waitForFunction(
    () => {
      const m = [...document.querySelectorAll('.mappe .mappenavn')].map((e) => e.textContent.trim());
      return m[0] === 'All works' && m.includes('blaa') && !m.some((x) => /undermappe|Candidate/.test(x));
    },
    null,
    { timeout: 10000 }
  ).then(() => true, () => false);
  if (!mapperOk) {
    const mapper = await page.locator('.mappe .mappenavn').allInnerTexts();
    throw new Error(`Mapperne i fase 2: ${mapper.join(', ')}`);
  }
  await page.locator('.tile').first().click();
  await page.locator('button', { hasText: 'Make master' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 0, null, { timeout: 15000 });
  await page.locator('.fase', { hasText: 'Product' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tile').length === 1
      && document.querySelector('.tile-navn')?.title.includes('/Master/'),
    null,
    { timeout: 10000 }
  );
  // Fase 5 har serier og noegleord i sidepanelet. Uden API-noegle skal
  // noegleordspanelet sige hvor noeglen saettes, ikke bare vaere tomt.
  await page.waitForSelector('.kw-koe', { timeout: 10000 });
  const koeTekst = await page.locator('.kw-koe').innerText();
  if (!/API key/i.test(koeTekst)) {
    throw new Error(`Noegleordspanelet siger ikke hvor noeglen saettes: ${koeTekst}`);
  }
  // Product: formularen i midten, og shoppen med tjeklisten til hoejre.
  await page.locator('.tile').first().click();
  await page.waitForSelector('.produkt-hoejre .tjekliste', { timeout: 10000 });
  await page.waitForSelector('.produkt-hoejre button:has-text("Send to shop")', { timeout: 10000 });
  if (await page.locator('.hoved.produkt > .inspector:not(.produkt-hoejre) button:has-text("Send to shop")').count()) {
    throw new Error('Send to shop staar stadig i formularen');
  }
  await page.screenshot({ path: join(projectRoot, 'smoke-product.png') });
  await page.locator('.fase', { hasText: 'Sort' }).click();

  // Cmd+6 gaar til 6 Shop, ogsaa fra et tekstfelt, og Cmd+1 tilbage.
  await page.locator('input[type="search"], .soeg input, input').first().focus();
  await page.keyboard.press('Control+6');
  await page.waitForSelector('.fase.aktiv:has-text("Shop")', { timeout: 5000 });
  await page.keyboard.press('Control+1');
  await page.waitForSelector('.fase.aktiv:has-text("Sort")', { timeout: 5000 });

  await page.screenshot({ path: join(projectRoot, 'smoke-grid.png') });
  console.log('SMOKE OK: faser, godkend, kandidat, filmstrimmel, kassér, mappefilter og master virker');
  succes = true;
} catch (err) {
  console.error(`SMOKE FEJL: ${err?.message || err}`);
  if (err?.stack) console.error(String(err.stack).split('\n').filter((l) => l.includes('smoke.mjs')).join('\n'));
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
