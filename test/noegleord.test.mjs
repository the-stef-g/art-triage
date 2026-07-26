// Noegleord efter at de automatiske gaet er taget ud af drift.
//
// Appen scorer ikke laengere billeder mod en dansk ordliste. Tilbage er
// de ord Stef selv skriver ind, plus den plads hvor Claudes ord skal
// lande i punkt 3 af planen (catalog.saveKeywords med manual=0).
// Filen hed tidligere laering.test.mjs og daekkede propagering af egne
// ord til lignende billeder; den mekanisme fulgte ordliste-scoringen ud.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { normalize } from '../electron/lib/searchIndex.mjs';

const MODEL = 'test-model';

let root;
let db;
let catalog;

function nytBillede(navn) {
  const abs = join(root, navn);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, navn);
  catalog.sync();
  return catalog.listVersions({}).find((r) => r.rel_path === navn).file_id;
}

function ordFor(fileId) {
  return catalog.keywordsForFile(fileId).map((k) => k.word);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'art-triage-kw-'));
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
});

afterEach(() => {
  try { db.close(); } catch { /* allerede lukket */ }
  rmSync(root, { recursive: true, force: true });
});

describe('oprydning af automatiske noegleord', () => {
  it('fjerner gaettede ord og lader Stefs egne staa', () => {
    const a = nytBillede('a.png');
    catalog.saveKeywords(a, [{ word: 'kirke', score: 3.1 }, { word: 'himmel', score: 2.7 }]);
    catalog.addKeyword(a, 'seagully');
    expect(ordFor(a).sort()).toEqual(['himmel', 'kirke', 'seagully']);

    expect(catalog.clearAutoKeywords()).toBe(2);
    expect(ordFor(a)).toEqual(['seagully']);
  });

  it('er tom-sikker naar der intet er at rydde', () => {
    const a = nytBillede('a.png');
    catalog.addKeyword(a, 'seagully');
    expect(catalog.clearAutoKeywords()).toBe(0);
    expect(ordFor(a)).toEqual(['seagully']);
  });

  it('rammer alle billeder, ikke kun et', () => {
    const a = nytBillede('a.png');
    const b = nytBillede('b.png');
    catalog.saveKeywords(a, [{ word: 'kirke', score: 3.1 }]);
    catalog.saveKeywords(b, [{ word: 'kirke', score: 3.0 }]);
    expect(catalog.clearAutoKeywords()).toBe(2);
    expect(ordFor(a)).toEqual([]);
    expect(ordFor(b)).toEqual([]);
  });
});

describe('manuelle noegleord', () => {
  it('vises foerst og staar foran gemte auto-ord', () => {
    const a = nytBillede('a.png');
    catalog.addKeyword(a, 'seagully');
    catalog.saveKeywords(a, [{ word: 'strand', score: 3.2 }]);
    const ord = catalog.keywordsForFile(a);
    expect(ord[0]).toMatchObject({ word: 'seagully', manual: 1 });
    expect(ord.map((k) => k.word)).toContain('strand');
  });

  it('overlever at embeddingen ryddes', () => {
    const a = nytBillede('a.png');
    catalog.saveEmbedding(a, MODEL, normalize(Float32Array.from([1, 0, 0, 0])));
    catalog.addKeyword(a, 'seagully');
    catalog.clearEmbedding(a);
    expect(ordFor(a)).toContain('seagully');
  });
});

describe('fjernelse af noegleord', () => {
  it('fjerner fra et enkelt billede og lader de andre vaere', () => {
    const a = nytBillede('a.png');
    const b = nytBillede('b.png');
    catalog.addKeyword(a, 'strand');
    catalog.addKeyword(b, 'strand');
    catalog.removeKeyword(a, 'strand');
    expect(ordFor(a)).not.toContain('strand');
    expect(ordFor(b)).toContain('strand');
  });

  it('fjerner fra udvalgte billeder', () => {
    const a = nytBillede('a.png');
    const b = nytBillede('b.png');
    const c = nytBillede('c.png');
    for (const id of [a, b, c]) catalog.addKeyword(id, 'strand');
    expect(catalog.removeKeywordFromFiles([a, c], 'strand')).toBe(2);
    expect(ordFor(a)).not.toContain('strand');
    expect(ordFor(c)).not.toContain('strand');
    expect(ordFor(b)).toContain('strand');
  });

  it('rammer baade manuelle og automatiske ord paa de valgte billeder', () => {
    const a = nytBillede('a.png');
    const b = nytBillede('b.png');
    catalog.addKeyword(a, 'kirke'); // skrevet i haanden
    catalog.saveKeywords(b, [{ word: 'kirke', score: 3.1 }]); // fra Claude
    expect(catalog.removeKeywordFromFiles([a, b], 'kirke')).toBe(2);
    expect(ordFor(a)).toEqual([]);
    expect(ordFor(b)).toEqual([]);
  });

  it('spaerrer ikke et ord man har fjernet', () => {
    // Foer blev hver sletning ogsaa gemt som en varig afvisning, saa
    // ordet aldrig kunne komme igen paa det billede. En oprydning var
    // dermed uigenkaldelig uden at det stod nogen steder.
    const a = nytBillede('a.png');
    catalog.saveKeywords(a, [{ word: 'wall', score: 899 }]);
    catalog.removeKeyword(a, 'wall');
    expect(ordFor(a)).not.toContain('wall');
    catalog.saveKeywords(a, [{ word: 'wall', score: 899 }]);
    expect(ordFor(a)).toContain('wall');
  });
});

describe('noegleordstal matcher synlige billeder', () => {
  it('et kasseret-kun noegleord taelles ikke og viser intet', () => {
    const a = nytBillede('a.png');
    const b = nytBillede('b.png');
    catalog.addKeyword(a, 'motiv');
    catalog.addKeyword(b, 'motiv');
    const bVer = catalog.listVersions({ visKasserede: true }).find((r) => r.file_id === b);
    catalog.setRating([bVer.version_id], 'kasseret');

    const top = Object.fromEntries(catalog.topKeywords().map((k) => [k.word, k.antal]));
    const synlige = new Set(catalog.listVersions({ keyword: 'motiv' }).map((r) => r.file_id));
    expect(top.motiv).toBe(synlige.size);
    expect(top.motiv).toBe(1);
  });

  it('noegleord kun paa et kasseret billede optraeder slet ikke', () => {
    const a = nytBillede('a.png');
    catalog.addKeyword(a, 'kunkasseret');
    const ver = catalog.listVersions({ visKasserede: true }).find((r) => r.file_id === a);
    catalog.setRating([ver.version_id], 'kasseret');
    expect(catalog.topKeywords().map((k) => k.word)).not.toContain('kunkasseret');
  });
});
