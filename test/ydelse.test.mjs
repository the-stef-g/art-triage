// Det der gik langsommere jo flere billeder kataloget havde. Hvert led her
// er maalt i scripts/bench.mjs paa 15.000 billeder; testene holder oeje med
// at de ikke vokser med kvadratet paa bibliotekets stoerrelse igen, og at
// de omskrevne forespoergsler giver de samme svar som foer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { Indexer } from '../electron/lib/indexer.mjs';
import { SearchIndex } from '../electron/lib/searchIndex.mjs';
import { watchLibrary, relevantAendring } from '../electron/lib/watcher.mjs';
import { openFdCount } from '../electron/lib/util.mjs';

let root;
let db;
let catalog;

function skriv(rel, indhold = rel) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, indhold);
}

async function nyKatalog(opts = {}) {
  const d = await openDatabase(join(root, '.art-triage', `k-${Math.random().toString(36).slice(2)}.sqlite`), opts);
  return { d, c: new Catalog(d, root) };
}

const stat = (c) => c.listVersions({ visKasserede: true })
  .map((r) => `${r.rel_path}|${r.version_name}|${r.rating}|${r.edited}`).sort();

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'art-triage-ydelse-'));
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
});

afterEach(() => {
  try { db.close(); } catch { /* lukket */ }
  rmSync(root, { recursive: true, force: true });
});

describe('asynkron genskanning giver det samme som den synkrone', () => {
  it('nye filer og afledte versioner', async () => {
    skriv('a/IMG_1.CR2'); skriv('a/IMG_1-edit.tif'); skriv('a/IMG_2.jpg'); skriv('b/andet.png');
    const { d, c } = await nyKatalog();
    catalog.sync();
    const res = await c.syncAsync();
    expect(res).toMatchObject({ changed: 4, unavailable: false });
    expect(stat(c)).toEqual(stat(catalog));
    expect(c.listVersions({}).filter((r) => r.rel_path.startsWith('a/IMG_1')).length).toBe(2);
    d.close();
  });

  it('opdager en aendret fil, og en flyttet fil bevarer sin vurdering', async () => {
    skriv('a.jpg', 'foerste indhold'); skriv('b.jpg', 'andet indhold');
    await catalog.syncAsync();
    const b = catalog.listVersions({}).find((r) => r.rel_path === 'b.jpg');
    catalog.setRating([b.version_id], 'godkendt');
    // a.jpg faar nyt indhold, b.jpg flyttes til en undermappe.
    writeFileSync(join(root, 'a.jpg'), 'helt nyt og laengere indhold');
    const nyTid = new Date(Date.now() + 60_000);
    utimesSync(join(root, 'a.jpg'), nyTid, nyTid);
    mkdirSync(join(root, 'ny'));
    renameSync(join(root, 'b.jpg'), join(root, 'ny', 'b.jpg'));
    const res = await catalog.syncAsync();
    expect(res.edited).toBe(1);
    const liste = catalog.listVersions({});
    expect(liste.find((r) => r.rel_path === 'a.jpg').edited).toBe(1);
    const flyttet = liste.find((r) => r.rel_path === 'ny/b.jpg');
    expect(flyttet.rating).toBe('godkendt');
    expect(liste).toHaveLength(2);
  });

  it('markerer en forsvundet fil, og lader kataloget staa naar drevet mangler', async () => {
    skriv('a.jpg'); skriv('b.jpg');
    await catalog.syncAsync();
    rmSync(join(root, 'b.jpg'));
    await catalog.syncAsync();
    expect(catalog.listVersions({}).map((r) => r.rel_path)).toEqual(['a.jpg']);
    const { d, c } = await nyKatalog();
    c.root = join(root, 'findes-ikke');
    expect(await c.syncAsync()).toMatchObject({ unavailable: true });
    d.close();
  });

  it('holder ikke hovedprocessen: andet kan koere mens der skannes', async () => {
    for (let m = 0; m < 20; m++) for (let i = 0; i < 100; i++) skriv(`m${m}/Billede ${i}.jpg`, `${m}-${i}`);
    let slag = 0;
    const timer = setInterval(() => { slag += 1; }, 1);
    await catalog.syncAsync();
    clearInterval(timer);
    expect(catalog.counts().total).toBe(2000);
    expect(slag).toBeGreaterThan(3);
  });
});

