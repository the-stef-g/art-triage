// Kandidat er den fjerde bedoemmelse ved siden af godkendt, kasseret og
// ubedoemt. Den bruges naar motivet er godt, men noget teknisk skal
// rettes foerst, saa billedet endnu ikke kan afgoeres. Punkt 2 i
// docs/plan-cloud-noegleord.md.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';

let root;
let db;
let catalog;

function skriv(rel) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, rel);
}

function versionFor(relPath) {
  return catalog.listVersions({ visKasserede: true }).find((r) => r.rel_path === relPath);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'billedflow-kandidat-'));
  db = await openDatabase(join(root, '.billedflow', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
  skriv('a.png');
  skriv('b.png');
  skriv('c.png');
  catalog.sync();
});

afterEach(() => {
  try { db.close(); } catch { /* allerede lukket */ }
  rmSync(root, { recursive: true, force: true });
});

describe('kandidat som bedoemmelse', () => {
  it('kan saettes og laeses tilbage', () => {
    const a = versionFor('a.png');
    catalog.setRating([a.version_id], 'kandidat');
    expect(versionFor('a.png').rating).toBe('kandidat');
  });

  it('afviser stadig ukendte bedoemmelser', () => {
    const a = versionFor('a.png');
    expect(() => catalog.setRating([a.version_id], 'maaske')).toThrow(/Ukendt bedømmelse/);
  });

  it('kan skiftes videre til godkendt naar billedet er rettet', () => {
    const a = versionFor('a.png');
    catalog.setRating([a.version_id], 'kandidat');
    catalog.setRating([a.version_id], 'godkendt');
    expect(versionFor('a.png').rating).toBe('godkendt');
  });
});

describe('kandidater i listen', () => {
  it('vises som standard, i modsaetning til kasserede', () => {
    const a = versionFor('a.png');
    const b = versionFor('b.png');
    catalog.setRating([a.version_id], 'kandidat');
    catalog.setRating([b.version_id], 'kasseret');
    const synlige = catalog.listVersions({}).map((r) => r.rel_path).sort();
    expect(synlige).toContain('a.png');
    expect(synlige).not.toContain('b.png');
  });

  it('kunKandidater giver praecis arbejdslisten', () => {
    const a = versionFor('a.png');
    const b = versionFor('b.png');
    catalog.setRating([a.version_id], 'kandidat');
    catalog.setRating([b.version_id], 'godkendt');
    const kun = catalog.listVersions({ kunKandidater: true }).map((r) => r.rel_path);
    expect(kun).toEqual(['a.png']);
  });

  it('kunGodkendte tager ikke kandidater med', () => {
    const a = versionFor('a.png');
    catalog.setRating([a.version_id], 'kandidat');
    expect(catalog.listVersions({ kunGodkendte: true })).toEqual([]);
  });
});

describe('optaelling', () => {
  it('taeller kandidater for sig, saa sidepanelet kan vise antallet', () => {
    const a = versionFor('a.png');
    const b = versionFor('b.png');
    const c = versionFor('c.png');
    catalog.setRating([a.version_id, b.version_id], 'kandidat');
    catalog.setRating([c.version_id], 'godkendt');
    const { byRating } = catalog.counts();
    expect(byRating.kandidat).toBe(2);
    expect(byRating.godkendt).toBe(1);
  });

  it('antallet i sidepanelet matcher det listen viser', () => {
    const a = versionFor('a.png');
    catalog.setRating([a.version_id], 'kandidat');
    const { byRating } = catalog.counts();
    const listen = catalog.listVersions({ kunKandidater: true });
    expect(byRating.kandidat).toBe(listen.length);
  });
});
