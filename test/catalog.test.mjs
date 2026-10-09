import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';

let root;
let db;
let catalog;

function skriv(rel, indhold) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, indhold);
  return abs;
}

async function nyCatalog() {
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
  return catalog;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'art-triage-test-'));
  await nyCatalog();
});

afterEach(() => {
  try { db.close(); } catch { /* allerede lukket */ }
  rmSync(root, { recursive: true, force: true });
});

describe('scanning', () => {
  it('opretter billede + masterversion for nye filer', () => {
    skriv('a.png', 'indhold-a');
    skriv('mappe/b.jpg', 'indhold-b');
    skriv('noter.txt', 'ikke et billede');
    catalog.sync();
    const rows = catalog.listVersions({});
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.is_master === 1)).toBe(true);
    expect(rows.map((r) => r.rel_path).sort()).toEqual(['a.png', 'mappe/b.jpg']);
  });

  it('er idempotent', () => {
    skriv('a.png', 'indhold-a');
    catalog.sync();
    catalog.sync();
    expect(catalog.listVersions({})).toHaveLength(1);
  });

  it('genkender flyttede filer og bevarer status', () => {
    skriv('a.png', 'indhold-a-unik');
    catalog.sync();
    const [row] = catalog.listVersions({});
    catalog.setRating([row.version_id], 'godkendt');

    mkdirSync(join(root, 'ny-mappe'), { recursive: true });
    renameSync(join(root, 'a.png'), join(root, 'ny-mappe', 'omdoebt.png'));
    catalog.sync();

    const rows = catalog.listVersions({});
    expect(rows).toHaveLength(1);
    expect(rows[0].rel_path).toBe('ny-mappe/omdoebt.png');
    expect(rows[0].rating).toBe('godkendt');
    expect(rows[0].file_id).toBe(row.file_id);
  });

  it('markerer versioner som redigeret naar filens indhold aendres', () => {
    skriv('a.png', 'foerste-indhold');
    catalog.sync();
    catalog.setRating([catalog.listVersions({})[0].version_id], 'godkendt');
    expect(catalog.listVersions({})[0].edited).toBe(0);

    skriv('a.png', 'nyt-indhold-som-er-laengere');
    catalog.sync();
    expect(catalog.listVersions({})[0].edited).toBe(1);
  });

  it('stacker afledte filer som versioner af samme billede', () => {
    skriv('IMG_0001.png', 'raa-fil');
    catalog.sync();
    catalog.setRating([catalog.listVersions({})[0].version_id], 'godkendt');

    skriv('IMG_0001-gigapixel.jpg', 'opskaleret');
    skriv('IMG_0001.tif', 'samme-navn-anden-type');
    skriv('IMG_00012.png', 'andet billede, ingen separator');
    catalog.sync();

    const rows = catalog.listVersions({});
    const billeder = new Set(rows.map((r) => r.image_id));
    expect(billeder.size).toBe(2); // IMG_0001 (med 3 versioner) + IMG_00012
    const stak = rows.filter((r) => r.version_count === 3);
    expect(stak.length).toBe(3);
    const kopi = rows.find((r) => r.version_name === 'gigapixel');
    expect(kopi).toBeTruthy();
    expect(kopi.edited).toBe(1);
  });

  it('stakker ikke nummererede filer eller filer af samme type', () => {
    skriv('Ild.cr2', 'original');
    catalog.sync();
    skriv('Ild 9 1.cr2', 'nummereret, samme type');
    skriv('Ild 7a.jpg', 'nummer med bogstav');
    skriv('Ild 10.dng', 'nummer');
    skriv('Ild-lumi.cr2', 'redigeret men samme type');
    skriv('Ild-lumi.tif', 'redigeret, anden type');
    catalog.sync();
    const rows = catalog.listVersions({});
    // Ild-lumi.cr2 og .tif hoerer sammen (samme navn); de andre er hver sit.
    expect(new Set(rows.map((r) => r.image_id)).size).toBe(5);
    expect(rows.filter((r) => r.version_count === 2)).toHaveLength(2);
    expect(rows.find((r) => r.rel_path === 'Ild-lumi.tif').is_master).toBe(0);
    expect(rows.find((r) => r.rel_path === 'Ild 9 1.cr2').is_master).toBe(1);
  });

  it('goer fejlagtigt stakkede versioner til egne billeder, og lader de rigtige staa', () => {
    skriv('Ild.cr2', 'original');
    catalog.sync();
    const master = catalog.listVersions({})[0];
    const nyFil = (rel) => catalog.db.run(
      'INSERT INTO files(rel_path, size, mtime, hash, present, created_at) VALUES(?,?,?,?,1,?)',
      rel, 5, 1, `h-${rel}`, 1
    ).lastInsertRowid;
    const stak = (rel, navn) => catalog.db.run(
      'INSERT INTO versions(image_id, file_id, name, is_master, rating, edited, created_at) VALUES(?,?,?,0,?,1,1)',
      master.image_id, nyFil(rel), navn, 'godkendt'
    );
    stak('Ild 9 1.cr2', '1');
    stak('Ild 7a.jpg', '7a');
    stak('Ild-lumi.tif', 'lumi');
    expect(catalog._afstakFejl()).toBe(2);
    const rows = catalog.listVersions({});
    expect(new Set(rows.map((r) => r.image_id)).size).toBe(3);
    const lumi = rows.find((r) => r.version_name === 'lumi');
    expect(lumi.version_count).toBe(2);
    const egen = rows.find((r) => r.rel_path === 'Ild 7a.jpg');
    expect(egen.is_master).toBe(1);
    expect(egen.rating).toBe('godkendt');
    expect(catalog._afstakFejl()).toBe(0); // en gang er nok
  });

  it('markerer forsvundne filer som fravaerende', () => {
    skriv('a.png', 'indhold');
    catalog.sync();
    rmSync(join(root, 'a.png'));
    catalog.sync();
    expect(catalog.listVersions({})).toHaveLength(0);
  });
});