describe('forespoergsler der voksede med kvadratet', () => {
  it('noegleord, koe og oprydning svarer hurtigt og rigtigt ved 4.000 billeder', async () => {
    for (let m = 0; m < 40; m++) for (let i = 0; i < 100; i++) skriv(`m${m}/B ${i}.jpg`, `${m}-${i}`);
    catalog.sync();
    const rows = catalog.listVersions({});
    expect(rows).toHaveLength(4000);
    db.transaction(() => {
      rows.forEach((r, i) => {
        if (i % 3 === 0) db.run("UPDATE versions SET rating='godkendt' WHERE id=?", r.version_id);
        if (i % 10 === 1) db.run("UPDATE versions SET rating='kasseret' WHERE id=?", r.version_id);
        for (let k = 0; k < 6; k++) {
          db.run('INSERT INTO keywords(file_id, word, score, manual) VALUES(?,?,?,0) ON CONFLICT(file_id, word) DO NOTHING',
            r.file_id, `ord${(i * 7 + k * 131) % 800}`, 900 - k);
        }
      });
    });
    let t = Date.now();
    const top = catalog.topKeywords();
    const tTop = Date.now() - t;
    t = Date.now();
    const koe = catalog.keywordQueueSize();
    const tKoe = Date.now() - t;
    t = Date.now();
    const filer = catalog.filesNeedingKeywords();
    const tFiler = Date.now() - t;
    // Foer: ca. 5 s, 1,3 s og 1,3 s paa den her stoerrelse.
    expect(tTop).toBeLessThan(1500);
    expect(tKoe).toBeLessThan(400);
    expect(tFiler).toBeLessThan(400);
    // Svarene: kun godkendte i koeen, ingen kasserede i noegleordstallene.
    expect(koe).toBe(filer.length);
    // En fil der baade blev godkendt og siden kasseret er kasseret.
    expect(koe).toBe(rows.filter((r, i) => i % 3 === 0 && i % 10 !== 1).length);
    const kasserede = new Set(rows.filter((r, i) => i % 10 === 1).map((r) => r.file_id));
    // Hver (fil, ord) taelles én gang, og kun for filer der ikke er kasserede.
    const forventet = db.all('SELECT file_id FROM keywords').filter((k) => !kasserede.has(k.file_id)).length;
    expect(catalog.topKeywords(5000).reduce((sum, k) => sum + k.antal, 0)).toBe(forventet);
    expect(top).toHaveLength(500); // listen skaeres til de 500 hyppigste
  }, 60000);

  it('moveDiscarded flytter kun filer hvor alle versioner er kasserede', async () => {
    skriv('a.jpg'); skriv('b.jpg'); skriv('c.jpg');
    catalog.sync();
    const v = (rel) => catalog.listVersions({ visKasserede: true }).find((r) => r.rel_path === rel);
    catalog.setRating([v('a.jpg').version_id], 'kasseret');
    catalog.setRating([v('b.jpg').version_id], 'kasseret');
    const kopi = catalog.createVirtualCopy(v('b.jpg').version_id); // en levende kopi af b
    expect(kopi).toBeTruthy();
    const flyttet = catalog.moveDiscarded();
    expect(flyttet.map((m) => m.fileId)).toHaveLength(1);
    expect(catalog.listVersions({ visKasserede: true }).find((r) => r.is_master && r.rel_path.startsWith('_kasseret/'))).toBeTruthy();
    expect(catalog.listVersions({ visKasserede: true }).find((r) => r.rel_path === 'b.jpg')).toBeTruthy();
  });

  it('virker ogsaa paa sql.js, som er reserven', async () => {
    skriv('a.jpg'); skriv('b.jpg');
    const { d, c } = await nyKatalog({ engine: 'sqljs' });
    expect(d.engine).toBe('sql.js');
    c.sync();
    const r = c.listVersions({});
    c.setRating([r[0].version_id], 'godkendt');
    c.saveKeywords(r[0].file_id, [{ word: 'flower', score: 900 }]);
    expect(c.keywordQueueSize()).toBe(1);
    expect(c.filesNeedingKeywords().map((f) => f.rel_path)).toEqual(['a.jpg']);
    expect(c.topKeywords()).toEqual([{ word: 'flower', antal: 1 }]);
    c.setRating([r[0].version_id], 'kasseret');
    expect(c.topKeywords()).toEqual([]);
    expect(Array.isArray(c.moveDiscarded())).toBe(true);
    d.close();
  });
});

