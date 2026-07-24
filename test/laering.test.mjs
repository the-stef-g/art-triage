import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { Indexer } from '../electron/lib/indexer.mjs';
import { normalize } from '../electron/lib/searchIndex.mjs';
import { vocabHash } from '../electron/lib/vocab.mjs';

const MODEL = 'test-model';

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
function tilfaeldigVektor(rand, dim = 64) {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = rand() * 2 - 1;
  return normalize(v);
}
function taetPaa(rand, target, stoej = 0.1) {
  const v = new Float32Array(target.length);
  for (let i = 0; i < target.length; i++) v[i] = target[i] + (rand() * 2 - 1) * stoej;
  return normalize(v);
}

let root;
let db;
let catalog;
let indexer;
let rand;

function nytBillede(navn, vec) {
  const abs = join(root, navn);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, navn);
  catalog.sync();
  const row = catalog.listVersions({}).find((r) => r.rel_path === navn);
  catalog.saveEmbedding(row.file_id, MODEL, vec);
  return row.file_id;
}

function saetVocab(ord) {
  catalog.setMeta(`vocab:${MODEL}:${vocabHash()}`, JSON.stringify(ord.map(({ word, vec }) => ({
    word,
    vec: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64'),
  }))));
  indexer.vocabVecs = null;
  indexer.candidates = null;
  indexer.candidatesRev = -1;
}

function ordFor(fileId) {
  return catalog.keywordsForFile(fileId).map((k) => k.word);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'billedflow-laer-'));
  db = await openDatabase(join(root, '.billedflow', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
  indexer = new Indexer({ catalog, thumbs: null, ai: null, searchIndex: null, model: MODEL });
  rand = lcg(2026);
});

afterEach(() => {
  try { db.close(); } catch { /* allerede lukket */ }
  rmSync(root, { recursive: true, force: true });
});

describe('permanent sletning', () => {
  it('et slettet nøgleord kommer aldrig igen efter genberegning', () => {
    const target = tilfaeldigVektor(rand);
    const fid = nytBillede('a.png', taetPaa(rand, target, 0.05));
    saetVocab([
      { word: 'strand', vec: taetPaa(rand, target, 0.05) },
      ...Array.from({ length: 60 }, (_, i) => ({ word: `x${i}`, vec: tilfaeldigVektor(rand) })),
    ]);
    expect(indexer.recomputeKeywords()).toBe(true);
    expect(ordFor(fid)).toContain('strand');

    catalog.removeKeyword(fid, 'strand');
    expect(ordFor(fid)).not.toContain('strand');
    indexer.recomputeKeywords();
    expect(ordFor(fid)).not.toContain('strand');
  });

  it('fjern fra alle billeder udelukker ordet globalt', () => {
    const target = tilfaeldigVektor(rand);
    const a = nytBillede('a.png', taetPaa(rand, target, 0.05));
    const b = nytBillede('b.png', taetPaa(rand, target, 0.05));
    saetVocab([
      { word: 'strand', vec: taetPaa(rand, target, 0.05) },
      ...Array.from({ length: 60 }, (_, i) => ({ word: `x${i}`, vec: tilfaeldigVektor(rand) })),
    ]);
    indexer.recomputeKeywords();
    expect(ordFor(a)).toContain('strand');
    expect(ordFor(b)).toContain('strand');

    expect(catalog.removeKeywordEverywhere('strand')).toBeGreaterThanOrEqual(2);
    indexer.recomputeKeywords();
    expect(ordFor(a)).not.toContain('strand');
    expect(ordFor(b)).not.toContain('strand');
  });

  it('manuelt nøgleord overlever clearEmbedding', () => {
    const fid = nytBillede('a.png', tilfaeldigVektor(rand));
    catalog.addKeyword(fid, 'seagully');
    catalog.clearEmbedding(fid);
    expect(ordFor(fid)).toContain('seagully');
  });

  it('fjerner et nøgleord fra udvalgte billeder og holder det væk der', () => {
    const target = tilfaeldigVektor(rand);
    const a = nytBillede('a.png', taetPaa(rand, target, 0.05));
    const b = nytBillede('b.png', taetPaa(rand, target, 0.05));
    const c = nytBillede('c.png', taetPaa(rand, target, 0.05));
    saetVocab([
      { word: 'strand', vec: taetPaa(rand, target, 0.05) },
      ...Array.from({ length: 60 }, (_, i) => ({ word: `x${i}`, vec: tilfaeldigVektor(rand) })),
    ]);
    indexer.recomputeKeywords();
    for (const id of [a, b, c]) expect(ordFor(id)).toContain('strand');

    // a og c hoerer ikke til: fjern dem fra soegeordet.
    expect(catalog.removeKeywordFromFiles([a, c], 'strand')).toBe(2);
    expect(ordFor(a)).not.toContain('strand');
    expect(ordFor(c)).not.toContain('strand');
    expect(ordFor(b)).toContain('strand');

    // Genberegning maa ikke bringe ordet tilbage paa a og c.
    indexer.recomputeKeywords();
    expect(ordFor(a)).not.toContain('strand');
    expect(ordFor(c)).not.toContain('strand');
    expect(ordFor(b)).toContain('strand');
  });
});

