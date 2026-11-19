import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { UndoManager } from '../electron/lib/undo.mjs';

let root;
let db;
let catalog;
let undoMgr;

function skriv(rel, indhold) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, indhold);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'art-triage-undo-'));
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
  undoMgr = new UndoManager(catalog);
  skriv('a.png', 'indhold-a');
  skriv('b.png', 'indhold-bb');
  catalog.sync();
});

afterEach(() => {
  try { db.close(); } catch { /* allerede lukket */ }
  rmSync(root, { recursive: true, force: true });
});

describe('fortryd og gentag', () => {
  it('fortryder og gentager bedoemmelse', async () => {
    const [a] = catalog.listVersions({});
    undoMgr.beforeRatings([a.version_id]);
    catalog.setRating([a.version_id], 'godkendt');
    expect(catalog.getVersion(a.version_id).rating).toBe('godkendt');

    expect(await undoMgr.undo()).toBe('Rating');
    expect(catalog.getVersion(a.version_id).rating).toBe('ubedomt');

    expect(await undoMgr.redo()).toBe('Rating');
    expect(catalog.getVersion(a.version_id).rating).toBe('godkendt');
  });

  it('fortryder arbejdstrin', async () => {
    const [a] = catalog.listVersions({});
    catalog.setRating([a.version_id], 'godkendt');
    undoMgr.beforeStage([a.version_id]);
    catalog.setStage([a.version_id], 'finished');
    expect(catalog.getVersion(a.version_id).finished).toBe(1);

    await undoMgr.undo();
    expect(catalog.getVersion(a.version_id).finished).toBe(0);
  });

  it('fortryder tilbage til det forrige trin uden at taende begge', async () => {
    // Hele trinnet gemmes under ét. Blev kun det ene flag husket, kunne
    // en fortrydelse ende med baade redigeres og faerdig taendt.
    const [a] = catalog.listVersions({});
    catalog.setRating([a.version_id], 'godkendt');
    catalog.setStage([a.version_id], 'edited');
    undoMgr.beforeStage([a.version_id]);
    catalog.setStage([a.version_id], 'finished');

    await undoMgr.undo();
    const v = catalog.getVersion(a.version_id);
    expect(v.edited).toBe(1);
    expect(v.finished).toBe(0);
  });

  it('fortryder serie-tildeling', async () => {
    const [a] = catalog.listVersions({});
    const serieId = catalog.createSeries('Glazz');
    undoMgr.beforeSeries([a.image_id]);
    catalog.assignSeries([a.image_id], serieId);
    expect(catalog.listVersions({ serieId })).toHaveLength(1);

    await undoMgr.undo();
    expect(catalog.listVersions({ serieId })).toHaveLength(0);

    await undoMgr.redo();
    expect(catalog.listVersions({ serieId })).toHaveLength(1);
  });

  it('fortryder omdoebning af version', async () => {
    const [a] = catalog.listVersions({});
    const kopiId = catalog.createVirtualCopy(a.version_id);
    undoMgr.beforeRename(kopiId);
    catalog.renameVersion(kopiId, 'Beskaering 2');
    expect(catalog.getVersion(kopiId).name).toBe('Beskaering 2');

    await undoMgr.undo();
    expect(catalog.getVersion(kopiId).name).toBe('Kopi 1');
  });

  it('fortryder oprettelse af virtuel kopi', async () => {
    const [a] = catalog.listVersions({});
    const kopiId = catalog.createVirtualCopy(a.version_id);
    undoMgr.afterVirtualCopy(kopiId);
    expect(catalog.listVersionsForImage(a.image_id)).toHaveLength(2);

    expect(await undoMgr.undo()).toBe('Virtual Copy');
    expect(catalog.listVersionsForImage(a.image_id)).toHaveLength(1);

    expect(await undoMgr.redo()).toBe('Virtual Copy');
    expect(catalog.listVersionsForImage(a.image_id)).toHaveLength(2);
  });

  it('fortryder flytning: filen ryger fysisk tilbage', async () => {
    const [a] = catalog.listVersions({});
    const moves = catalog.moveFiles([a.file_id], 'Udvalgte');
    undoMgr.afterMoves(moves);
    expect(existsSync(join(root, 'Udvalgte', 'a.png'))).toBe(true);

    expect(await undoMgr.undo()).toBe('Move');
    expect(existsSync(join(root, 'a.png'))).toBe(true);
    expect(catalog.getFile(a.file_id).rel_path).toBe('a.png');

    expect(await undoMgr.redo()).toBe('Move');
    expect(existsSync(join(root, 'Udvalgte', 'a.png'))).toBe(true);
  });

  it('ny handling rydder gentag-stakken', async () => {
    const rows = catalog.listVersions({});
    undoMgr.beforeRatings([rows[0].version_id]);
    catalog.setRating([rows[0].version_id], 'godkendt');
    await undoMgr.undo();
    expect(undoMgr.canRedo()).toBe(true);

    undoMgr.beforeRatings([rows[1].version_id]);
    catalog.setRating([rows[1].version_id], 'kasseret');
    expect(undoMgr.canRedo()).toBe(false);
  });

  it('fortryd paa tom stak er en no-op', async () => {
    expect(await undoMgr.undo()).toBeNull();
    expect(await undoMgr.redo()).toBeNull();
  });
});