describe('status og filtre', () => {
  beforeEach(() => {
    skriv('a.png', 'a');
    skriv('b.png', 'bb');
    skriv('c.png', 'ccc');
    catalog.sync();
  });

  it('kasserede skjules som standard', () => {
    const [a] = catalog.listVersions({});
    catalog.setRating([a.version_id], 'kasseret');
    expect(catalog.listVersions({})).toHaveLength(2);
    expect(catalog.listVersions({ visKasserede: true })).toHaveLength(3);
    expect(catalog.listVersions({ visKasserede: true, kunKasserede: true })).toHaveLength(1);
  });

  it('filtrerer paa godkendt, redigeres og faerdig', () => {
    // De to arbejdstrin ligger paa hver sit billede: et billede kan ikke
    // baade vaere under redigering og faerdigt.
    const rows = catalog.listVersions({});
    catalog.setRating([rows[0].version_id, rows[1].version_id, rows[2].version_id], 'godkendt');
    catalog.setStage([rows[1].version_id], 'edited');
    catalog.setStage([rows[2].version_id], 'finished');
    expect(catalog.listVersions({ kunGodkendte: true })).toHaveLength(3);
    expect(catalog.listVersions({ kunRedigerede: true })).toHaveLength(1);
    expect(catalog.listVersions({ kunFaerdige: true })).toHaveLength(1);
  });

  it('lader kun ét arbejdstrin gaelde ad gangen', () => {
    const [a] = catalog.listVersions({});
    catalog.setRating([a.version_id], 'godkendt');
    catalog.setStage([a.version_id], 'edited');
    expect(catalog.getVersion(a.version_id).edited).toBe(1);
    catalog.setStage([a.version_id], 'finished');
    const v = catalog.getVersion(a.version_id);
    expect(v.finished).toBe(1);
    expect(v.edited).toBe(0);
    catalog.setStage([a.version_id], null);
    expect(catalog.stageOf(catalog.getVersion(a.version_id))).toBe(null);
  });

  it('rydder faerdig naar filen aendres paa disken igen', () => {
    // Er der lige gemt en ny udgave, er arbejdet ikke overstaaet.
    const [a] = catalog.listVersions({});
    catalog.setRating([a.version_id], 'godkendt');
    catalog.setStage([a.version_id], 'finished');
    skriv('a.png', 'helt nyt indhold der giver en anden hash');
    catalog.sync();
    const v = catalog.getVersion(a.version_id);
    expect(v.edited).toBe(1);
    expect(v.finished).toBe(0);
  });

  it('afviser et ukendt arbejdstrin', () => {
    const [a] = catalog.listVersions({});
    expect(() => catalog.setStage([a.version_id], 'noget-andet')).toThrow(/Unknown workflow stage/);
  });

  it('rydder op i gamle kataloger hvor begge trin stod taendt', async () => {
    // Foer var de to uafhaengige flag, saa den tilstand ligger allerede i
    // Stefs katalog. Faerdig vinder ved aabning.
    const [a] = catalog.listVersions({});
    db.run('UPDATE versions SET edited=1, finished=1 WHERE id=?', a.version_id);
    db.close();
    await nyCatalog();
    const v = catalog.getVersion(a.version_id);
    expect(v.finished).toBe(1);
    expect(v.edited).toBe(0);
  });

  it('filtrerer paa mappe', () => {
    skriv('undermappe/d.png', 'dddd');
    catalog.sync();
    expect(catalog.listVersions({ folder: 'undermappe' })).toHaveLength(1);
    expect(catalog.listVersions({})).toHaveLength(4);
  });

  it('sorterer tal naturligt (2 foer 19 foer 199 foer 200)', () => {
    skriv('IMG_199.png', 'a199');
    skriv('IMG_20.png', 'a20');
    skriv('IMG_200.png', 'a200');
    skriv('IMG_2.png', 'a2');
    catalog.sync();
    const navne = catalog.listVersions({})
      .map((r) => r.rel_path)
      .filter((p) => p.startsWith('IMG_'));
    expect(navne).toEqual(['IMG_2.png', 'IMG_20.png', 'IMG_199.png', 'IMG_200.png']);
  });

  it('afviser ukendt bedoemmelse', () => {
    const [a] = catalog.listVersions({});
    expect(() => catalog.setRating([a.version_id], 'fantastisk')).toThrow();
  });
});