describe('indekseringen', () => {
  function bygIndexer(thumbs) {
    const ai = { ready: true, embedImage: async () => Float32Array.from([1, 0, 0, 0]) };
    const searchIndex = new SearchIndex(catalog, 'm');
    return new Indexer({ catalog, thumbs, ai, searchIndex, model: 'm' });
  }
  const klar = (indexer) => new Promise((ok) => {
    indexer.on('progress', (p) => { if (p.phase === 'faerdig') ok(); });
  });

  it('henter en bunke ad gangen, ikke hele ventelisten for hver fil', async () => {
    for (let i = 0; i < 120; i++) skriv(`B ${i}.jpg`, `x${i}`);
    catalog.sync();
    const kald = [];
    const orig = catalog.filesNeedingEmbedding.bind(catalog);
    catalog.filesNeedingEmbedding = (m, limit) => { kald.push(limit); return orig(m, limit); };
    const indexer = bygIndexer({ ensure: async () => '/tmp/x.jpg' });
    const faerdig = klar(indexer);
    indexer.kick();
    await faerdig;
    expect(catalog.countNeedingEmbedding('m')).toBe(0);
    expect(kald.every((l) => l === 50)).toBe(true);
    expect(kald.length).toBeLessThanOrEqual(5); // 3 bunker + den tomme
  });

  it('gaar videre naar en fil ingen forhaandsvisning har, i stedet for at stoppe', async () => {
    for (let i = 0; i < 6; i++) skriv(`B ${i}.jpg`, `x${i}`);
    catalog.sync();
    const ensure = async (id) => (id === 2 ? null : '/tmp/x.jpg');
    const indexer = bygIndexer({ ensure });
    const faerdig = klar(indexer);
    indexer.kick();
    await faerdig;
    // Alle seks har en raekke, og filen uden forhaandsvisning er en tom markering.
    expect(catalog.countNeedingEmbedding('m')).toBe(0);
    const dims = db.all('SELECT file_id, dim FROM embeddings ORDER BY file_id').map((r) => r.dim);
    expect(dims).toHaveLength(6);
    expect(dims.filter((d) => d === 0)).toHaveLength(1);
  });

  it('gemmer en tom vektor som markering, ogsaa paa node:sqlite', () => {
    skriv('a.jpg');
    catalog.sync();
    const [r] = catalog.listVersions({});
    expect(() => catalog.saveEmbedding(r.file_id, 'm', new Float32Array(0))).not.toThrow();
    expect(catalog.countNeedingEmbedding('m')).toBe(0);
    const si = new SearchIndex(catalog, 'm');
    si.load();
    expect(si.size()).toBe(0); // markeringen kommer ikke med i soegningen
  });
});

describe('overvaagning af mappen', () => {
  it('kender de aendringer der kan betyde noget', () => {
    expect(relevantAendring('a/b/Foto.CR2')).toBe(true);
    expect(relevantAendring('ny mappe')).toBe(true);
    expect(relevantAendring('a/notat.txt')).toBe(false);
    expect(relevantAendring('.DS_Store')).toBe(false);
    expect(relevantAendring('.art-triage/cache/1-2-512.jpg')).toBe(false);
    expect(relevantAendring('a/.skjult/b.jpg')).toBe(false);
    expect(relevantAendring(null)).toBe(true);
  });

  it('melder en ny billedfil, men ikke cachen eller en tekstfil', async () => {
    const tid = [];
    const w = watchLibrary(root, () => tid.push(Date.now()));
    await new Promise((ok) => setTimeout(ok, 200));
    skriv('.art-triage/cache/x.jpg');
    skriv('notat.txt');
    await new Promise((ok) => setTimeout(ok, 1200));
    expect(tid).toHaveLength(0);
    skriv('ny/Foto.jpg');
    await new Promise((ok) => setTimeout(ok, 1800));
    expect(tid.length).toBeGreaterThan(0);
    await w.close();
  });

  it('bruger ikke én filhaandtering pr. fil', async () => {
    for (let i = 0; i < 300; i++) skriv(`m${i % 10}/F ${i}.jpg`, `${i}`);
    const foer = openFdCount();
    const w = watchLibrary(root, () => {});
    await new Promise((ok) => setTimeout(ok, 300));
    const efter = openFdCount();
    await w.close();
    // chokidar ville paa macOS have lagt 300 til; her hoejst en haandfuld.
    if (foer !== null && efter !== null) expect(efter - foer).toBeLessThan(40);
  });
});
