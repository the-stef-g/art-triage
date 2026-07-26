import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SearchIndex, medianMad, robustZ, normalize } from '../electron/lib/searchIndex.mjs';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { Indexer } from '../electron/lib/indexer.mjs';

// Deterministisk pseudotilfaeldighed, saa testene aldrig flimrer.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// 64 dimensioner: taet nok paa modellens 768 til at stoejen opfoerer
// sig realistisk (tilfaeldige kosinus-ligheder koncentreres om nul).
function tilfaeldigVektor(rand, dim = 64) {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = rand() * 2 - 1;
  return normalize(v);
}

// En vektor taet paa target med lidt stoej.
function taetPaa(rand, target, stoej = 0.15) {
  const v = new Float32Array(target.length);
  for (let i = 0; i < target.length; i++) v[i] = target[i] + (rand() * 2 - 1) * stoej;
  return normalize(v);
}

describe('robust statistik', () => {
  it('medianMad paa flad fordeling giver mad 0', () => {
    const { median, mad } = medianMad([5, 5, 5, 5]);
    expect(median).toBe(5);
    expect(mad).toBe(0);
  });

  it('robustZ skalerer som standardafvigelser', () => {
    const { median, mad } = medianMad([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(robustZ(median, median, mad)).toBe(0);
    expect(robustZ(100, median, mad)).toBeGreaterThan(10);
  });
});

describe('selvkalibrerende soegning', () => {
  function indexMed(vectors) {
    const idx = new SearchIndex(null, 'test');
    idx.vectors = new Map(vectors.map((v, i) => [i + 1, v]));
    return idx;
  }

  it('nonsens-forespoergsel mod stoej giver nul resultater', () => {
    const rand = lcg(42);
    const idx = indexMed(Array.from({ length: 120 }, () => tilfaeldigVektor(rand)));
    const hits = idx.query(tilfaeldigVektor(rand));
    expect(hits.length).toBe(0);
  });

  it('tydelige outliers findes, resten frasorteres', () => {
    const rand = lcg(7);
    const target = tilfaeldigVektor(rand);
    const billeder = Array.from({ length: 100 }, () => tilfaeldigVektor(rand));
    // 12 billeder ligner soegningen
    for (let i = 0; i < 12; i++) billeder[i] = taetPaa(rand, target);
    const idx = indexMed(billeder);
    const hits = idx.query(target);
    expect(hits.length).toBeGreaterThanOrEqual(10);
    expect(hits.length).toBeLessThanOrEqual(14);
    // De fundne skal vaere blandt de plantede (id 1-12)
    const plantede = hits.filter((h) => h.fileId <= 12).length;
    expect(plantede).toBe(hits.length);
  });

  it('virker ogsaa naar en stor andel matcher', () => {
    const rand = lcg(99);
    const target = tilfaeldigVektor(rand);
    const billeder = Array.from({ length: 100 }, () => tilfaeldigVektor(rand));
    for (let i = 0; i < 40; i++) billeder[i] = taetPaa(rand, target);
    const idx = indexMed(billeder);
    const hits = idx.query(target);
    expect(hits.length).toBeGreaterThanOrEqual(30);
    const plantede = hits.filter((h) => h.fileId <= 40).length;
    expect(plantede).toBe(hits.length);
  });
});

describe('noegleord', () => {
  let root;
  let db;
  let catalog;

  function skriv(rel, indhold) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, indhold);
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'billedflow-kw-'));
    db = await openDatabase(join(root, '.billedflow', 'katalog.sqlite'));
    catalog = new Catalog(db, root);
    skriv('a.png', 'a');
    skriv('b.png', 'bb');
    catalog.sync();
  });

  afterEach(() => {
    try { db.close(); } catch { /* allerede lukket */ }
    rmSync(root, { recursive: true, force: true });
  });

  // Ordliste-scoringen er taget ud af drift: den sammenlignede ord
  // indbyrdes paa hvert billede, og et ord der generelt laa hoejt vandt
  // saa paa alt. Indexeren beregner nu kun embeddings til soegningen.
  // Tildeling og oprydning er daekket i noegleord.test.mjs.
  it('indekseringen tildeler ikke laengere noegleord', () => {
    const indexer = new Indexer({ catalog, thumbs: null, ai: null, searchIndex: null, model: 'test-model' });
    expect(indexer.recomputeKeywords).toBeUndefined();
    expect(indexer._assignKeywords).toBeUndefined();
  });

  it('et manuelt noegleord staar foran et gemt auto-ord', () => {
    const [a] = catalog.listVersions({});
    catalog.addKeyword(a.file_id, 'seagully');
    catalog.saveKeywords(a.file_id, [{ word: 'strand', score: 3.2 }]);
    const ord = catalog.keywordsForFile(a.file_id);
    expect(ord[0]).toMatchObject({ word: 'seagully', manual: 1 });
    expect(ord.map((k) => k.word)).toContain('strand');

    catalog.removeKeyword(a.file_id, 'seagully');
    expect(catalog.keywordsForFile(a.file_id).map((k) => k.word)).not.toContain('seagully');
  });

  it('filesWithKeywordLike matcher delstrenge uanset store/smaa bogstaver', () => {
    const rows = catalog.listVersions({});
    catalog.addKeyword(rows[0].file_id, 'Gul Blomst');
    expect(catalog.filesWithKeywordLike('gul')).toEqual([rows[0].file_id]);
    expect(catalog.filesWithKeywordLike('blomst')).toEqual([rows[0].file_id]);
    expect(catalog.filesWithKeywordLike('hest')).toEqual([]);
  });

  // En gemt embedding skal stadig kunne bruges af soegningen, selv om
  // der ikke laengere udledes noegleord af den.
  it('en gemt embedding giver ingen noegleord af sig selv', () => {
    const rand = lcg(11);
    const model = 'test-model';
    const rows = catalog.listVersions({});
    catalog.saveEmbedding(rows[0].file_id, model, tilfaeldigVektor(rand));
    expect(catalog.keywordsForFile(rows[0].file_id)).toEqual([]);
  });
});
