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
  root = mkdtempSync(join(tmpdir(), 'billedflow-undo-'));
  db = await openDatabase(join(root, '.billedflow', 'katalog.sqlite'));
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
  it('fortryder og gentager bedoemmelse', () => {
    const [a] = catalog.listVersions({});
    undoMgr.beforeRatings([a.version_id]);
    catalog.setRating([a.version_id], 'godkendt');
    expect(catalog.getVersion(a.version_id).rating).toBe('godkendt');

    expect(undoMgr.undo()).toBe('bedømmelse');
    expect(catalog.getVersion(a.version_id).rating).toBe('ubedomt');

    expect(undoMgr.redo()).toBe('bedømmelse');
    expect(catalog.getVersion(a.version_id).rating).toBe('godkendt');
  });

  it('fortryder flag', () => {
    const [a] = catalog.listVersions({});
    undoMgr.beforeFlags([a.version_id], 'finished');
    catalog.setFlag([a.version_id], 'finished', true);
    expect(catalog.getVersion(a.version_id).finished).toBe(1);

    undoMgr.undo();
    expect(catalog.getVersion(a.version_id).finished).toBe(0);
  });

  it('fortryder serie-tildeling', () => {
    const [a] = catalog.listVersions({});
    const serieId = catalog.createSeries('Glazz');
    undoMgr.beforeSeries([a.image_id]);
    catalog.assignSeries([a.image_id], serieId);
    expect(catalog.listVersions({ serieId })).toHaveLength(1);

    undoMgr.undo();
    expect(catalog.listVersions({ serieId })).toHaveLength(0);

    undoMgr.redo();
    expect(catalog.listVersions({ serieId })).toHaveLength(1);
  });

  it('fortryder omdoebning af version', () => {
    const [a] = catalog.listVersions({});
    const kopiId = catalog.createVirtualCopy(a.version_id);
    undoMgr.beforeRename(kopiId);
    catalog.renameVersion(kopiId, 'Beskaering 2');
    expect(catalog.getVersion(kopiId).name).toBe('Beskaering 2');

    undoMgr.undo();
    expect(catalog.getVersion(kopiId).name).toBe('Kopi 1');
  });

  it('fortryder oprettelse af virtuel kopi', () => {
    const [a] = catalog.listVersions({});
    const kopiId = catalog.createVirtualCopy(a.version_id);
    undoMgr.afterVirtualCopy(kopiId);
    expect(catalog.listVersionsForImage(a.image_id)).toHaveLength(2);

    expect(undoMgr.undo()).toBe('virtuel kopi');
    expect(catalog.listVersionsForImage(a.image_id)).toHaveLength(1);

    expect(undoMgr.redo()).toBe('virtuel kopi');
    expect(catalog.listVersionsForImage(a.image_id)).toHaveLength(2);
  });

  it('fortryder flytning: filen ryger fysisk tilbage', () => {
    const [a] = catalog.listVersions({});
    const moves = catalog.moveFiles([a.file_id], 'Udvalgte');
    undoMgr.afterMoves(moves);
    expect(existsSync(join(root, 'Udvalgte', 'a.png'))).toBe(true);

    expect(undoMgr.undo()).toBe('flytning');
    expect(existsSync(join(root, 'a.png'))).toBe(true);
    expect(catalog.getFile(a.file_id).rel_path).toBe('a.png');

    expect(undoMgr.redo()).toBe('flytning');
    expect(existsSync(join(root, 'Udvalgte', 'a.png'))).toBe(true);
  });

  it('ny handling rydder gentag-stakken', () => {
    const rows = catalog.listVersions({});
    undoMgr.beforeRatings([rows[0].version_id]);
    catalog.setRating([rows[0].version_id], 'godkendt');
    undoMgr.undo();
    expect(undoMgr.canRedo()).toBe(true);

    undoMgr.beforeRatings([rows[1].version_id]);
    catalog.setRating([rows[1].version_id], 'kasseret');
    expect(undoMgr.canRedo()).toBe(false);
  });

  it('fortryd paa tom stak er en no-op', () => {
    expect(undoMgr.undo()).toBeNull();
    expect(undoMgr.redo()).toBeNull();
  });
});