describe('virtuelle kopier', () => {
  it('opretter kopi der deler masterens fil', () => {
    skriv('foto.png', 'foto-indhold');
    catalog.sync();
    const [master] = catalog.listVersions({});
    const kopiId = catalog.createVirtualCopy(master.version_id);

    const rows = catalog.listVersions({});
    expect(rows).toHaveLength(2);
    const kopi = rows.find((r) => r.version_id === kopiId);
    expect(kopi.is_master).toBe(0);
    expect(kopi.file_id).toBe(master.file_id); // samme fil indtil materialisering
    expect(kopi.version_name).toBe('Kopi 1');
  });

  it('materialisering laver en fysisk kopi ved siden af originalen', () => {
    skriv('foto.png', 'foto-indhold');
    catalog.sync();
    const [master] = catalog.listVersions({});
    const kopiId = catalog.createVirtualCopy(master.version_id);

    const nySti = catalog.materializeVersion(kopiId);
    expect(existsSync(nySti)).toBe(true);
    expect(readFileSync(nySti, 'utf8')).toBe('foto-indhold');

    const kopi = catalog.getVersion(kopiId);
    expect(kopi.file_id).not.toBeNull();
    // Kopien beholder sin egen status og fil efter endnu en sync.
    catalog.sync();
    expect(catalog.listVersions({})).toHaveLength(2);
  });

  it('kopiens status er uafhaengig af masterens', () => {
    skriv('foto.png', 'x');
    catalog.sync();
    const [master] = catalog.listVersions({});
    const kopiId = catalog.createVirtualCopy(master.version_id);
    catalog.setRating([kopiId], 'godkendt');
    catalog.setRating([master.version_id], 'kasseret');

    const rows = catalog.listVersions({ visKasserede: true });
    expect(rows.find((r) => r.version_id === kopiId).rating).toBe('godkendt');
    expect(rows.find((r) => r.version_id === master.version_id).rating).toBe('kasseret');
  });

  it('sletning af materialiseret kopi returnerer filstien', () => {
    skriv('foto.png', 'x');
    catalog.sync();
    const [master] = catalog.listVersions({});
    const kopiId = catalog.createVirtualCopy(master.version_id);
    const sti = catalog.materializeVersion(kopiId);
    const returneret = catalog.deleteVersion(kopiId);
    expect(returneret).toBe(sti);
    expect(catalog.listVersions({})).toHaveLength(1);
  });

  it('masterversionen kan ikke slettes', () => {
    skriv('foto.png', 'x');
    catalog.sync();
    const [master] = catalog.listVersions({});
    expect(() => catalog.deleteVersion(master.version_id)).toThrow();
  });
});

describe('serier', () => {
  it('kan oprettes, tildeles og filtreres', () => {
    skriv('a.png', 'a');
    skriv('b.png', 'bb');
    catalog.sync();
    const [a] = catalog.listVersions({});
    const serieId = catalog.createSeries('Circular Blues');
    catalog.assignSeries([a.image_id], serieId);

    expect(catalog.listSeries()).toEqual([
      {
        id: serieId, name: 'Circular Blues', intro: null, template: null, colour: null, image_count: 1,
      },
    ]);
    const filtreret = catalog.listVersions({ serieId });
    expect(filtreret).toHaveLength(1);
    expect(filtreret[0].series_name).toBe('Circular Blues');
  });

  it('samme navn genbruger serien', () => {
    const id1 = catalog.createSeries('Glazz');
    const id2 = catalog.createSeries('Glazz');
    expect(id1).toBe(id2);
  });
});