describe('læring af egne ord (prototyper)', () => {
  it('foreslår et selvvalgt ord på lignende billeder, men ikke fjerne eller afviste', () => {
    const target = tilfaeldigVektor(rand);
    const a = nytBillede('a.png', taetPaa(rand, target, 0.08));
    const b = nytBillede('b.png', taetPaa(rand, target, 0.08));
    const c = nytBillede('c.png', taetPaa(rand, target, 0.08)); // ligner
    const d = nytBillede('d.png', tilfaeldigVektor(rand)); // fjern
    const e = nytBillede('e.png', taetPaa(rand, target, 0.08)); // ligner, men afvist
    saetVocab(Array.from({ length: 60 }, (_, i) => ({ word: `x${i}`, vec: tilfaeldigVektor(rand) })));

    catalog.addKeyword(a, 'seagully');
    catalog.addKeyword(b, 'seagully');
    catalog.removeKeyword(e, 'seagully'); // afvist paa e

    indexer.recomputeKeywords();
    expect(ordFor(c)).toContain('seagully'); // laert paa lignende
    expect(ordFor(d)).not.toContain('seagully'); // for forskelligt
    expect(ordFor(e)).not.toContain('seagully'); // afvist
  });

  it('et enkelt eksempel spreder ikke ordet (kræver mindst to)', () => {
    const target = tilfaeldigVektor(rand);
    const a = nytBillede('a.png', taetPaa(rand, target, 0.08));
    const c = nytBillede('c.png', taetPaa(rand, target, 0.08));
    saetVocab(Array.from({ length: 60 }, (_, i) => ({ word: `x${i}`, vec: tilfaeldigVektor(rand) })));

    catalog.addKeyword(a, 'seagully'); // kun ét eksempel
    indexer.recomputeKeywords();
    expect(ordFor(a)).toContain('seagully'); // manuelt, staar stadig
    expect(ordFor(c)).not.toContain('seagully'); // ikke spredt
  });

  it('stærk-port giver ingen nøgleord til et svagt match', () => {
    // Alle ord ligger nogenlunde lige langt fra billedet: ingen skiller
    // sig ud, saa der tildeles intet.
    const base = tilfaeldigVektor(rand);
    const fid = nytBillede('a.png', tilfaeldigVektor(rand));
    saetVocab(Array.from({ length: 60 }, () => ({ word: `x${Math.random()}`, vec: taetPaa(rand, base, 0.4) })));
    indexer.recomputeKeywords();
    expect(ordFor(fid).length).toBe(0);
  });
});

describe('nøgleordstal matcher synlige billeder', () => {
  it('et kasseret-kun nøgleord tælles ikke og viser intet', () => {
    const a = nytBillede('a.png', tilfaeldigVektor(rand));
    const b = nytBillede('b.png', tilfaeldigVektor(rand));
    catalog.addKeyword(a, 'motiv');
    catalog.addKeyword(b, 'motiv');
    // Kasser b's eneste version.
    const bVer = catalog.listVersions({ visKasserede: true }).find((r) => r.file_id === b);
    catalog.setRating([bVer.version_id], 'kasseret');

    const top = Object.fromEntries(catalog.topKeywords().map((k) => [k.word, k.antal]));
    const synlige = new Set(catalog.listVersions({ keyword: 'motiv' }).map((r) => r.file_id));
    expect(top.motiv).toBe(synlige.size);
    expect(top.motiv).toBe(1);
  });

  it('nøgleord kun på et kasseret billede optræder slet ikke', () => {
    const a = nytBillede('a.png', tilfaeldigVektor(rand));
    catalog.addKeyword(a, 'kunkasseret');
    const ver = catalog.listVersions({ visKasserede: true }).find((r) => r.file_id === a);
    catalog.setRating([ver.version_id], 'kasseret');
    const ord = catalog.topKeywords().map((k) => k.word);
    expect(ord).not.toContain('kunkasseret');
  });
});
