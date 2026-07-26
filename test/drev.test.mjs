// Billederne ligger paa eksterne diske, saa et drev der ikke er
// tilsluttet er hverdag og ikke et saertilfaelde. Uden vaern ser en
// afmonteret disk ud praecis som en tom mappe, og en synkronisering
// ville markere hele biblioteket som forsvundet.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { libraryAvailable, dataDirFor } from '../electron/lib/util.mjs';

let root;
let db;
let catalog;

function skriv(rel, indhold) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, indhold);
  return abs;
}

// Efterligner at et eksternt drev tages ud: roden findes ikke laengere,
// men den aabne databasefil lever videre paa sit inode.
function afmonter() {
  const væk = `${root}-afmonteret`;
  renameSync(root, væk);
  return væk;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'art-triage-drev-'));
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
});

afterEach(() => {
  try { db.close(); } catch { /* allerede lukket */ }
  rmSync(root, { recursive: true, force: true });
  rmSync(`${root}-afmonteret`, { recursive: true, force: true });
});

describe('libraryAvailable', () => {
  it('siger ja til en mappe der findes', () => {
    expect(libraryAvailable(root)).toBe(true);
  });

  it('siger nej til en sti der ikke findes', () => {
    expect(libraryAvailable(join(root, 'findes-ikke'))).toBe(false);
  });

  it('siger nej til en fil, da et bibliotek skal vaere en mappe', () => {
    const fil = skriv('a.png', 'indhold-a');
    expect(libraryAvailable(fil)).toBe(false);
  });
});

describe('synkronisering med frakoblet drev', () => {
  it('melder fra og lader billederne staa', () => {
    skriv('a.png', 'indhold-a');
    skriv('mappe/b.jpg', 'indhold-b');
    catalog.sync();
    expect(catalog.listVersions({})).toHaveLength(2);

    const væk = afmonter();
    try {
      const res = catalog.sync();
      expect(res.unavailable).toBe(true);
      expect(res.changed).toBe(0);
      // Det afgoerende: listen henter kun filer med present=1, saa hvis
      // synkroniseringen havde koert, ville grid'et staa tomt.
      expect(catalog.listVersions({})).toHaveLength(2);
    } finally {
      renameSync(væk, root);
    }
  });

  it('bevarer bedoemmelser mens drevet er ude', () => {
    skriv('a.png', 'indhold-a');
    catalog.sync();
    const [row] = catalog.listVersions({});
    catalog.setRating([row.version_id], 'godkendt');

    const væk = afmonter();
    try {
      catalog.sync();
    } finally {
      renameSync(væk, root);
    }
    const efter = catalog.listVersions({});
    expect(efter).toHaveLength(1);
    expect(efter[0].rating).toBe('godkendt');
  });

  it('tager nye filer med naar drevet er tilbage', () => {
    skriv('a.png', 'indhold-a');
    catalog.sync();

    const væk = afmonter();
    expect(catalog.sync().unavailable).toBe(true);
    renameSync(væk, root);

    // Filer lagt paa drevet mens det var ude skal fanges af naeste
    // skanning; det er praecis det uret og "Skan igen" er til for.
    skriv('c.png', 'indhold-c');
    const res = catalog.sync();
    expect(res.unavailable).toBe(false);
    expect(catalog.listVersions({}).map((r) => r.rel_path).sort()).toEqual(['a.png', 'c.png']);
  });
});

describe('katalogmappen ved navneskiftet', () => {
  // Egen tom mappe pr. test: den faelles root har allerede et katalog
  // fra beforeEach, og saa ville svaret vaere givet paa forhaand.
  let tom;
  beforeEach(() => { tom = mkdtempSync(join(tmpdir(), 'art-triage-dir-')); });
  afterEach(() => rmSync(tom, { recursive: true, force: true }));

  it('bruger .art-triage i et nyt bibliotek', () => {
    expect(dataDirFor(tom)).toBe(join(tom, '.art-triage'));
  });

  it('bliver ved med at bruge .billedflow hvis den findes', () => {
    // Et bibliotek fra dengang appen hed Billedflow. Bedoemmelser paa
    // tusindvis af billeder ligger her og maa ikke blive vaek.
    mkdirSync(join(tom, '.billedflow'), { recursive: true });
    expect(dataDirFor(tom)).toBe(join(tom, '.billedflow'));
  });

  it('foretraekker .art-triage hvis begge findes', () => {
    mkdirSync(join(tom, '.billedflow'), { recursive: true });
    mkdirSync(join(tom, '.art-triage'), { recursive: true });
    expect(dataDirFor(tom)).toBe(join(tom, '.art-triage'));
  });

  it('holder begge mapper ude af billedskanningen', () => {
    mkdirSync(join(root, '.billedflow'), { recursive: true });
    writeFileSync(join(root, '.billedflow', 'gammel.png'), 'x');
    writeFileSync(join(root, '.art-triage', 'ny.png'), 'x');
    skriv('rigtig.png', 'billede');
    catalog.sync();
    expect(catalog.listVersions({}).map((r) => r.rel_path)).toEqual(['rigtig.png']);
  });
});