describe('mapper og flytning', () => {
  it('opretter mapper og flytter filer med katalog-opdatering', () => {
    skriv('a.png', 'a-indhold');
    catalog.sync();
    const [a] = catalog.listVersions({});

    const rel = catalog.createFolder('', 'Udvalgte');
    expect(rel).toBe('Udvalgte');
    const flyttet = catalog.moveFiles([a.file_id], 'Udvalgte');
    expect(flyttet).toHaveLength(1);
    expect(flyttet[0]).toMatchObject({ fromDir: '', toDir: 'Udvalgte' });
    expect(existsSync(join(root, 'Udvalgte', 'a.png'))).toBe(true);

    const rows = catalog.listVersions({});
    expect(rows[0].rel_path).toBe('Udvalgte/a.png');
    // En efterfoelgende sync maa ikke aendre noget.
    catalog.sync();
    expect(catalog.listVersions({})).toHaveLength(1);
  });

  it('undgaar navnekollision ved flytning', () => {
    skriv('a.png', 'original');
    skriv('m/a.png', 'anden fil');
    catalog.sync();
    const rows = catalog.listVersions({});
    const rod = rows.find((r) => r.rel_path === 'a.png');
    catalog.moveFiles([rod.file_id], 'm');
    const efter = catalog.listVersions({});
    const stier = efter.map((r) => r.rel_path).sort();
    expect(stier).toEqual(['m/a 2.png', 'm/a.png']);
  });

  it('Ryd op flytter kun filer hvor alle versioner er kasseret', () => {
    skriv('kasseret.png', 'k');
    skriv('blandet.png', 'bl');
    catalog.sync();
    const rows = catalog.listVersions({});
    const kass = rows.find((r) => r.rel_path === 'kasseret.png');
    const blandet = rows.find((r) => r.rel_path === 'blandet.png');
    catalog.setRating([kass.version_id], 'kasseret');
    // blandet: master kasseret men virtuel kopi godkendt -> maa ikke flyttes
    const kopiId = catalog.createVirtualCopy(blandet.version_id);
    catalog.setRating([blandet.version_id], 'kasseret');
    catalog.setRating([kopiId], 'godkendt');

    const n = catalog.moveDiscarded();
    expect(n).toHaveLength(1);
    expect(existsSync(join(root, 'Discarded', 'kasseret.png'))).toBe(true);
    expect(existsSync(join(root, 'blandet.png'))).toBe(true);
  });

  it('mappetraeet taeller undermapper med', () => {
    // Tallet skal vise det samme som et klik paa mappen, og et klik
    // filtrerer paa "mappe/%", altsaa inklusive undermapper. Foer blev
    // der taldt filer i mappen selv, saa tal og visning kunne afvige.
    skriv('a.png', 'a');
    skriv('m1/b.png', 'b');
    skriv('m1/m2/c.png', 'c');
    catalog.sync();
    const tree = catalog.folderTree();
    expect(tree.count).toBe(3);
    const m1 = tree.children.find((c) => c.name === 'm1');
    expect(m1.count).toBe(2);
    expect(m1.children[0].count).toBe(1);
    expect(catalog.listVersions({ folder: 'm1', visKasserede: true })).toHaveLength(2);
  });

  it('mappetraeet taeller pr. bedoemmelse', () => {
    skriv('m1/a.png', 'a');
    skriv('m1/b.png', 'b');
    skriv('m1/c.png', 'c');
    catalog.sync();
    const ver = (rel) => catalog.listVersions({ visKasserede: true })
      .find((r) => r.rel_path === rel).version_id;
    catalog.setRating([ver('m1/a.png')], 'godkendt');
    catalog.setRating([ver('m1/b.png')], 'kandidat');
    catalog.setRating([ver('m1/c.png')], 'kasseret');
    const m1 = catalog.folderTree().children.find((c) => c.name === 'm1');
    expect(m1.counts).toEqual({ godkendt: 1, kandidat: 1, kasseret: 1, ubedomt: 0 });
  });

  it('taeller virtuelle kopier med, ligesom grid\'et', () => {
    // Der taelles versioner og ikke filer: en virtuel kopi er sin egen
    // flise i grid'et og skal derfor ogsaa taelle med i mappen.
    skriv('m1/a.png', 'a');
    catalog.sync();
    const foer = catalog.folderTree().children.find((c) => c.name === 'm1');
    expect(foer.count).toBe(1);
    const ver = catalog.listVersions({}).find((r) => r.rel_path === 'm1/a.png');
    catalog.createVirtualCopy(ver.version_id);
    const efter = catalog.folderTree().children.find((c) => c.name === 'm1');
    expect(efter.count).toBe(2);
  });
});

