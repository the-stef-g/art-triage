// Maaler det der gaar langsommere jo flere billeder kataloget har. Bygger
// et syntetisk bibliotek (standard 15.000 smaa filer i 150 mapper) og tager
// tid paa hver af de ting hovedprocessen goer: genscanning, forespoergsler,
// det der sendes til brugerfladen, og at gemme databasen.
//
//   node scripts/bench.mjs [antal] [--sqljs]
//
// Tallene er fra en hurtig lokal disk. Paa et eksternt drev er scanningen
// langsommere, men rangordenen mellem de enkelte led er den samme.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';

const antal = Number(process.argv.find((a) => /^\d+$/.test(a))) || 15000;
const sqljs = process.argv.includes('--sqljs');
const json = process.argv.includes('--json');

const root = mkdtempSync(join(tmpdir(), 'at-bench-'));
const resultat = {};

function maal(navn, fn, gange = 5) {
  const tider = [];
  let sidste;
  for (let i = 0; i < gange; i++) {
    const t = process.hrtime.bigint();
    sidste = fn();
    tider.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  tider.sort((a, b) => a - b);
  const median = tider[Math.floor(tider.length / 2)];
  resultat[navn] = Math.round(median * 10) / 10;
  if (!json) console.log(`${navn.padEnd(52)} ${median.toFixed(1).padStart(9)} ms`);
  return sidste;
}

async function maalAsync(navn, fn) {
  const t = process.hrtime.bigint();
  const r = await fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  resultat[navn] = Math.round(ms * 10) / 10;
  if (!json) console.log(`${navn.padEnd(52)} ${ms.toFixed(1).padStart(9)} ms`);
  return r;
}

// ---- Bibliotek ----
const mapper = 150;
for (let m = 0; m < mapper; m++) {
  const d = join(root, `mappe-${String(m).padStart(3, '0')}`);
  mkdirSync(d, { recursive: true });
  const pr = Math.ceil(antal / mapper);
  for (let i = 0; i < pr && m * pr + i < antal; i++) {
    writeFileSync(join(d, `Billede ${m * pr + i + 1}.jpg`), `fil ${m}-${i} `.repeat(8));
  }
}

const db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'), { engine: sqljs ? 'sqljs' : null });
const catalog = new Catalog(db, root);
if (!json) console.log(`${antal} filer, motor: ${db.engine}\n`);
resultat.motor = db.engine;

await maalAsync('foerste skanning (alle filer er nye)', async () => catalog.sync());
maal('genskanning, intet aendret (hver 90. sekund)', () => catalog.sync(), 3);

// Vurderinger, noegleord, serie: noget af hvert, som i et rigtigt bibliotek.
const rows0 = catalog.listVersions({});
const ord = Array.from({ length: 800 }, (_, i) => `ord${i}`);
db.transaction(() => {
  rows0.forEach((r, i) => {
    if (i % 3 === 0) catalog.db.run("UPDATE versions SET rating='godkendt' WHERE id=?", r.version_id);
    for (let k = 0; k < 6; k++) {
      catalog.db.run(
        'INSERT INTO keywords(file_id, word, score, manual) VALUES(?,?,?,0) ON CONFLICT(file_id, word) DO NOTHING',
        r.file_id, ord[(i * 7 + k * 131) % ord.length], 900 - k
      );
    }
  });
});
db.flush();

// En import: 500 nye billeder oven i det eksisterende bibliotek.
{
  const d = join(root, 'import');
  mkdirSync(d, { recursive: true });
  for (let i = 0; i < 500; i++) writeFileSync(join(d, `Ny ${i}.jpg`), `ny ${i} `.repeat(8));
  await maalAsync('skanning med 500 nye filer i et stort bibliotek', async () => catalog.sync());
}

if (!json) console.log('\n-- Forespoergsler (hver gang kataloget melder en aendring) --');
const liste = maal('img:list  listVersions (alle billeder)', () => catalog.listVersions({}));
maal('img:list  listVersions, filter paa mappe', () => catalog.listVersions({ folder: 'mappe-042' }));
maal('img:list  listVersions, noegleord', () => catalog.listVersions({ keyword: 'ord5' }));
maal('img:list  counts()', () => catalog.counts());
maal('fold:tree', () => catalog.folderTree());
maal('kw:top    topKeywords()', () => catalog.topKeywords());
maal('kw:status keywordQueueSize()', () => catalog.keywordQueueSize());
maal('ser:list', () => catalog.listSeries());
maal('indekseringen: filesNeedingEmbedding() (ét kald)', () => catalog.filesNeedingEmbedding('m'));

if (!json) console.log('\n-- Til brugerfladen --');
maal('serialisering til IPC: structuredClone(rows)', () => structuredClone(liste));
const bytes = Buffer.byteLength(JSON.stringify(liste));
resultat.ipcBytes = bytes;
if (!json) console.log(`${'stoerrelse paa img:list-svaret'.padEnd(52)} ${(bytes / 1e6).toFixed(1).padStart(9)} MB`);

if (!json) console.log('\n-- At gemme --');
let n = 0;
maal('én vurdering: setRating (inkl. emit)', () => {
  catalog.setRating([liste[n++ % liste.length].version_id], 'godkendt');
}, 20);
maal('db.flush() efter en aendring', () => {
  catalog.db.run("UPDATE versions SET rating='godkendt' WHERE id=?", liste[0].version_id);
  db.flush();
}, 5);

if (!json) console.log('\n-- Indekseringsloekken: 200 filer --');
maal('200 x hele ventelisten + saveEmbedding (foer)', () => {
  for (let i = 0; i < 200; i++) {
    const pending = catalog.filesNeedingEmbedding('m');
    catalog.saveEmbedding(pending[0].id, 'm', new Float32Array(0));
  }
}, 1);
maal('200 filer i bunker a 50 (efter)', () => {
  for (let i = 0; i < 4; i++) {
    for (const f of catalog.filesNeedingEmbedding('m', 50)) {
      catalog.saveEmbedding(f.id, 'm', new Float32Array(0));
    }
  }
}, 1);

if (json) console.log(JSON.stringify(resultat));
db.close();
rmSync(root, { recursive: true, force: true });