describe('fortryd vaerkets trin', () => {
  const raekke = (rel) => catalog.listVersions({ visKasserede: true }).find((r) => r.rel_path === rel);
  let papirkurv;
  let menu;
  let works;

  beforeEach(async () => {
    const { Works } = await import('../electron/lib/works.mjs');
    skriv('Import/Desert.tif', 'original');
    catalog.brugMappestruktur();
    catalog.sync();
    catalog.setRating([raekke('Import/Desert.tif').version_id], 'godkendt');
    skriv('Approved/Desert/Edits/Desert-neo.tif', 'neo');
    catalog.sync();
    papirkurv = [];
    menu = [];
    works = new Works(catalog);
    undoMgr = new UndoManager(catalog, {
      trash: async (abs) => { papirkurv.push(abs); rmSync(abs); },
      works,
      onChange: (u, r) => menu.push([u, r]),
    });
  });

  it('Master: fortryd laegger masteren i papirkurven, og menuen siger Undo Master', async () => {
    skriv('Approved/Desert/Masters/Desert.tif', 'master');
    undoMgr.afterNyFil('Approved/Desert/Masters/Desert.tif', 'master');
    expect(menu.at(-1)).toEqual(['Master', null]);
    expect(await undoMgr.undo()).toBe('Master');
    expect(existsSync(join(root, 'Approved/Desert/Masters/Desert.tif'))).toBe(false);
    expect(papirkurv).toHaveLength(1);
    expect(menu.at(-1)).toEqual([null, null]);
  });

  it('Original/Edit: fortryd bytter tilbage, og gentag bytter igen', async () => {
    const img = raekke('Approved/Desert/Original/Desert.tif').image_id;
    const foer = catalog.db.get('SELECT master_file_id FROM images WHERE id=?', img).master_file_id;
    catalog.goerTilOriginal(raekke('Approved/Desert/Edits/Desert-neo.tif').version_id);
    undoMgr.afterNyOriginal(img, foer);
    expect(existsSync(join(root, 'Approved/Desert/Original/Desert-neo.tif'))).toBe(true);
    expect(await undoMgr.undo()).toBe('Original');
    expect(existsSync(join(root, 'Approved/Desert/Original/Desert.tif'))).toBe(true);
    expect(existsSync(join(root, 'Approved/Desert/Edits/Desert-neo.tif'))).toBe(true);
    expect(await undoMgr.redo()).toBe('Original');
    expect(existsSync(join(root, 'Approved/Desert/Original/Desert-neo.tif'))).toBe(true);
  });

  it('Omdoeb vaerk: fortryd giver mappen, filerne og titlen det gamle navn', async () => {
    const img = raekke('Approved/Desert/Original/Desert.tif').image_id;
    undoMgr.beforeOmdoebVaerk(img);
    catalog.omdoeb(img, 'Dune');
    works.save(img, { title: 'Dune' });
    catalog.sync();
    expect(existsSync(join(root, 'Approved/Dune/Original/Dune.tif'))).toBe(true);
    expect(await undoMgr.undo()).toBe('Rename');
    catalog.sync();
    expect(existsSync(join(root, 'Approved/Desert/Original/Desert.tif'))).toBe(true);
    expect(existsSync(join(root, 'Approved/Desert/Edits/Desert-neo.tif'))).toBe(true);
    expect(works.get(img).effective.title).toBe('Desert');
    expect(await undoMgr.redo()).toBe('Rename');
    catalog.sync();
    expect(existsSync(join(root, 'Approved/Dune/Original/Dune.tif'))).toBe(true);
    expect(works.get(img).effective.title).toBe('Dune');
  });
});

describe('titlen foelger Finder', () => {
  const raekke = (rel) => catalog.listVersions({ visKasserede: true }).find((r) => r.rel_path === rel);

  it('mappe eller original omdoebt i Finder: titlen foelger, en anden titel roeres ikke', async () => {
    const { Works } = await import('../electron/lib/works.mjs');
    const { renameSync } = await import('node:fs');
    skriv('Import/Desert.tif', 'original');
    skriv('Import/Mur.tif', 'mur');
    catalog.brugMappestruktur();
    catalog.sync();
    catalog.setRating([raekke('Import/Desert.tif').version_id, raekke('Import/Mur.tif').version_id], 'godkendt');
    catalog.sync();
    const works = new Works(catalog);
    const desert = raekke('Approved/Desert/Original/Desert.tif').image_id;
    const mur = raekke('Approved/Mur/Original/Mur.tif').image_id;
    works.save(desert, { title: 'Desert' }); // gemt som i dag: den gamle bliver haengende
    works.save(mur, { title: 'Wall of Time' }); // skrevet i appen
    expect(works.foelgFinderNavne()).toBe(0);
    // Mappen omdoebes i Finder.
    renameSync(join(root, 'Approved/Desert'), join(root, 'Approved/Dune'));
    renameSync(join(root, 'Approved/Mur'), join(root, 'Approved/Muren'));
    catalog.sync();
    expect(works.foelgFinderNavne()).toBe(1);
    expect(works.get(desert).effective.title).toBe('Dune');
    expect(works.get(mur).effective.title).toBe('Wall of Time');
    // Titel og filnavn er det samme: originalen hedder nu ogsaa Dune.
    catalog.sync();
    expect(existsSync(join(root, 'Approved/Dune/Original/Dune.tif'))).toBe(true);
    expect(existsSync(join(root, 'Approved/Muren/Original/Mur.tif'))).toBe(true);
    expect(works.foelgFinderNavne()).toBe(0);
    // Originalens fil omdoebes i Finder: titlen og mappen foelger.
    renameSync(join(root, 'Approved/Dune/Original/Dune.tif'), join(root, 'Approved/Dune/Original/Sand.tif'));
    catalog.sync();
    expect(raekke('Approved/Dune/Original/Sand.tif').image_id).toBe(desert);
    expect(works.foelgFinderNavne()).toBe(1);
    expect(works.get(desert).effective.title).toBe('Sand');
    catalog.sync();
    expect(existsSync(join(root, 'Approved/Sand/Original/Sand.tif'))).toBe(true);
    expect(works.foelgFinderNavne()).toBe(0);
  });
});