describe('embeddings og noegleord', () => {
  it('gemmer og genlaeser embeddings', () => {
    skriv('a.png', 'a');
    catalog.sync();
    const [a] = catalog.listVersions({});
    const vec = Float32Array.from([0.5, 0.25, -0.5]);
    catalog.saveEmbedding(a.file_id, 'test-model', vec);

    expect(catalog.filesNeedingEmbedding('test-model')).toHaveLength(0);
    const alle = catalog.allEmbeddings('test-model');
    expect(alle).toHaveLength(1);
    const genlaest = new Float32Array(alle[0].vec.buffer, alle[0].vec.byteOffset, alle[0].dim);
    expect([...genlaest]).toEqual([0.5, 0.25, -0.5]);
  });

  it('noegleord kan gemmes og bruges som filter', () => {
    skriv('a.png', 'a');
    skriv('b.png', 'bb');
    catalog.sync();
    const rows = catalog.listVersions({});
    catalog.saveKeywords(rows[0].file_id, [
      { word: 'gul blomst', score: 0.31 },
      { word: 'makro', score: 0.24 },
    ]);
    expect(catalog.topKeywords()[0].word).toBe('gul blomst');
    expect(catalog.listVersions({ keyword: 'gul blomst' })).toHaveLength(1);
    expect(catalog.keywordsForFile(rows[0].file_id)).toHaveLength(2);
  });
});

describe('serier', () => {
  function toBilleder() {
    skriv('a.png', 'a');
    skriv('b.png', 'bb');
    catalog.sync();
    return catalog.listVersions({});
  }

  it('kan omdoebes, og billederne foelger med', () => {
    const rows = toBilleder();
    const id = catalog.createSeries('Circular Blues');
    catalog.assignSeries([rows[0].image_id], id);
    catalog.renameSeries(id, 'Glazz');
    const serier = catalog.listSeries();
    expect(serier).toHaveLength(1);
    expect(serier[0]).toMatchObject({ name: 'Glazz', image_count: 1 });
    expect(catalog.listVersions({ serieId: id })).toHaveLength(1);
  });

  it('afviser et tomt navn og et navn der allerede findes', () => {
    toBilleder();
    const a = catalog.createSeries('Allura');
    catalog.createSeries('Seagully');
    expect(() => catalog.renameSeries(a, '   ')).toThrow(/needs a name/);
    expect(() => catalog.renameSeries(a, 'Seagully')).toThrow(/already exists/);
    expect(catalog.listSeries().map((s) => s.name).sort()).toEqual(['Allura', 'Seagully']);
  });

  it('at slette en serie lader billederne vaere i fred', () => {
    const rows = toBilleder();
    const id = catalog.createSeries('Circular Blues');
    catalog.assignSeries([rows[0].image_id, rows[1].image_id], id);
    catalog.deleteSeries(id);
    expect(catalog.listSeries()).toEqual([]);
    // Billederne bliver liggende; de mister kun tilknytningen.
    expect(catalog.listVersions({})).toHaveLength(2);
    expect(catalog.listVersions({ serieId: id })).toEqual([]);
  });
});

describe('mappedrevet arbejdsgang', () => {
  beforeEach(() => {
    catalog.mappestyring = true;
  });

  const raekke = (rel) => catalog.listVersions({ visKasserede: true }).find((r) => r.rel_path === rel);

  it('et godkendt billede faar sin arbejdsmappe, og originalen flyttes ind', () => {
    skriv('Import/Desert Canyon.cr2', 'original');
    catalog.sync();
    const r = raekke('Import/Desert Canyon.cr2');
    catalog.setRating([r.version_id], 'godkendt');
    const rel = 'Approved/Desert Canyon/Originals/Desert Canyon.cr2';
    expect(existsSync(join(root, rel))).toBe(true);
    expect(existsSync(join(root, 'Import/Desert Canyon.cr2'))).toBe(false);
    for (const d of ['Originals', 'Edits', 'Masters', 'Print files']) {
      expect(existsSync(join(root, 'Approved/Desert Canyon', d))).toBe(true);
    }
    expect(raekke(rel).rating).toBe('godkendt');
  });

  it('en fil i Edits bliver en version under redigering, en i Masters goer vaerket faerdigt', () => {
    skriv('a.cr2', 'original');
    catalog.sync();
    catalog.setRating([raekke('a.cr2').version_id], 'godkendt');
    skriv('Approved/a/Edits/helt-andet-navn.tif', 'redigeret');
    catalog.sync();
    let rows = catalog.listVersions({});
    expect(new Set(rows.map((r) => r.image_id)).size).toBe(1);
    const edit = rows.find((r) => r.rel_path.endsWith('Edits/helt-andet-navn.tif'));
    expect(edit.is_master).toBe(0);
    expect(edit.rating).toBe('godkendt');
    expect(edit.edited).toBe(1);

    skriv('Approved/a/Masters/a master.tif', 'master');
    skriv('Approved/a/Print files/a 1-1.tif', 'til tryk');
    catalog.sync();
    rows = catalog.listVersions({});
    expect(rows).toHaveLength(3); // Print files er ikke billeder at sortere
    const master = rows.find((r) => r.rel_path.endsWith('Masters/a master.tif'));
    expect(master.version_name).toBe('Master');
    expect(master.finished).toBe(1);
    const original = rows.find((r) => r.is_master);
    expect(original.finished).toBe(1);
    expect(original.edited).toBe(0);
  });

  it('Candidate og Discarded flytter filen og bevarer undermappen, Clear henter den tilbage', () => {
    skriv('Ahl Strand/x.cr2', 'x');
    catalog.sync();
    const v = raekke('Ahl Strand/x.cr2').version_id;
    catalog.setRating([v], 'kandidat');
    expect(existsSync(join(root, 'Candidate/Ahl Strand/x.cr2'))).toBe(true);
    catalog.setRating([v], 'kasseret');
    expect(existsSync(join(root, 'Discarded/Ahl Strand/x.cr2'))).toBe(true);
    expect(existsSync(join(root, 'Candidate/Ahl Strand/x.cr2'))).toBe(false);
    catalog.setRating([v], 'ubedomt');
    expect(existsSync(join(root, 'Import/Ahl Strand/x.cr2'))).toBe(true);
  });

  it('en ubedoemt fil uden for de styrede mapper bliver liggende', () => {
    skriv('Ahl Strand/y.cr2', 'y');
    catalog.sync();
    catalog.setRating([raekke('Ahl Strand/y.cr2').version_id], 'ubedomt');
    expect(existsSync(join(root, 'Ahl Strand/y.cr2'))).toBe(true);
  });

  it('arbejdstrin findes kun paa godkendte billeder', () => {
    skriv('z.cr2', 'z');
    catalog.sync();
    const id = raekke('z.cr2').version_id;
    catalog.setStage([id], 'edited'); // ubedoemt: ingen virkning
    expect(catalog.stageOf(catalog.getVersion(id))).toBe(null);
    catalog.setRating([id], 'godkendt');
    const nyId = raekke('Approved/z/Originals/z.cr2').version_id;
    catalog.setStage([nyId], 'finished');
    expect(catalog.stageOf(catalog.getVersion(nyId))).toBe('finished');
    catalog.setRating([nyId], 'kandidat'); // forlader Approved: trinnet ryddes
    expect(catalog.stageOf(catalog.getVersion(nyId))).toBe(null);
  });
});

describe('gitterets raekkefoelge', () => {
  it('et billede bliver paa sin plads, selv om en bedoemmelse flytter filen til en anden mappe', () => {
    catalog.mappestyring = true;
    for (const n of ['a', 'b', 'c']) skriv(`${n}.cr2`, n);
    catalog.sync();
    const navne = () => catalog.listVersions({ visKasserede: true }).map((r) => r.rel_path.split('/').pop());
    expect(navne()).toEqual(['a.cr2', 'b.cr2', 'c.cr2']);
    const b = catalog.listVersions({}).find((r) => r.rel_path === 'b.cr2');
    catalog.setRating([b.version_id], 'kandidat');
    catalog.setRating([b.version_id], 'godkendt');
    catalog.setRating([b.version_id], 'ubedomt');
    expect(navne()).toEqual(['a.cr2', 'b.cr2', 'c.cr2']);
  });
});
