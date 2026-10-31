// Katalogmotoren: holder databasen i sync med mappen paa disken og ejer
// al logik om billeder, versioner (virtuelle kopier), status, serier og
// filflytning. GUI-lag og AI-lag taler kun med denne klasse.
import { EventEmitter } from 'node:events';
import {
  copyFileSync, mkdirSync, renameSync, existsSync, statSync, readdirSync, rmdirSync, rmSync,
} from 'node:fs';
import { join, dirname, basename, extname, posix } from 'node:path';
import { exifTid } from './exif.mjs';
import { printfilNavn } from './printfil.mjs';
import {
  walkImages, walkImagesAsync, walkDirs, findImportMappe, beskaeringFraSti, navnMedBeskaering,
  editorFraSti, masterNavn, quickHash, quickHashAsync, mapGraense, stemOf, slug, uniquePath, extOf, daCollator,
  libraryAvailable,
} from './util.mjs';

// Hvornaar en fil er en redigeret udgave af en anden og skal stakkes som
// version af den. Begge krav skal vaere opfyldt:
//  1. Filtypen er en anden end originalens (IMG.CR2 og IMG-lumi.tif, ikke
//     "Ild 9.CR2" og "Ild 9 1.CR2").
//  2. Det der staar efter originalens navn ligner en redigering: et ord paa
//     mindst to bogstaver (-lumi, _edit, -gigapixel) eller v1, v2. Et tal
//     eller ét bogstav (7a, 1, 10) er nummerering, ikke redigering.
export function erRedigeretUdgave(suffiks, ext, masterExt) {
  if (String(ext).toLowerCase() === String(masterExt).toLowerCase()) return false;
  const tekst = String(suffiks).replace(/^[-_. ()]+|[)]+$/g, '');
  return /[a-zA-Z\u00c0-\u024f]{2,}/.test(tekst) || /^v\d+$/i.test(tekst);
}

// Den mappedrevne struktur. Bedoemmelsen bestemmer hvilken mappe en fil
// ligger i, og et godkendt billede faar sin egen arbejdsmappe:
//   Approved/<filnavn>/Original | Edits | Master | Print files
export const BEDOEMMELSESMAPPE = {
  ubedomt: 'Import', godkendt: 'Approved', kandidat: 'Candidate', kasseret: 'Discarded',
};
export const ARBEJDSMAPPER = ['Original', 'Edits', 'Master', 'Print files'];
// Navnene foer 0.16: Originals blev til Original og Masters til Master.
// En tom mappe i Import slettes ved en skanning, naar den har staaet
// uroert saa laenge.
const TOM_MAPPE_ALDER_MS = 10 * 60 * 1000;
const GAMLE_ARBEJDSMAPPER = [['Originals', 'Original'], ['Masters', 'Master']];

// "Approved/Desert/Edits/x.tif" -> { work: 'Desert', del: 'Edits' }, ellers null.
export function arbejdsmappeFor(rel) {
  const m = /^Approved\/([^/]+)\/(Original|Edits|Master|Print files)\//.exec(rel);
  return m ? { work: m[1], del: m[2] } : null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_path TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  hash TEXT,
  present INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS series(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS images(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  series_id INTEGER REFERENCES series(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  is_master INTEGER NOT NULL DEFAULT 0,
  rating TEXT NOT NULL DEFAULT 'ubedomt',
  edited INTEGER NOT NULL DEFAULT 0,
  finished INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS embeddings(
  file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vec BLOB NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS keywords(
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  score REAL NOT NULL,
  manual INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(file_id, word)
);
-- Kvittering for at en fil har vaeret sendt til Claude. Uden den kan en
-- fil der ikke gav nogen ord ikke skelnes fra en der aldrig er sendt, og
-- koeren ville sende den igen hver gang og betale for det hver gang.
CREATE TABLE IF NOT EXISTS keyword_runs(
  file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  words INTEGER NOT NULL,
  run_at INTEGER NOT NULL
);
-- Vaerkets tekster og shop-felter (docs/plan-shop.md). Et vaerk er et
-- billede; raekken oprettes foerste gang billedet aabnes i vaerk-panelet.
-- Tomme felter er tomme i databasen; standardvaerdierne (titel fra
-- filnavnet, aar fra EXIF) regnes ud naar vaerket laeses.
CREATE TABLE IF NOT EXISTS works(
  image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
  title TEXT,
  year INTEGER,
  exif_year INTEGER,
  exif_checked INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  technique TEXT,
  template TEXT NOT NULL DEFAULT 'spread',
  section_colour TEXT,
  catalogue_number TEXT,
  video TEXT,
  prints INTEGER NOT NULL DEFAULT 0,
  dimensions TEXT,
  price TEXT,
  notes TEXT,
  description TEXT,
  short_text TEXT,
  alt_text TEXT,
  generated TEXT,
  woo_product_id INTEGER,
  updated_at INTEGER NOT NULL
);
-- Hvilken version der er hvilken beskaering. En version har hoejst ét
-- format, og et format peger hoejst paa én version pr. vaerk.
CREATE TABLE IF NOT EXISTS work_crops(
  version_id INTEGER PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  UNIQUE(image_id, format)
);
-- Hvad der allerede er uploadet til WordPress' mediebibliotek, og af
-- hvilken udgave af filen. Aendres filen ikke, uploades den ikke igen.
CREATE TABLE IF NOT EXISTS work_media(
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  source_key TEXT NOT NULL,
  media_id INTEGER NOT NULL,
  source_url TEXT,
  alt TEXT,
  PRIMARY KEY(image_id, role)
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_versions_image ON versions(image_id);
CREATE INDEX IF NOT EXISTS idx_versions_file ON versions(file_id);
CREATE INDEX IF NOT EXISTS idx_keywords_word ON keywords(word);
`;

// De filer mindst én version peger paa, med en bestemt vurdering. Den staar
// som sin egen, materialiserede maengde. Skrevet som EXISTS (... WHERE
// COALESCE(v.file_id, i.master_file_id) = f.id ...) kan udtrykket ikke bruge
// noget indeks, og databasen laeste alle versioner igennem for hver eneste
// fil: ved 15.000 billeder tog noegleordslisten 70 sekunder og koeen til
// analyse 19, og de koerte i hovedprocessen ved hver aendring.
function effektiveFiler(betingelse) {
  return `SELECT DISTINCT COALESCE(v.file_id, i.master_file_id) AS fid
          FROM versions v JOIN images i ON i.id = v.image_id
          WHERE ${betingelse}`;
}

// To filer gemt inden for samme sekund regnes for lige gamle, saa en kopi
// der er lavet lige efter sin kilde, ikke ser foraeldet ud.
const FORAELDET_MS = 2000;

export class Catalog extends EventEmitter {
  constructor(db, root) {
    super();
    this.db = db;
    this.root = root;
    // Slaas til af sessionen: bedoemmelsen flytter saa ogsaa filen til sin mappe.
    this.mappestyring = false;
    // Mappen med det der ikke er sorteret endnu. Staar der en Import i roden
    // (ogsaa " Import" med mellemrum), laeses kun den og de tre bedoemte
    // mapper; alt andet i roden, fx SoMe, ignoreres.
    this.importMappe = 'Import';
    this.inkluder = null;
    db.exec(SCHEMA);
    this._migrate();
  }

  // Skemamigreringer for biblioteker oprettet med aeldre versioner.
  _migrate() {
    const kolonner = this.db.all('PRAGMA table_info(keywords)').map((k) => k.name);
    if (!kolonner.includes('manual')) {
      this.db.exec('ALTER TABLE keywords ADD COLUMN manual INTEGER NOT NULL DEFAULT 0');
    }
    // Seriens felter til shoppen (taksonomien series paa shop.stefg.art).
    // Skabelonen er tom indtil Stef vaelger den, saa en eksisterende term
    // i Woo ikke faar sin skabelon overskrevet af en standardvaerdi.
    const serieKolonner = this.db.all('PRAGMA table_info(series)').map((k) => k.name);
    for (const kol of ['intro', 'template', 'colour']) {
      if (!serieKolonner.includes(kol)) this.db.exec(`ALTER TABLE series ADD COLUMN ${kol} TEXT`);
    }
    // auto: serien er lavet af appen ud fra titlerne (autoSerier). Serier fra
    // foer kolonnen fandtes, og som ingen felter har, regnes for automatiske,
    // saa en serie paa ét vaerk som "Mur" kan ryddes op.
    if (!serieKolonner.includes('auto')) {
      this.db.exec('ALTER TABLE series ADD COLUMN auto INTEGER NOT NULL DEFAULT 0');
      this.db.exec('UPDATE series SET auto=1 WHERE intro IS NULL AND template IS NULL AND colour IS NULL');
    }
    // En drejning man selv har lagt paa et billede, naar automatikken
    // tager fejl: 0, 90, 180 eller 270 grader med uret.
    const filKolonner = this.db.all('PRAGMA table_info(files)').map((k) => k.name);
    if (!filKolonner.includes('rotation')) {
      this.db.exec('ALTER TABLE files ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0');
    }
    // Aeldre versioner stakkede alle filer hvis navn begyndte med et andet
    // navn (Ild 9 1.CR2 under Ild 9.dng). De der ikke opfylder den nuvaerende
    // regel, gøres til egne billeder én gang.
    const version = Number(this.db.get('PRAGMA user_version')?.user_version ?? 0);
    if (version < 1) {
      this._afstakFejl();
      this.db.exec('PRAGMA user_version = 1');
    }
    // Arbejdstrin gælder kun godkendte billeder. Tidligere kunne alt faa
    // "Being edited", ogsaa ubedoemte filer, og det ryddes én gang.
    if (version < 2) {
      this.db.exec("UPDATE versions SET edited=0, finished=0 WHERE rating != 'godkendt'");
      this.db.exec('PRAGMA user_version = 2');
    }
    // Billeder med en fil i Edits har Edits, ogsaa naar programmet ikke kendes,
    // og det har originalen ogsaa (medmindre vaerket er faerdigt).
    if (version < 3) {
      this.db.exec(`UPDATE versions SET edited=1
        WHERE rating='godkendt' AND finished=0 AND file_id IN
          (SELECT id FROM files WHERE rel_path LIKE 'Approved/%/Edits/%')`);
      this.db.exec(`UPDATE versions SET edited=1
        WHERE rating='godkendt' AND finished=0 AND is_master=1 AND image_id IN
          (SELECT v.image_id FROM versions v JOIN files f ON f.id = v.file_id
           WHERE f.rel_path LIKE 'Approved/%/Edits/%')`);
      this.db.exec('PRAGMA user_version = 3');
    }
    // Optagetidspunktet fra EXIF, til filmstrippen. Hentes foerst naar det
    // skal bruges: NULL er ikke laest endnu, -1 er ingen dato i filen.
    const filKolonner2 = this.db.all('PRAGMA table_info(files)').map((k) => k.name);
    if (!filKolonner2.includes('taken_at')) {
      this.db.exec('ALTER TABLE files ADD COLUMN taken_at INTEGER');
    }
    // Hvilket program en version er redigeret i (Luminar Neo, Topaz Photo AI
    // ...). Navnene kommer fra editor-listen i appen, aldrig fra appen selv.
    const versionKolonner = this.db.all('PRAGMA table_info(versions)').map((k) => k.name);
    if (!versionKolonner.includes('editor')) {
      this.db.exec('ALTER TABLE versions ADD COLUMN editor TEXT');
    }
    // Produktets status i shoppen ('draft', 'publish' ...). Et publiceret
    // vaerk staar i fase 6 og ikke laengere i 3 til 5.
    const vaerkKolonner = this.db.all('PRAGMA table_info(works)').map((k) => k.name);
    if (!vaerkKolonner.includes('woo_status')) {
      this.db.exec('ALTER TABLE works ADD COLUMN woo_status TEXT');
    }
    // Fingeraftrykket af det, der sidst blev sendt til shoppen. Er vaerket
    // aendret siden, viser appen, at shoppen skal opdateres.
    if (!vaerkKolonner.includes('woo_aftryk')) {
      this.db.exec('ALTER TABLE works ADD COLUMN woo_aftryk TEXT');
    }
    // Det program et billede senest blev aabnet i, saa en fil der dukker op i
    // Edits kan faa det som status.
    this.db.exec(`CREATE TABLE IF NOT EXISTS editor_log(
      image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
      editor TEXT NOT NULL,
      opened_at INTEGER NOT NULL
    )`);
    // Gigapixel hed foer "Topaz Gigapixel AI" i appen.
    this.db.run("UPDATE versions SET editor='Topaz Gigapixel' WHERE editor='Topaz Gigapixel AI'");
    this.db.run("UPDATE editor_log SET editor='Topaz Gigapixel' WHERE editor='Topaz Gigapixel AI'");
    // De to trin var foer uafhaengige flag, saa et billede kunne staa som
    // baade under redigering og faerdigt. Faerdig vinder: det er det trin
    // man selv har sat sidst, og det er den tilstand der betyder noget.
    this.db.exec('UPDATE versions SET edited=0 WHERE edited=1 AND finished=1');
  }

  // Goer de versioner der er stakket ved en fejl til egne billeder. Kun
  // versioner med en egen fil (fundet ved en skanning) roeres, aldrig
  // virtuelle kopier. Filerne paa disken roeres ikke. Returnerer antallet.
  _afstakFejl() {
    const raekker = this.db.all(
      `SELECT v.id AS vid, v.rating, v.image_id, f.id AS fid, f.rel_path AS rel,
              m.rel_path AS master_rel, i.series_id
       FROM versions v
       JOIN files f ON f.id = v.file_id
       JOIN images i ON i.id = v.image_id
       JOIN files m ON m.id = i.master_file_id
       WHERE v.is_master = 0 AND v.file_id IS NOT NULL`
    );
    let antal = 0;
    this.db.transaction(() => {
      for (const r of raekker) {
        const stem = stemOf(posix.basename(r.rel));
        const mStem = stemOf(posix.basename(r.master_rel));
        // Samme navn og anden filtype hoerer sammen, og noget der slet ikke
        // begynder med originalens navn er flyttet af brugeren: begge lades.
        if (stem === mStem || !stem.startsWith(mStem)) continue;
        if (erRedigeretUdgave(stem.slice(mStem.length), extOf(r.rel), extOf(r.master_rel))) continue;
        const imageId = this.db.run(
          'INSERT INTO images(master_file_id, series_id, created_at) VALUES(?,?,?)',
          r.fid, r.series_id ?? null, this.now()
        ).lastInsertRowid;
        this.db.run(
          'INSERT INTO versions(image_id, file_id, name, is_master, rating, created_at) VALUES(?,NULL,?,1,?,?)',
          imageId, 'Original', r.rating, this.now()
        );
        this.db.run('DELETE FROM versions WHERE id=?', r.vid);
        antal += 1;
      }
    });
    return antal;
  }

  // Slaar den mappedrevne arbejdsgang til for et bibliotek, og finder Import.
  brugMappestruktur() {
    this.mappestyring = true;
    this._omdoebArbejdsmapper();
    const fundet = findImportMappe(this.root);
    if (fundet) {
      this.importMappe = fundet;
      this.inkluder = new Set([fundet, 'Approved', 'Candidate', 'Discarded']);
    }
  }

  // Arbejdsmapperne hed foer Originals og Masters. De omdoebes paa disken
  // til Original og Master, og stierne i kataloget foelger med, saa
  // bedoemmelser, serier og tekster bliver hos filerne. Findes den nye mappe
  // allerede, flyttes filerne over én ad gangen; en fil der allerede findes
  // dér, bliver liggende i den gamle mappe.
  _omdoebArbejdsmapper() {
    const approved = join(this.root, 'Approved');
    let vaerker;
    try {
      vaerker = readdirSync(approved, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return 0;
    }
    let antal = 0;
    for (const work of vaerker) {
      for (const [gammel, ny] of GAMLE_ARBEJDSMAPPER) {
        const fra = join(approved, work, gammel);
        if (!existsSync(fra)) continue;
        const til = join(approved, work, ny);
        try {
          if (!existsSync(til)) {
            renameSync(fra, til);
          } else {
            for (const navn of readdirSync(fra)) {
              if (!existsSync(join(til, navn))) renameSync(join(fra, navn), join(til, navn));
            }
            rmSync(join(fra, '.DS_Store'), { force: true });
            try { rmdirSync(fra); } catch { /* der ligger stadig noget */ }
          }
        } catch {
          continue;
        }
        const praefiks = `Approved/${work}/${gammel}/`;
        const rows = this.db.all(
          "SELECT id, rel_path FROM files WHERE rel_path LIKE ? ESCAPE '\\'", `${escapeLike(praefiks)}%`
        );
        for (const r of rows) {
          const nyRel = `Approved/${work}/${ny}/${r.rel_path.slice(praefiks.length)}`;
          if (!existsSync(this.abs(nyRel))) continue;
          try {
            this.db.run('UPDATE files SET rel_path=? WHERE id=?', nyRel, r.id);
            antal += 1;
          } catch {
            // Stien findes allerede i kataloget; skanningen rydder op.
          }
        }
      }
    }
    return antal;
  }

  _styredeTopmapper() {
    return [this.importMappe, 'Candidate', 'Discarded', 'Approved'];
  }

  _topFor(rating) {
    return rating === 'ubedomt' ? this.importMappe : BEDOEMMELSESMAPPE[rating];
  }

  abs(rel) {
    return join(this.root, rel);
  }

  now() {
    return Date.now();
  }

  // ---------- Scanning og synkronisering ----------

  // Koerer en fuld afstemning mellem disk og database. Idempotent, saa
  // watcheren kan kalde den ved enhver aendring. Den synkrone udgave bruges
  // af testene; appen bruger syncAsync, som ikke holder hovedprocessen.
  sync() {
    // Er drevet ikke tilsluttet, ligner biblioteket en tom mappe, og en
    // synkronisering ville markere hver eneste fil som forsvundet. Meld
    // fra og lad kataloget staa uroert, saa bedoemmelser, serier og
    // virtuelle kopier overlever at et drev er taget ud.
    if (!libraryAvailable(this.root)) {
      return { changed: 0, edited: 0, unavailable: true };
    }
    const res = this._afstem(new Map(walkImages(this.root, this.inkluder).map((f) => [f.rel, f])), null);
    this._ryddEfterSkanning();
    return res;
  }

  // Efter en skanning: tomme mapper i Import, fx efter filer er flyttet i
  // Finder, slettes, naar de har vaeret tomme et stykke tid.
  _ryddEfterSkanning() {
    if (!this.inkluder) return;
    try {
      this.ryddTommeMapper({ minAlderMs: TOM_MAPPE_ALDER_MS });
    } catch {
      // En mappe der ikke kan slettes, maa ikke vaelte skanningen.
    }
  }

  // Det samme, men filsystemet laeses uden at blokere: mapperne, filernes
  // stoerrelse og tid, og hashen af de filer der er nye eller aendrede. Selve
  // afstemningen mod databasen er hurtig og koerer til sidst i ét stykke.
  async syncAsync() {
    if (!libraryAvailable(this.root)) {
      return { changed: 0, edited: 0, unavailable: true };
    }
    const liste = await walkImagesAsync(this.root, this.inkluder);
    const kendte = new Map(this.db.all('SELECT rel_path, size, mtime FROM files').map((r) => [r.rel_path, r]));
    const skalHashes = liste.filter((f) => {
      const k = kendte.get(f.rel);
      return !k || k.size !== f.size || k.mtime !== f.mtime;
    });
    const hashes = new Map();
    await mapGraense(skalHashes, 8, async (f) => {
      try {
        hashes.set(f.rel, await quickHashAsync(this.abs(f.rel), f.size));
      } catch {
        hashes.set(f.rel, null); // kunne ikke laeses; springes over
      }
    });
    // Drevet kan vaere taget ud mens der blev laest. Saa er listen tom, og
    // en afstemning ville markere alt som forsvundet.
    if (!libraryAvailable(this.root)) return { changed: 0, edited: 0, unavailable: true };
    const res = this._afstem(new Map(liste.map((f) => [f.rel, f])), hashes);
    this._ryddEfterSkanning();
    return res;
  }

  // hashes: forudberegnede hashes fra syncAsync, eller null.
  _afstem(disk, hashes) {
    const hashAf = (rel, size) => {
      if (hashes && hashes.has(rel)) {
        const h = hashes.get(rel);
        if (h === null) throw new Error('unreadable');
        return h;
      }
      return quickHash(this.abs(rel), size);
    };
    const dbFiles = this.db.all('SELECT * FROM files');
    const missing = [];
    const changedFileIds = [];
    const editedFileIds = [];

    this.db.transaction(() => {
      for (const row of dbFiles) {
        const d = disk.get(row.rel_path);
        if (!d) {
          if (row.present) missing.push(row);
          continue;
        }
        disk.delete(row.rel_path);
        if (!row.present) {
          this.db.run('UPDATE files SET present=1 WHERE id=?', row.id);
          changedFileIds.push(row.id);
        }
        if (d.size !== row.size || d.mtime !== row.mtime) {
          let hash = row.hash;
          try {
            hash = hashAf(row.rel_path, d.size);
          } catch {
            continue;
          }
          const contentChanged = d.size !== row.size || hash !== row.hash;
          this.db.run(
            'UPDATE files SET size=?, mtime=?, hash=? WHERE id=?',
            d.size, d.mtime, hash, row.id
          );
          if (contentChanged) {
            this._markEdited(row.id);
            editedFileIds.push(row.id);
            changedFileIds.push(row.id);
          }
        }
      }

      // Flytte-detektering: manglende fil + ny fil med samme signatur.
      const newEntries = [...disk.values()];
      const newBySig = new Map();
      for (const n of newEntries) {
        let hash;
        try {
          hash = hashAf(n.rel, n.size);
        } catch {
          continue;
        }
        n.hash = hash;
        const sig = `${n.size}:${hash}`;
        if (!newBySig.has(sig)) newBySig.set(sig, []);
        newBySig.get(sig).push(n);
      }
      for (const m of missing) {
        const sig = `${m.size}:${m.hash}`;
        const cands = newBySig.get(sig);
        if (cands && cands.length) {
          const n = cands.shift();
          disk.delete(n.rel);
          this.db.run(
            'UPDATE files SET rel_path=?, mtime=?, present=1 WHERE id=?',
            n.rel, n.mtime, m.id
          );
          changedFileIds.push(m.id);
        } else {
          this.db.run('UPDATE files SET present=0 WHERE id=?', m.id);
        }
      }

      // Filerne pr. mappe, bygget én gang. Foer blev hver ny fil slaaet op
      // med en LIKE over alle filer i kataloget, saa en foerste skanning af
      // 15.000 billeder tog 11 sekunder og voksede med kvadratet.
      const mappeIndeks = this._mappeIndeks();
      // Resterende nye filer: stack paa eksisterende billede eller opret nyt.
      // Korteste stier foerst, saa grundfiler oprettes foer deres afledte
      // varianter og stacking rammer rigtigt ved foerste scanning.
      const nyeFiler = [...disk.values()].sort(
        (a, b) => a.rel.length - b.rel.length || a.rel.localeCompare(b.rel)
      );
      for (const n of nyeFiler) {
        if (n.hash === undefined) continue; // kunne ikke laeses
        const fileId = this.db.run(
          'INSERT INTO files(rel_path, size, mtime, hash, present, created_at) VALUES(?,?,?,?,1,?)',
          n.rel, n.size, n.mtime, n.hash, this.now()
        ).lastInsertRowid;

        const stackImage = this._findStackTarget(n.rel, mappeIndeks);
        if (stackImage) {
          this._stakSomVersion(stackImage, fileId, { ny: true });
        } else {
          const imageId = this.db.run(
            'INSERT INTO images(master_file_id, created_at) VALUES(?,?)',
            fileId, this.now()
          ).lastInsertRowid;
          this.db.run(
            'INSERT INTO versions(image_id, file_id, name, is_master, created_at) VALUES(?,NULL,?,1,?)',
            imageId, 'Original', this.now()
          );
        }
        this._indeksTilfoej(mappeIndeks, fileId, n.rel);
        changedFileIds.push(fileId);
      }
      if (this._tilknytArbejdsmapper()) changedFileIds.push(-1);
    });

    if (changedFileIds.length || missing.length) this.emit('changed');
    if (editedFileIds.length) this.emit('files-edited', editedFileIds);
    return { changed: changedFileIds.length, edited: editedFileIds.length, unavailable: false };
  }

  // Filen er aendret paa disken, saa billedet ligger til redigering igen.
  // Faerdig-maerket ryddes med: er der lige gemt en ny udgave, er arbejdet
  // ikke overstaaet, og de to trin kan ikke gaelde samtidig.
  _markEdited(fileId) {
    // Kun godkendte billeder har Edits. En aendret fil goer ikke et billede
    // "faerdigt" laengere, og har vi set hvilket program billedet blev aabnet
    // i, er det programmets navn statussen. Kendes det ikke, har billedet
    // Edits uden et programnavn: appen finder ikke selv paa et navn.
    const rows = this.db.all(
      `SELECT v.id, v.image_id, v.editor FROM versions v
       JOIN images i ON i.id = v.image_id
       WHERE v.rating='godkendt' AND (v.file_id=? OR (v.file_id IS NULL AND i.master_file_id=?))`,
      fileId, fileId
    );
    for (const r of rows) {
      const editor = r.editor || this._sidsteEditor(r.image_id);
      this.db.run(
        'UPDATE versions SET finished=0, edited=1, editor=? WHERE id=?',
        editor ?? null, r.id
      );
    }
  }

  // Finder det billede en ny, afledt fil hoerer til: samme mappe og et
  // stem der starter med et eksisterende billedes stem (fx
  // "IMG_1234-gigapixel.tif" hoerer til "IMG_1234.CR2").
  _mappeIndeks() {
    const indeks = new Map();
    for (const f of this.db.all('SELECT id, rel_path FROM files WHERE present=1')) {
      this._indeksTilfoej(indeks, f.id, f.rel_path);
    }
    return indeks;
  }

  _indeksTilfoej(indeks, id, relPath) {
    const dir = posix.dirname(relPath);
    const liste = indeks.get(dir);
    if (liste) liste.push({ id, rel_path: relPath });
    else indeks.set(dir, [{ id, rel_path: relPath }]);
  }

  // Gør filen til en version af billedet stackImage peger paa.
  _stakSomVersion(stackImage, fileId, { ny = false } = {}) {
    // En ny version arver originalens bedoemmelse. Er den godkendt, er
    // en fil i Edits "under redigering", og en fil i Master gør
    // billedet "faerdigt" (originalen faar det trin med).
    const arvet = this.db.get(
      'SELECT rating FROM versions WHERE image_id=? AND is_master=1', stackImage.imageId
    )?.rating ?? 'ubedomt';
    const godkendt = arvet === 'godkendt';
    const faerdig = godkendt && stackImage.kind === 'master';
    // Status er det program billedet senest blev aabnet i. Kendes det
    // ikke, faar filen ingen status; appen finder ikke selv paa et navn.
    const editor = godkendt && stackImage.kind === 'edit' ? this._sidsteEditor(stackImage.imageId) : null;
    this.db.run(
      'INSERT INTO versions(image_id, file_id, name, is_master, rating, edited, finished, editor, created_at) VALUES(?,?,?,0,?,?,?,?,?)',
      stackImage.imageId, fileId, stackImage.versionName, arvet,
      godkendt && stackImage.kind === 'edit' ? 1 : 0, faerdig ? 1 : 0, editor, this.now()
    );
    // Har billedet en redigering, har originalen den ogsaa, medmindre
    // vaerket er faerdigt.
    if (godkendt && stackImage.kind === 'edit') {
      this.db.run(
        'UPDATE versions SET edited=1, editor=COALESCE(editor, ?) WHERE image_id=? AND is_master=1 AND finished=0',
        editor, stackImage.imageId
      );
    }
    if (faerdig) {
      this.db.run(
        'UPDATE versions SET edited=0, finished=1 WHERE image_id=? AND is_master=1',
        stackImage.imageId
      );
      // En ny fil i Master: vaerket er blevet til. Teksterne kan skrives.
      if (ny) this.emit('ny-master', stackImage.imageId);
    }
  }

  // Mappen bestemmer: en fil i et vaerks Edits eller Master hoerer til
  // vaerkets original, ogsaa naar filen var i kataloget i forvejen og er
  // flyttet derind (saa den beholdt sin egen identitet som et ubedoemt
  // billede og dukkede op i Sort i stedet for i Edit). Returnerer antallet.
  _tilknytArbejdsmapper() {
    const filer = this.db.all(
      `SELECT id, rel_path FROM files WHERE present=1
         AND (rel_path LIKE 'Approved/%/Edits/%' OR rel_path LIKE 'Approved/%/Master/%')`
    );
    let antal = 0;
    for (const f of filer) {
      const maal = this._arbejdsmappeMaal(f.rel_path);
      if (!maal) continue;
      const nu = this._imageForFile(f.id);
      if (!nu || nu.imageId === maal.imageId) continue;
      const egetBillede = this.db.get('SELECT id FROM images WHERE id=? AND master_file_id=?', nu.imageId, f.id);
      if (egetBillede) {
        // Filen var sit eget billede: det billede (og dets virtuelle kopier)
        // forsvinder, og filen bliver en version af vaerket.
        this.db.run('DELETE FROM images WHERE id=?', nu.imageId);
      } else {
        this.db.run('DELETE FROM versions WHERE file_id=?', f.id);
      }
      this._stakSomVersion(maal, f.id);
      antal += 1;
    }
    return antal;
  }

  // En fil i Edits eller Master i en arbejdsmappe hoerer til originalen i
  // samme arbejdsmappes Original, uanset hvad den hedder.
  _arbejdsmappeMaal(rel, indeks) {
    const am = arbejdsmappeFor(rel);
    if (!am || (am.del !== 'Edits' && am.del !== 'Master')) return null;
    const originalDir = `Approved/${am.work}/Original`;
    const kandidater = indeks
      ? (indeks.get(originalDir) || [])
      : this.db.all(
        'SELECT id, rel_path FROM files WHERE present=1 AND rel_path LIKE ?',
        `${originalDir}/%`
      );
    for (const k of kandidater) {
      const owner = this._imageForFile(k.id);
      if (!owner) continue;
      const stem = stemOf(posix.basename(rel));
      const arbejdStem = am.work;
      const rest = stem.startsWith(arbejdStem) ? stem.slice(arbejdStem.length).replace(/^[-_. ()]+|[)]+$/g, '') : '';
      const versionName = am.del === 'Master' ? 'Master' : (rest || stem);
      return { imageId: owner.imageId, versionName, kind: am.del === 'Master' ? 'master' : 'edit' };
    }
    return null;
  }

  _findStackTarget(rel, indeks = null) {
    const iArbejdsmappe = this._arbejdsmappeMaal(rel, indeks);
    if (iArbejdsmappe) return iArbejdsmappe;
    const dir = posix.dirname(rel);
    const stem = stemOf(posix.basename(rel));
    const prefix = dir === '.' ? '' : `${dir}/`;
    const siblings = indeks
      ? (indeks.get(dir) || [])
      : this.db.all(
        `SELECT f.id, f.rel_path FROM files f
         WHERE f.present=1 AND f.rel_path LIKE ? AND f.rel_path NOT LIKE ?`,
        `${prefix}%`, `${prefix}%/%`
      );
    let best = null;
    for (const s of siblings) {
      if (s.rel_path === rel) continue; // ikke matche sig selv
      const sStem = stemOf(posix.basename(s.rel_path));
      if (sStem === stem) {
        // Samme navn, anden filtype: hoerer sammen, men kun naar billedet er
        // godkendt. Et billede der ikke er godkendt, har ingen versioner.
        if ((!best || sStem.length > best.stemLen) && this._ejerGodkendt(s.id)) {
          best = { fileId: s.id, stemLen: sStem.length, suffix: '' };
        }
      } else if (
        stem.startsWith(sStem) &&
        /^[-_. ()]/.test(stem.slice(sStem.length)) &&
        erRedigeretUdgave(stem.slice(sStem.length), extOf(rel), extOf(s.rel_path))
      ) {
        if ((!best || sStem.length > best.stemLen) && this._ejerGodkendt(s.id)) {
          best = { fileId: s.id, stemLen: sStem.length, suffix: stem.slice(sStem.length) };
        }
      }
    }
    if (!best) return null;
    const owner = this._imageForFile(best.fileId);
    if (!owner) return null;
    const suffix = best.suffix.replace(/^[-_. ()]+|[)]+$/g, '');
    const versionName = suffix || extOf(rel).toUpperCase();
    return { imageId: owner.imageId, versionName, kind: 'edit' };
  }

  // Er originalen til billedet som filen hoerer til godkendt? Kun et godkendt
  // billede har versioner.
  _ejerGodkendt(fileId) {
    const owner = this._imageForFile(fileId);
    if (!owner) return false;
    return this.db.get(
      'SELECT rating FROM versions WHERE image_id=? AND is_master=1', owner.imageId
    )?.rating === 'godkendt';
  }

  _imageForFile(fileId) {
    const asMaster = this.db.get('SELECT id FROM images WHERE master_file_id=?', fileId);
    if (asMaster) return { imageId: asMaster.id };
    const asVersion = this.db.get('SELECT image_id FROM versions WHERE file_id=?', fileId);
    if (asVersion) return { imageId: asVersion.image_id };
    return null;
  }

  // ---------- Liste og filtre ----------

  // Returnerer grid-raekker: en raekke pr. version.
  listVersions(filter = {}) {
    const where = ['f.present=1'];
    const params = [];
    if (filter.folder) {
      where.push("(f.rel_path LIKE ? ESCAPE '\\')");
      params.push(`${escapeLike(filter.folder)}/%`);
    }
    if (!filter.visKasserede) {
      where.push("v.rating != 'kasseret'");
    }
    if (filter.kunKasserede) {
      where.push("v.rating = 'kasseret'");
    }
    if (filter.kunGodkendte) where.push("v.rating = 'godkendt'");
    if (filter.kunKandidater) where.push("v.rating = 'kandidat'");
    if (filter.kunRedigerede) where.push('v.edited = 1');
    if (filter.kunFaerdige) where.push('v.finished = 1');
    if (filter.serieId) {
      where.push('i.series_id = ?');
      params.push(filter.serieId);
    }
    if (filter.keyword) {
      where.push('f.id IN (SELECT file_id FROM keywords WHERE word = ?)');
      params.push(filter.keyword);
    }
    if (filter.fileIds) {
      if (!filter.fileIds.length) return [];
      where.push(`f.id IN (${filter.fileIds.map(() => '?').join(',')})`);
      params.push(...filter.fileIds);
    }
    const order = 'f.mtime DESC';
    const rows = this.db.all(
      `SELECT v.id AS version_id, v.image_id, v.name AS version_name, v.is_master,
              v.rating, v.edited, v.finished, v.editor,
              f.id AS file_id, f.rel_path, f.mtime, f.size, f.rotation,
              i.series_id, s.name AS series_name,
              (SELECT COUNT(*) FROM versions v2 WHERE v2.image_id = v.image_id) AS version_count
       FROM versions v
       JOIN images i ON i.id = v.image_id
       JOIN files f ON f.id = COALESCE(v.file_id, i.master_file_id)
       LEFT JOIN series s ON s.id = i.series_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${order}, v.is_master DESC, v.id ASC`,
      ...params
    );
    // Ved soegning bevarer vi relevans-raekkefoelgen fra fileIds; ellers
    // sorteres navne naturligt (2 foer 19 foer 199) med dansk collator.
    if (filter.fileIds && filter.orderByFileIds) {
      const pos = new Map(filter.fileIds.map((id, idx) => [id, idx]));
      rows.sort((a, b) => (pos.get(a.file_id) ?? 1e9) - (pos.get(b.file_id) ?? 1e9));
    } else if (filter.sort !== 'dato') {
      // Efter filnavn, ikke hele stien: en bedoemmelse flytter filen til en
      // anden mappe, og billedet maa ikke hoppe til en ny plads i gitteret,
      // for saa mister man pladsen midt i en gennemgang.
      rows.sort((a, b) =>
        daCollator.compare(posix.basename(a.rel_path), posix.basename(b.rel_path))
        || daCollator.compare(a.rel_path, b.rel_path)
        || (b.is_master - a.is_master)
        || (a.version_id - b.version_id));
    }
    // Beskaeringen og programmet staar i filnavnet, saa de foelger med naar
    // filen omdoebes.
    for (const r of rows) {
      // En forstoerrelse i Edits har beskaeringens format i navnet
      // ("Roofs 2-3-giga.tif") og faar det samme maerke som den.
      const giga = this._gigaDele(r.rel_path);
      r.crop = beskaeringFraSti(r.rel_path) || (giga ? giga.token.replace('-', ':') : null);
      const editor = editorFraSti(r.rel_path);
      if (editor) {
        r.editor = editor;
        r.edited = 1;
      }
    }
    if (!filter.fase) return rows;
    const fase = Number(filter.fase);
    const ud = this._filtrerFase(rows, fase);
    // Fase 4: om der er en printfil, og hvor stor den er. Print files
    // skannes ikke, saa det slaas op paa disken.
    if (fase === 4) {
      for (const r of ud) {
        r.printfil = this._printfilInfo(r.rel_path);
        r.giga = Boolean(this._gigaDele(r.rel_path));
        // Kopien til Gigapixel ligger ogsaa i Edits, men er ikke stoerre.
        const st = r.giga ? null : this._printDele(r.rel_path)?.forstoerrelser[0];
        r.forstoerrelse = st && st.size > r.size ? st.rel_path : null;
        // Den nyeste -giga-fil, ogsaa naar den endnu ikke er stoerre (kopien
        // der er sendt til Gigapixel): listen viser dens maal.
        r.giga_fil = st ? { id: st.id, rel: st.rel_path, mtime: st.mtime } : null;
      }
    }
    // Kaeden master -> beskaering -> -giga -> printfil: er et led nyere end
    // det naeste, er det naeste lavet af en gammel udgave.
    if (fase === 3 || fase === 4) {
      for (const r of ud) {
        if (r.giga || !r.crop || r.crop === 'free') continue;
        const f = [];
        const master = this.masterFil(r.image_id);
        if (master && master.id !== r.file_id && master.mtime > r.mtime + FORAELDET_MS) f.push('master');
        if (fase === 4) {
          if (r.giga_fil && r.giga_fil.mtime + FORAELDET_MS < r.mtime) f.push('giga');
          const kilde = r.giga_fil && r.giga_fil.mtime > r.mtime ? r.giga_fil.mtime : r.mtime;
          if (r.printfil && r.printfil.mtime + FORAELDET_MS < kilde) f.push('print');
        }
        r.foraeldet = f.length ? { led: f, masterMtime: master?.mtime ?? null } : null;
      }
    }
    return ud;
  }

  // En beskaering i Master som print: vaerket, navnet uden format, formatet
  // ("2-3") og forstoerrelserne af den i Edits ("Desert 2-3-giga.tif" fra
  // Gigapixel, med eller uden bindestreg, store eller smaa bogstaver),
  // stoerste fil foerst. En fri beskaering har intet printformat.
  _printDele(rel) {
    const m = /^Approved\/([^/]+)\/Master\/([^/]+)$/.exec(rel);
    if (!m) return null;
    const crop = beskaeringFraSti(rel);
    const token = crop && crop !== 'free' ? crop.replace(':', '-') : null;
    const base = stemOf(navnMedBeskaering(m[2], null));
    let forstoerrelser = [];
    if (token) {
      const start = `${base} ${token}`.toLowerCase();
      forstoerrelser = this.db.all(
        "SELECT id, rel_path, size, mtime FROM files WHERE present=1 AND rel_path LIKE ? ESCAPE '\\'",
        `Approved/${escapeLike(m[1])}/Edits/%`
      ).filter((f) => {
        const stem = stemOf(posix.basename(f.rel_path)).toLowerCase();
        return stem.startsWith(start) && /^[-_ ]*giga/.test(stem.slice(start.length));
      }).sort((a, b) => b.size - a.size);
    }
    return { work: m[1], base, token, forstoerrelser };
  }

  // Hele kaeden af en beskaering i Master: beskaeringen, dens -giga-filer i
  // Edits og dens printfil. Det er det minus i Crop fjerner.
  cropKaede(versionId) {
    const v = this.getVersion(versionId);
    const f = v ? this.getFile(v.effective_file_id) : null;
    if (!f || !f.present) throw new Error('The crop is not available right now');
    const d = this._printDele(f.rel_path);
    if (!d || !d.token) throw new Error('Only crops in the Master folder can be removed here');
    const filer = [{ rel: f.rel_path, art: 'crop' }];
    for (const g of d.forstoerrelser) filer.push({ rel: g.rel_path, art: 'giga' });
    const print = this._printfilInfo(f.rel_path);
    if (print) filer.push({ rel: print.rel, art: 'print' });
    return filer;
  }

  // En forstoerrelse i Edits af en beskaering: "Desert 2-3-giga.tif", eller
  // det Gigapixel selv gemmer ("Desert 2-3-giga-gigapixel-4x.tif"). Navnet
  // uden format, og formatet. Det er den printfilen laves af.
  _gigaDele(rel) {
    const m = /^Approved\/([^/]+)\/Edits\/([^/]+)$/.exec(rel);
    if (!m) return null;
    const stem = stemOf(m[2]);
    const g = /^(.*\S)[ _](1-1|2-3|3-2|1-2|2-1)[-_ ]*giga/i.exec(stem);
    if (!g) return null;
    return { work: m[1], base: g[1], token: g[2] };
  }

  // Printfilen til en beskaering i Master eller en forstoerrelse i Edits:
  // { rel, bytes } eller null.
  _printfilInfo(rel) {
    const d = this._printDele(rel) || this._gigaDele(rel);
    if (!d || !d.token) return null;
    const printRel = `Approved/${d.work}/Print files/${printfilNavn(d.base, d.token)}`;
    try {
      const st = statSync(this.abs(printRel));
      return { rel: printRel, bytes: st.size, mtime: Math.floor(st.mtimeMs) };
    } catch {
      return null;
    }
  }

  // De -giga-filer der er nyere end deres printfil (eller ikke har en): dem
  // kan appen selv lave printfilen til, naar den har tjekket forstoerrelsen.
  autoPrintKandidater() {
    if (!this.mappestyring) return [];
    return this.listVersions({ fase: 4 })
      .filter((r) => r.giga && (!r.printfil || r.printfil.mtime < r.mtime))
      .map((r) => ({ versionId: r.version_id, rel: r.rel_path, mtime: r.mtime }));
  }

  // Hvad der skal til for at lave printfilen. Den laves af forstoerrelsen i
  // Edits (-giga), praecis den fil der er valgt. beskaering er filen i Master
  // den er lavet af, saa det kan ses om den faktisk er blevet stoerre.
  printMaal(versionId) {
    const v = this.getVersion(versionId);
    const f = v ? this.getFile(v.effective_file_id) : null;
    if (!f || !f.present) throw new Error('The file is not available right now');
    const g = this._gigaDele(f.rel_path);
    if (g) {
      const start = `${g.base} ${g.token}`.toLowerCase();
      const krop = this.db.all(
        "SELECT rel_path FROM files WHERE present=1 AND rel_path LIKE ? ESCAPE '\\'",
        `Approved/${escapeLike(g.work)}/Master/%`
      ).find((x) => stemOf(posix.basename(x.rel_path)).toLowerCase() === start);
      return {
        kilde: this.abs(f.rel_path),
        mappe: join(this.root, 'Approved', g.work, 'Print files'),
        base: g.base,
        token: g.token,
        forstoerrelser: [],
        rotation: f.rotation || 0,
        beskaering: krop ? this.abs(krop.rel_path) : null,
      };
    }
    // En beskaering i Master: printfilen laves af dens stoerste -giga-fil,
    // aldrig af beskaeringen selv.
    const d = this._printDele(f.rel_path);
    if (d?.token) {
      const giga = d.forstoerrelser[0];
      if (!giga) throw new Error('Not enlarged yet. Enlarge the crop in Gigapixel first; the print file is made from the -giga file.');
      const v2 = this.db.get('SELECT id FROM versions WHERE file_id=?', giga.id);
      if (v2) return this.printMaal(v2.id);
      throw new Error('The -giga file is not in the catalogue yet. Scan again.');
    }
    throw new Error('Print files are made from the enlargement in Edits (the file with -giga in its name)');
  }

  // ---------- Faser ----------
  //
  // 1 Sort: det der ikke er godkendt endnu (Import og Candidate).
  // 2 Edit: godkendte vaerker uden en master; originalen og redigeringerne.
  // 3 Crop: vaerker med en master; masteren og beskaeringerne.
  // 4 Print: beskaeringerne og forstoerrelserne, hver med sin printfil. Et
  // vaerk der kun saelges i sin egen form, faar en beskaering i det format.
  // 5 Product: vaerker med en master; én flise pr. vaerk. Det sidste tjek
  // foer shoppen.
  // 6 Shop: de vaerker der er publiceret i shoppen.
  // Fasen er ikke en status man saetter. Den foelger af mapperne.

  _mastersInfo() {
    const rows = this.db.all(
      `SELECT v.image_id, f.rel_path FROM versions v JOIN files f ON f.id = v.file_id
       WHERE f.present=1 AND f.rel_path LIKE 'Approved/%/Master/%'`
    );
    const medMaster = new Set();
    const medBeskaering = new Set();
    for (const r of rows) {
      if (!/^Approved\/[^/]+\/Master\//.test(r.rel_path)) continue;
      medMaster.add(r.image_id);
      if (beskaeringFraSti(r.rel_path)) medBeskaering.add(r.image_id);
    }
    return { medMaster, medBeskaering };
  }

  // Vaerkerne der er publiceret i shoppen.
  _iShoppen() {
    return new Set(this.db.all("SELECT image_id FROM works WHERE woo_status='publish'").map((r) => r.image_id));
  }

  _filtrerFase(rows, fase) {
    const { medMaster } = this._mastersInfo();
    const shop = this._iShoppen();
    const iMaster = (r) => /^Approved\/[^/]+\/Master\//.test(r.rel_path);
    const godk = (r) => r.rating === 'godkendt';
    switch (fase) {
      case 1: return rows.filter((r) => !godk(r));
      case 2: return rows.filter((r) => godk(r) && !medMaster.has(r.image_id));
      case 5:
      case 6: {
        // Én flise pr. vaerk: masteren uden et format i navnet, ellers den
        // foerste. Fase 5 er dem der ikke er publiceret endnu, fase 6 dem
        // der er.
        const valgt = new Map();
        for (const r of rows) {
          if (!godk(r) || !iMaster(r)) continue;
          if (shop.has(r.image_id) !== (fase === 6)) continue;
          const nu = valgt.get(r.image_id);
          if (!nu || (nu.crop && !r.crop)) valgt.set(r.image_id, r);
        }
        const behold = new Set([...valgt.values()].map((r) => r.version_id));
        return rows.filter((r) => behold.has(r.version_id));
      }
      case 3: return rows.filter((r) => godk(r) && iMaster(r) && !shop.has(r.image_id));
      // Beskaeringerne i Master og forstoerrelserne af dem i Edits. Et
      // publiceret vaerk er kun med, saa laenge et format mangler sin
      // printfil, fx en ny beskaering lavet fra fase 6.
      case 4: return rows.filter((r) => godk(r)
        && ((iMaster(r) && r.crop && r.crop !== 'free') || this._gigaDele(r.rel_path))
        && (!shop.has(r.image_id) || !this._printfilInfo(r.rel_path)));
      default: return rows;
    }
  }

  // Antal i hver fase: billeder i fase 1, vaerker i de andre.
  faseTal() {
    const { medMaster, medBeskaering } = this._mastersInfo();
    const shop = this._iShoppen();
    const sort = this.db.get(
      `SELECT COUNT(*) AS c FROM versions v JOIN images i ON i.id = v.image_id
       JOIN files f ON f.id = i.master_file_id
       WHERE v.is_master=1 AND f.present=1 AND v.rating IN ('ubedomt', 'kandidat')`
    ).c;
    let edit = 0;
    let vaerker = 0;
    let online = 0;
    for (const r of this.db.all(
      `SELECT v.image_id FROM versions v JOIN images i ON i.id = v.image_id
       JOIN files f ON f.id = i.master_file_id
       WHERE v.is_master=1 AND f.present=1 AND v.rating='godkendt'`
    )) {
      if (!medMaster.has(r.image_id)) edit += 1;
      else if (shop.has(r.image_id)) online += 1;
      else vaerker += 1;
    }
    const print = [...medBeskaering].filter((id) => !shop.has(id)).length;
    return { 1: sort, 2: edit, 3: vaerker, 4: print, 5: vaerker, 6: online };
  }

  // Vaerkets master i Master: helst den uden et format i navnet.
  masterFil(imageId) {
    const filer = this.db.all(
      `SELECT f.id, f.rel_path, f.rotation, f.mtime FROM versions v JOIN files f ON f.id = v.file_id
       WHERE v.image_id=? AND f.present=1 AND f.rel_path LIKE 'Approved/%/Master/%'
       ORDER BY f.id`,
      imageId
    );
    return filer.find((f) => !beskaeringFraSti(f.rel_path)) || filer[0] || null;
  }

  // Navnene paa vaerkerne i fase 2 (godkendt, ingen master endnu), til
  // mapperne i sidepanelet.
  editVaerker() {
    const { medMaster } = this._mastersInfo();
    const navne = new Set();
    for (const r of this.db.all(
      `SELECT v.image_id, f.rel_path FROM versions v JOIN images i ON i.id = v.image_id
       JOIN files f ON f.id = i.master_file_id
       WHERE v.is_master=1 AND f.present=1 AND v.rating='godkendt'`
    )) {
      if (medMaster.has(r.image_id)) continue;
      const am = arbejdsmappeFor(r.rel_path);
      if (am) navne.add(am.work);
    }
    return [...navne].sort((a, b) => daCollator.compare(a, b));
  }

  // ---------- Filmstrip ----------

  // Alle billederne i Import, med undermapper, i den raekkefoelge de er
  // skudt (EXIF), og ellers efter filens dato og navn. Kandidaterne er med,
  // selv om de er flyttet til Candidate, og de kasserede naar de vises; ellers
  // ville et skud forsvinde fra rækken i det øjeblik det bedømmes. Uden en
  // Import-mappe er det filerne i filens egen mappe. Optagetidspunktet laeses foerste gang en fil vises og
  // gemmes. Returnerer { omfang, billeder }.
  async filmstrip(fileId, { visKasserede = false } = {}) {
    const f = this.getFile(fileId);
    if (!f) return { omfang: null, billeder: [] };
    const imp = this.importMappe;
    const iImport = Boolean(this.inkluder) && Boolean(imp);
    const dir = iImport ? imp : posix.dirname(f.rel_path);
    const prefix = dir === '.' ? '' : `${escapeLike(dir)}/`;
    let hvor;
    let params;
    if (iImport) {
      const toppe = [imp, 'Candidate', ...(visKasserede ? ['Discarded'] : [])];
      hvor = `(${toppe.map(() => "f.rel_path LIKE ? ESCAPE '\\'").join(' OR ')})`;
      params = toppe.map((t) => `${escapeLike(t)}/%`);
    } else {
      // Kun mappen selv, ikke dens undermapper.
      hvor = "f.rel_path LIKE ? ESCAPE '\\' AND f.rel_path NOT LIKE ? ESCAPE '\\'";
      params = [`${prefix}%`, `${prefix}%/%`];
    }
    const rows = this.db.all(
      `SELECT v.id AS version_id, v.rating, f.id AS file_id, f.rel_path, f.mtime, f.rotation, f.taken_at
       FROM versions v JOIN images i ON i.id = v.image_id
       JOIN files f ON f.id = COALESCE(v.file_id, i.master_file_id)
       WHERE f.present=1 AND v.is_master=1
         AND ${hvor}
         ${visKasserede ? '' : "AND v.rating != 'kasseret'"}`,
      ...params
    );
    const mangler = rows.filter((r) => r.taken_at === null || r.taken_at === undefined);
    await mapGraense(mangler, 8, async (r) => {
      const t = await exifTid(this.abs(r.rel_path));
      r.taken_at = t ?? -1;
      this.db.run('UPDATE files SET taken_at=? WHERE id=?', r.taken_at, r.file_id);
    });
    const tid = (r) => (r.taken_at > 0 ? r.taken_at : r.mtime);
    rows.sort((a, b) => tid(a) - tid(b) || daCollator.compare(a.rel_path, b.rel_path));
    return { omfang: iImport ? 'import' : dir, billeder: rows };
  }

  // ---------- Fase 2 ----------

  // Vaerkets arbejdsmappe ("Desert") ud fra en hvilken som helst version.
  _vaerkFor(versionId) {
    const v = this.getVersion(versionId);
    if (!v) return null;
    const master = this.db.get(
      'SELECT f.rel_path FROM images i JOIN files f ON f.id = i.master_file_id WHERE i.id=?', v.image_id
    );
    const am = master ? arbejdsmappeFor(master.rel_path) : null;
    return am ? { imageId: v.image_id, work: am.work, v } : null;
  }

  // En kopi af filen i vaerkets Edits, med programmets endelse:
  // "Desert.cr2" -> "Edits/Desert-neo.cr2". Returnerer den nye sti.
  kopiTilEdits(versionId, suffiks) {
    if (!/^[a-z]+$/.test(String(suffiks))) throw new Error('Unknown program');
    const vaerk = this._vaerkFor(versionId);
    if (!vaerk) throw new Error('Only Approved works can be sent to an editor');
    const f = this.getFile(vaerk.v.effective_file_id);
    if (!f || !f.present) throw new Error('The file is not available right now');
    const ext = extname(f.rel_path);
    const stem = stemOf(basename(f.rel_path));
    const mappe = join(this.root, 'Approved', vaerk.work, 'Edits');
    mkdirSync(mappe, { recursive: true });
    const dest = uniquePath(join(mappe, `${stem}-${suffiks}${ext}`));
    copyFileSync(this.abs(f.rel_path), dest);
    return dest;
  }

  // Hvor en master af filen skal ligge, og hvad den skal hedde: vaerkets
  // Master, med navnet uden endelser ("IMG_1234-Denoise-tp.tif" -> "IMG_1234.tif").
  masterMaal(versionId) {
    const vaerk = this._vaerkFor(versionId);
    if (!vaerk) throw new Error('Only Approved works can get a master');
    const f = this.getFile(vaerk.v.effective_file_id);
    if (!f || !f.present) throw new Error('The file is not available right now');
    return {
      kilde: this.abs(f.rel_path),
      mappe: join(this.root, 'Approved', vaerk.work, 'Master'),
      stem: masterNavn(stemOf(basename(f.rel_path)), vaerk.work),
    };
  }

  // Kassér et vaerk i fase 2: originalen gaar til Discarded som alle andre
  // kasserede, og redigeringerne fjernes fra kataloget. Returnerer de filer
  // og den arbejdsmappe der skal i papirkurven (det goer kalderen).
  kasserVaerk(versionId) {
    const vaerk = this._vaerkFor(versionId);
    if (!vaerk) throw new Error('Only Approved works can be discarded here');
    const harMaster = this.db.get(
      `SELECT 1 AS ok FROM versions v JOIN files f ON f.id = v.file_id
       WHERE v.image_id=? AND f.present=1 AND f.rel_path LIKE 'Approved/%/Master/%' LIMIT 1`,
      vaerk.imageId
    );
    if (harMaster) throw new Error('This work already has a master and is no longer in Edit');
    const ekstra = this.db.all(
      `SELECT v.id AS vid, f.id AS fid, f.rel_path FROM versions v JOIN files f ON f.id = v.file_id
       WHERE v.image_id=? AND v.is_master=0`,
      vaerk.imageId
    );
    const alle = this.db.all('SELECT id FROM versions WHERE image_id=?', vaerk.imageId).map((r) => r.id);
    const tilPapirkurv = ekstra.filter((e) => existsSync(this.abs(e.rel_path))).map((e) => this.abs(e.rel_path));
    this.db.transaction(() => {
      for (const e of ekstra) {
        this.db.run('DELETE FROM versions WHERE id=?', e.vid);
        this.db.run('UPDATE files SET present=0 WHERE id=?', e.fid);
      }
    });
    // Originalen flyttes af den almindelige regel for kasserede.
    this.setRating(alle.filter((id) => !ekstra.some((e) => e.vid === id)), 'kasseret');
    return { filer: tilPapirkurv, arbejdsmappe: join(this.root, 'Approved', vaerk.work) };
  }


  getVersion(versionId) {
    return this.db.get(
      `SELECT v.*, i.master_file_id, i.series_id,
              COALESCE(v.file_id, i.master_file_id) AS effective_file_id
       FROM versions v JOIN images i ON i.id = v.image_id WHERE v.id=?`,
      versionId
    );
  }

  getFile(fileId) {
    return this.db.get('SELECT * FROM files WHERE id=?', fileId);
  }

  // Arbejdsmappens undermappe (Original, Edits, Master, Print files) for et
  // godkendt billede, eller null hvis billedet ikke har en arbejdsmappe.
  workFolder(versionId, del = null) {
    if (del !== null && !ARBEJDSMAPPER.includes(del)) return null;
    const v = this.getVersion(versionId);
    if (!v) return null;
    const master = this.db.get(
      'SELECT f.rel_path FROM images i JOIN files f ON f.id = i.master_file_id WHERE i.id=?', v.image_id
    );
    const am = master ? arbejdsmappeFor(master.rel_path) : null;
    if (!am) return null;
    // Uden en undermappe er det vaerkets egen mappe.
    const abs = del ? join(this.root, 'Approved', am.work, del) : join(this.root, 'Approved', am.work);
    mkdirSync(abs, { recursive: true });
    return abs;
  }

  filePathForVersion(versionId) {
    const v = this.getVersion(versionId);
    if (!v) return null;
    const f = this.getFile(v.effective_file_id);
    return f ? this.abs(f.rel_path) : null;
  }

  // ---------- Status ----------

  // kandidat: motivet er godt, men der er noget teknisk galt (uskarphed,
  // farver), saa billedet skal en tur i editoren foer det kan afgoeres.
  // Det er en ventende beslutning, ikke en dom, og derfor sendes
  // kandidater aldrig til betalt analyse.
  setRating(versionIds, rating) {
    if (!['ubedomt', 'godkendt', 'kandidat', 'kasseret'].includes(rating)) {
      throw new Error(`Unknown rating: ${rating}`);
    }
    this.db.transaction(() => {
      for (const id of versionIds) {
        // Arbejdstrin findes kun paa godkendte billeder.
        if (rating === 'godkendt') this.db.run('UPDATE versions SET rating=? WHERE id=?', rating, id);
        else this.db.run('UPDATE versions SET rating=?, edited=0, finished=0, editor=NULL WHERE id=?', rating, id);
      }
    });
    if (this.mappestyring) this._placerBilleder(versionIds);
    this.emit('changed');
  }

  // Flytter originalen til den mappe bedoemmelsen peger paa. Kun originalen
  // (masterversionen) flyttes; redigeringer og masterfiler bliver i
  // arbejdsmappen. Returnerer de udfoerte flytninger.
  _placerBilleder(versionIds) {
    const moves = [];
    const set = new Set();
    for (const id of versionIds) {
      const v = this.db.get(
        `SELECT v.is_master, v.rating, i.id AS image_id, i.master_file_id AS fid
         FROM versions v JOIN images i ON i.id = v.image_id WHERE v.id=?`, id
      );
      if (!v || !v.is_master || set.has(v.image_id)) continue;
      set.add(v.image_id);
      const f = this.getFile(v.fid);
      if (!f || !f.present) continue;
      const mal = this._maalmappe(f.rel_path, v.rating);
      if (mal === null) continue;
      moves.push(...this.moveFiles([f.id], mal));
      if (v.rating === 'godkendt') {
        const arbejd = posix.dirname(mal);
        for (const del of ['Edits', 'Master', 'Print files']) {
          mkdirSync(join(this.root, arbejd, del), { recursive: true });
        }
      }
    }
    return moves;
  }

  // Mappen en fil skal ligge i for en bedoemmelse, eller null hvis den allerede
  // ligger rigtigt eller ikke skal flyttes.
  _maalmappe(rel, rating) {
    const dir = posix.dirname(rel) === '.' ? '' : posix.dirname(rel);
    const topmappe = rel.split('/')[0];
    const styret = rel.includes('/') && this._styredeTopmapper().includes(topmappe);
    if (rating === 'godkendt') {
      if (arbejdsmappeFor(rel)?.del === 'Original') return null;
      const stem = stemOf(posix.basename(rel)).replace(/[/:\\]/g, '-');
      return `Approved/${stem}/Original`;
    }
    // En fil der ligger uden for de styrede mapper og ikke er bedoemt, bliver
    // hvor den er. Faar den en bedoemmelse, hentes mappens navn ind foran.
    if (rating === 'ubedomt' && !styret) return null;
    if (rating === 'kasseret') {
      // Alle kasserede ligger i Discarded i roden, i én mappe med samme navn
      // som den mappe filen kom fra (ved et vaerk: vaerkets navn).
      const navn = this._oprindelsesmappe(rel);
      const mal = navn ? `Discarded/${navn}` : 'Discarded';
      return mal === dir ? null : mal;
    }
    // Under Approved er der arbejdsmapper; tilbage gaar filen til roden af
    // den nye mappe, ellers bevares undermappen den kom fra.
    const under = topmappe === 'Approved' ? '' : (styret ? dir.split('/').slice(1).join('/') : dir);
    const top = this._topFor(rating);
    const mal = under ? `${top}/${under}` : top;
    return mal === dir ? null : mal;
  }

  // Navnet paa den mappe en fil kom fra, uden de styrede topmapper:
  // "Import/Ahl Strand/x.cr2" og "Ahl Strand/x.cr2" giver begge "Ahl Strand",
  // og "Approved/Desert/Original/x.cr2" giver vaerkets navn "Desert".
  _oprindelsesmappe(rel) {
    const am = arbejdsmappeFor(rel);
    if (am) return am.work;
    const dele = posix.dirname(rel) === '.' ? [] : posix.dirname(rel).split('/');
    if (dele.length && this._styredeTopmapper().includes(dele[0])) dele.shift();
    return dele.length ? dele[dele.length - 1] : '';
  }

  // Hvor langt et billede er i arbejdet. Det er ét trin ad gangen: enten
  // ligger billedet til redigering, eller ogsaa er det faerdigt. Foer stod
  // de to som hver sit flag, der kunne vaere taendt samtidig, og saa stod
  // der baade "being edited" og "finished" paa det samme billede. Begge
  // kolonner skrives nu i samme saetning, saa den tilstand ikke findes.
  setStage(versionIds, stage) {
    if (![null, 'edited', 'finished'].includes(stage)) {
      throw new Error(`Unknown workflow stage: ${stage}`);
    }
    const edited = stage === 'edited' ? 1 : 0;
    const finished = stage === 'finished' ? 1 : 0;
    this.db.transaction(() => {
      for (const id of versionIds) {
        // Kun godkendte billeder har et arbejdstrin; andre kan kun ryddes.
        if (stage === null) {
          this.db.run('UPDATE versions SET edited=0, finished=0, editor=NULL WHERE id=?', id);
        } else {
          this.db.run(
            "UPDATE versions SET edited=?, finished=? WHERE id=? AND rating='godkendt'",
            edited, finished, id
          );
        }
      }
    });
    this.emit('changed');
  }

  // Status under Edits: det program billedet er redigeret i. Kun godkendte
  // billeder har en, og navnet maa vaere et af de programmer appen kender.
  // null rydder den.
  setEditor(versionIds, editor) {
    const navn = editor == null ? null : String(editor).trim();
    if (editor != null && !navn) throw new Error('The editor needs a name');
    this.db.transaction(() => {
      for (const id of versionIds) {
        if (navn === null) {
          this.db.run('UPDATE versions SET editor=NULL, edited=0 WHERE id=?', id);
        } else {
          this.db.run(
            "UPDATE versions SET editor=?, edited=1, finished=0 WHERE id=? AND rating='godkendt'",
            navn, id
          );
        }
      }
    });
    this.emit('changed');
  }

  // Genskaber et helt trin, bruges af fortryd. Ingen regler, det er et
  // snapshot af en tilstand der har vaeret gyldig.
  restoreEdits(versionId, { edited, finished, editor }) {
    this.db.run(
      'UPDATE versions SET edited=?, finished=?, editor=? WHERE id=?',
      edited ? 1 : 0, finished ? 1 : 0, editor ?? null, versionId
    );
    this.emit('changed');
  }

  // Huskes naar et billede aabnes i et program, saa en fil der senere dukker
  // op i Edits faar det programmets navn som status.
  noteEditor(versionId, editor) {
    const v = this.getVersion(versionId);
    if (!v || !editor) return false;
    const master = this.db.get('SELECT rating FROM versions WHERE image_id=? AND is_master=1', v.image_id);
    if (master?.rating !== 'godkendt') return false;
    this.db.run(
      `INSERT INTO editor_log(image_id, editor, opened_at) VALUES(?,?,?)
       ON CONFLICT(image_id) DO UPDATE SET editor=excluded.editor, opened_at=excluded.opened_at`,
      v.image_id, String(editor), this.now()
    );
    return true;
  }

  _sidsteEditor(imageId) {
    return this.db.get('SELECT editor FROM editor_log WHERE image_id=?', imageId)?.editor ?? null;
  }

  // Beskaeringen paa en fil i Master: den staar i filnavnet, saa at saette den
  // omdoeber filen ("... 2-3.tif"), og null fjerner den. Returnerer den nye sti.
  setBeskaering(versionId, crop) {
    const v = this.getVersion(versionId);
    const f = v ? this.getFile(v.effective_file_id) : null;
    if (!f || !f.present) throw new Error('The file is not available right now');
    if (!/^Approved\/[^/]+\/Master\//.test(f.rel_path)) {
      throw new Error('Only files in the Master folder have a crop');
    }
    const nyt = navnMedBeskaering(basename(f.rel_path), crop ?? null);
    if (nyt === basename(f.rel_path)) return f.rel_path;
    const dir = join(this.root, posix.dirname(f.rel_path));
    const dest = uniquePath(join(dir, nyt));
    renameSync(this.abs(f.rel_path), dest);
    const rel = toRel(this.root, dest);
    this.db.run('UPDATE files SET rel_path=? WHERE id=?', rel, f.id);
    this.emit('changed');
    return rel;
  }

  // Dreje et billede et kvarter ad gangen. delta er 90 (med uret) eller -90;
  // 0 nulstiller. Returnerer den nye drejning.
  rotateFile(fileId, delta) {
    const f = this.getFile(fileId);
    if (!f) throw new Error('The file is not in the library');
    const ny = delta === 0 ? 0 : (((f.rotation || 0) + delta) % 360 + 360) % 360;
    if (ny % 90 !== 0) throw new Error('The rotation must be a multiple of 90 degrees');
    this.db.run('UPDATE files SET rotation=? WHERE id=?', ny, fileId);
    this.emit('changed');
    return ny;
  }

  stageOf(version) {
    if (!version) return null;
    if (version.finished) return 'finished';
    if (version.edited) return 'edited';
    return null;
  }

  // ---------- Virtuelle kopier ----------

  createVirtualCopy(versionId) {
    const v = this.getVersion(versionId);
    if (!v) throw new Error('Versionen findes ikke');
    const count = this.db.get(
      'SELECT COUNT(*) AS c FROM versions WHERE image_id=? AND is_master=0',
      v.image_id
    ).c;
    const name = `Kopi ${count + 1}`;
    // En kopi arver originalens bedoemmelse; kun godkendte billeder har versioner.
    const arvet = this.db.get(
      'SELECT rating FROM versions WHERE image_id=? AND is_master=1', v.image_id
    )?.rating ?? 'ubedomt';
    const r = this.db.run(
      'INSERT INTO versions(image_id, file_id, name, is_master, rating, created_at) VALUES(?,NULL,?,0,?,?)',
      v.image_id, name, arvet, this.now()
    );
    this.emit('changed');
    return r.lastInsertRowid;
  }

  renameVersion(versionId, name) {
    this.db.run('UPDATE versions SET name=? WHERE id=? AND is_master=0', name, versionId);
    this.emit('changed');
  }

  // Goer en virtuel kopi fysisk: kopierer masterfilen ved siden af
  // originalen, saa den kan redigeres separat. Returnerer den nye sti.
  materializeVersion(versionId) {
    const v = this.getVersion(versionId);
    if (!v) throw new Error('Versionen findes ikke');
    if (v.is_master || v.file_id) {
      return this.filePathForVersion(versionId);
    }
    const master = this.getFile(v.master_file_id);
    if (!master || !master.present) throw new Error('The master file is missing from disk');
    const srcAbs = this.abs(master.rel_path);
    const ext = extname(master.rel_path);
    const stem = stemOf(basename(master.rel_path));
    const destAbs = uniquePath(join(dirname(srcAbs), `${stem}_${slug(v.name)}${ext}`));
    copyFileSync(srcAbs, destAbs);
    const st = statSync(destAbs);
    const rel = toRel(this.root, destAbs);
    const fileId = this.db.run(
      'INSERT INTO files(rel_path, size, mtime, hash, present, created_at) VALUES(?,?,?,?,1,?)',
      rel, st.size, Math.floor(st.mtimeMs), quickHash(destAbs, st.size), this.now()
    ).lastInsertRowid;
    this.db.run('UPDATE versions SET file_id=? WHERE id=?', fileId, versionId);
    this.emit('changed');
    return destAbs;
  }

  // Sletter en virtuel kopi. Returnerer stien til en evt. fysisk kopi,
  // saa kalderen kan laegge den i papirkurven.
  deleteVersion(versionId) {
    const v = this.getVersion(versionId);
    if (!v) return null;
    if (v.is_master) throw new Error('Masterversionen kan ikke slettes');
    let fileAbs = null;
    if (v.file_id) {
      const f = this.getFile(v.file_id);
      if (f && f.present) fileAbs = this.abs(f.rel_path);
    }
    this.db.transaction(() => {
      this.db.run('DELETE FROM versions WHERE id=?', versionId);
      if (v.file_id) this.db.run('DELETE FROM files WHERE id=?', v.file_id);
    });
    this.emit('changed');
    return fileAbs;
  }

  listVersionsForImage(imageId) {
    return this.db.all(
      `SELECT v.*, COALESCE(v.file_id, i.master_file_id) AS effective_file_id,
              f.rel_path, f.mtime, f.rotation, f.size, f.present
       FROM versions v
       JOIN images i ON i.id = v.image_id
       JOIN files f ON f.id = COALESCE(v.file_id, i.master_file_id)
       WHERE v.image_id=? ORDER BY v.is_master DESC, v.id ASC`,
      imageId
    ).map((r) => ({ ...r, crop: beskaeringFraSti(r.rel_path) }));
  }

  // ---------- Serier ----------

  listSeries() {
    return this.db.all(
      `SELECT s.id, s.name, s.intro, s.template, s.colour, COUNT(i.id) AS image_count
       FROM series s LEFT JOIN images i ON i.series_id = s.id
       GROUP BY s.id ORDER BY s.name COLLATE NOCASE`
    );
  }

  createSeries(name, { auto = false } = {}) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('The series needs a name');
    const existing = this.db.get('SELECT id FROM series WHERE name=?', trimmed);
    if (existing) {
      // Stef vaelger eller laver selv en serie, appen lavede: nu er den Stefs.
      if (!auto) this.db.run('UPDATE series SET auto=0 WHERE id=?', existing.id);
      return existing.id;
    }
    return this.db.run('INSERT INTO series(name, auto) VALUES(?, ?)', trimmed, auto ? 1 : 0).lastInsertRowid;
  }

  assignSeries(imageIds, seriesId) {
    this.db.transaction(() => {
      for (const id of imageIds) {
        this.db.run('UPDATE images SET series_id=? WHERE id=?', seriesId ?? null, id);
      }
    });
    this.emit('changed');
  }

  // Seriens tre felter til shoppen: intro, skabelon (walkthrough eller
  // wall) og farve. Tomme felter er tomme; saa roeres de ikke i Woo.
  setSeriesShop(seriesId, patch) {
    const s = this.db.get('SELECT id FROM series WHERE id=?', seriesId);
    if (!s) throw new Error('That series does not exist');
    const rens = {
      intro: (v) => String(v ?? '').trim() || null,
      template(v) {
        const t = String(v ?? '').trim();
        if (!t) return null;
        if (!['walkthrough', 'wall'].includes(t)) throw new Error('The series template must be walkthrough or wall');
        return t;
      },
      colour(v) {
        const t = String(v ?? '').trim();
        if (!t) return null;
        const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
        if (!m) throw new Error('The colour must be a hex colour such as #dd9933');
        const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
        return `#${hex.toLowerCase()}`;
      },
    };
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(patch || {})) {
      if (!rens[key]) throw new Error(`Unknown series field: ${key}`);
      sets.push(`${key}=?`);
      params.push(rens[key](value));
    }
    if (sets.length) this.db.run(`UPDATE series SET ${sets.join(', ')} WHERE id=?`, ...params, seriesId);
    this.emit('changed');
  }

  renameSeries(seriesId, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('The series needs a name');
    const optaget = this.db.get('SELECT id FROM series WHERE name=? AND id<>?', trimmed, seriesId);
    if (optaget) throw new Error(`A series called "${trimmed}" already exists`);
    this.db.run('UPDATE series SET name=? WHERE id=?', trimmed, seriesId);
    this.emit('changed');
  }

  // Billederne beholdes; series_id nulstilles af sig selv, da images
  // peger paa series med ON DELETE SET NULL.
  deleteSeries(seriesId) {
    this.db.run('DELETE FROM series WHERE id=?', seriesId);
    this.emit('changed');
  }

  // ---------- Mapper og flytning ----------

  folderTree() {
    const dirs = walkDirs(this.root, this.inkluder);
    // Tallene ved hver mappe skal vise det samme som et klik paa mappen.
    // Derfor taelles versioner og ikke filer, og undermapper regnes med,
    // praecis som filteret goer. Foer blev der taldt filer i mappen selv,
    // saa tallet og det man saa efter klikket kunne vaere to forskellige.
    const raekker = this.db.all(
      `SELECT f.rel_path AS rel_path, v.rating AS rating, COUNT(*) AS antal
       FROM versions v
       JOIN images i ON i.id = v.image_id
       JOIN files f ON f.id = COALESCE(v.file_id, i.master_file_id)
       WHERE f.present = 1
       GROUP BY f.rel_path, v.rating`
    );
    const tomTaelling = () => ({ godkendt: 0, kandidat: 0, kasseret: 0, ubedomt: 0 });
    const perMappe = new Map();
    for (const r of raekker) {
      let dir = posix.dirname(r.rel_path);
      if (dir === '.') dir = '';
      // Tal med i mappen selv og i alle mapper over den.
      for (;;) {
        if (!perMappe.has(dir)) perMappe.set(dir, tomTaelling());
        const t = perMappe.get(dir);
        if (t[r.rating] !== undefined) t[r.rating] += r.antal;
        if (dir === '') break;
        const op = posix.dirname(dir);
        dir = op === '.' ? '' : op;
      }
    }
    const nyNode = (name, rel) => {
      const counts = perMappe.get(rel) || tomTaelling();
      const count = counts.godkendt + counts.kandidat + counts.kasseret + counts.ubedomt;
      return { name, rel, children: [], counts, count };
    };
    const rootNode = nyNode(basename(this.root), '');
    const byRel = new Map([['', rootNode]]);
    for (const rel of dirs) {
      const node = nyNode(posix.basename(rel), rel);
      byRel.set(rel, node);
      const parentRel = posix.dirname(rel);
      const parent = byRel.get(parentRel === '.' ? '' : parentRel) || rootNode;
      parent.children.push(node);
    }
    return rootNode;
  }

  createFolder(parentRel, name) {
    const safe = String(name || '').trim().replace(/[/:\\]/g, '-');
    if (!safe) throw new Error('Mappen skal have et navn');
    const abs = join(this.root, parentRel || '', safe);
    mkdirSync(abs, { recursive: true });
    this.emit('changed');
    return parentRel ? `${parentRel}/${safe}` : safe;
  }

  // Flytter filer til en anden mappe i biblioteket og opdaterer kataloget.
  // Returnerer de udfoerte flytninger, saa de kan fortrydes.
  moveFiles(fileIds, targetRel) {
    const targetAbs = join(this.root, targetRel || '');
    mkdirSync(targetAbs, { recursive: true });
    const moved = [];
    this.db.transaction(() => {
      for (const id of fileIds) {
        const f = this.getFile(id);
        if (!f || !f.present) continue;
        const srcAbs = this.abs(f.rel_path);
        const curDir = posix.dirname(f.rel_path);
        const fromDir = curDir === '.' ? '' : curDir;
        if (fromDir === (targetRel || '')) continue;
        const destAbs = uniquePath(join(targetAbs, basename(f.rel_path)));
        renameSync(srcAbs, destAbs);
        const rel = toRel(this.root, destAbs);
        this.db.run('UPDATE files SET rel_path=? WHERE id=?', rel, id);
        moved.push({ fileId: id, fromDir, toDir: targetRel || '' });
      }
    });
    // En mappe i Import der er blevet tom, slettes.
    for (const fra of new Set(moved.map((m) => m.fromDir))) this._fjernTomMappe(fra);
    if (moved.length) this.emit('changed');
    return moved;
  }

  // Sletter en mappe i Import hvis den er tom, og de mapper over den der saa
  // ogsaa bliver tomme, men aldrig Import selv. Skjulte filer som .DS_Store
  // tael ikke med. Mapper uden for Import roeres aldrig.
  _fjernTomMappe(dirRel) {
    let dir = dirRel;
    const top = this.importMappe;
    while (dir && dir !== top && dir.startsWith(`${top}/`)) {
      const abs = join(this.root, dir);
      try {
        const indhold = readdirSync(abs).filter((n) => n !== '.DS_Store');
        if (indhold.length) return;
        rmSync(join(abs, '.DS_Store'), { force: true });
        rmdirSync(abs);
      } catch {
        return;
      }
      dir = posix.dirname(dir);
    }
  }

  // Gennemgaar hele Import og sletter de tomme mapper. Returnerer antallet.
  // minAlderMs skaaner mapper der er aendret for nylig, fx en mappe man
  // lige har lavet med New folder og endnu ikke har lagt noget i.
  ryddTommeMapper({ minAlderMs = 0 } = {}) {
    const top = this.importMappe;
    const graense = this.now() - minAlderMs;
    const mapper = walkDirs(this.root, new Set([top]))
      .filter((d) => d.startsWith(`${top}/`))
      .sort((a, b) => b.length - a.length);
    for (const d of mapper) {
      const abs = join(this.root, d);
      if (!existsSync(abs)) continue;
      if (minAlderMs) {
        try {
          if (statSync(abs).mtimeMs > graense) continue;
        } catch {
          continue;
        }
      }
      this._fjernTomMappe(d);
    }
    const slettet = mapper.filter((d) => !existsSync(join(this.root, d))).length;
    if (slettet) this.emit('changed');
    return slettet;
  }

  // Flytter filer hvor ALLE tilknyttede versioner er kasserede til Discarded/.
  moveDiscarded() {
    const rows = this.db.all(
      `WITH alle AS MATERIALIZED (${effektiveFiler('1=1')}),
            levende AS MATERIALIZED (${effektiveFiler("v.rating != 'kasseret'")})
       SELECT f.id FROM files f
       JOIN alle a ON a.fid = f.id
       WHERE f.present=1 AND f.rel_path NOT LIKE '\\_kasseret/%' ESCAPE '\\'
         AND f.rel_path NOT LIKE 'Discarded/%'
         AND f.id NOT IN (SELECT fid FROM levende)`
    );
    // Hver fil til Discarded/<mappen den kom fra>.
    const grupper = new Map();
    for (const r of rows) {
      const f = this.getFile(r.id);
      const mal = this._maalmappe(f.rel_path, 'kasseret') ?? posix.dirname(f.rel_path);
      if (!grupper.has(mal)) grupper.set(mal, []);
      grupper.get(mal).push(r.id);
    }
    const moved = [];
    for (const [mal, ids] of grupper) moved.push(...this.moveFiles(ids, mal === '.' ? '' : mal));
    return moved;
  }

  // ---------- Embeddings og noegleord ----------

  // limit: indekseringen henter en bunke ad gangen. Foer hentes hele
  // ventelisten (op til alle billeder) for hver eneste fil, saa arbejdet
  // voksede med kvadratet paa bibliotekets stoerrelse.
  filesNeedingEmbedding(model, limit = null) {
    return this.db.all(
      `SELECT f.id, f.rel_path, f.mtime FROM files f
       WHERE f.present=1
       AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.file_id=f.id AND e.model=?)
       ${limit ? 'ORDER BY f.id LIMIT ?' : ''}`,
      ...(limit ? [model, limit] : [model])
    );
  }

  countNeedingEmbedding(model) {
    return this.db.get(
      `SELECT COUNT(*) AS c FROM files f
       WHERE f.present=1
       AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.file_id=f.id AND e.model=?)`,
      model
    ).c;
  }

  saveEmbedding(fileId, model, vec) {
    // En tom vektor er markeringen "kan ikke indekseres". node:sqlite binder
    // en tom buffer som NULL, og kolonnen er NOT NULL, saa markeringen
    // fik indekseringen til at kaste og stoppe paa den allerfoerste fil uden
    // forhaandsvisning. Den faar derfor én byte; dim=0 siger at den er tom.
    const buf = vec.length
      ? Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
      : Buffer.alloc(1);
    this.db.run(
      `INSERT INTO embeddings(file_id, model, dim, vec, indexed_at) VALUES(?,?,?,?,?)
       ON CONFLICT(file_id) DO UPDATE SET model=excluded.model, dim=excluded.dim,
         vec=excluded.vec, indexed_at=excluded.indexed_at`,
      fileId, model, vec.length, buf, this.now()
    );
  }

  clearEmbedding(fileId) {
    this.db.run('DELETE FROM embeddings WHERE file_id=?', fileId);
    // Kun automatiske noegleord ryddes; manuelle ord og feedback bevares.
    this.db.run('DELETE FROM keywords WHERE file_id=? AND manual=0', fileId);
  }

  allEmbeddings(model) {
    return this.db.all(
      `SELECT e.file_id, e.dim, e.vec FROM embeddings e
       JOIN files f ON f.id = e.file_id
       WHERE e.model=? AND f.present=1`,
      model
    );
  }

  // ---------- Koe til cloud-noegleord ----------

  // Kun godkendte billeder. Kandidater, kasserede og ubedoemte kommer
  // aldrig med, og det er her reglen haandhaeves: findes filen ikke i det
  // her resultat, bliver den heller ikke sendt afsted.
  //
  // En fil kan vaere den effektive fil for flere versioner. Er bare én af
  // dem godkendt, hoerer filen med; det er billedet der beskrives, og
  // versionerne deler motiv.
  // Kun masterne: noegleordene hoerer til vaerket i fase 5, og hver
  // redigering og original undervejs ville koste uden at blive brugt. Et
  // bibliotek uden mappestyring (kun i aeldre tests) har ingen Master-mapper.
  _kunMastre() {
    return this.mappestyring ? "AND f.rel_path LIKE 'Approved/%/Master/%'" : '';
  }

  filesNeedingKeywords(limit = 5000) {
    return this.db.all(
      `WITH godkendte AS MATERIALIZED (${effektiveFiler("v.rating = 'godkendt'")})
       SELECT f.id, f.rel_path, f.mtime FROM files f
       JOIN godkendte g ON g.fid = f.id
       WHERE f.present=1 ${this._kunMastre()}
         AND NOT EXISTS (SELECT 1 FROM keyword_runs r WHERE r.file_id = f.id)
       ORDER BY f.id LIMIT ?`,
      limit
    );
  }

  // Antal godkendte filer der venter. Bruges til knappen, saa der staar
  // hvor mange der bliver sendt, foer der trykkes.
  keywordQueueSize() {
    return this.db.get(
      `WITH godkendte AS MATERIALIZED (${effektiveFiler("v.rating = 'godkendt'")})
       SELECT COUNT(*) AS c FROM files f
       JOIN godkendte g ON g.fid = f.id
       WHERE f.present=1 ${this._kunMastre()}
         AND NOT EXISTS (SELECT 1 FROM keyword_runs r WHERE r.file_id = f.id)`
    ).c;
  }

  // Ordforraadet der sendes med til Claude, saa den samme ting faar det
  // samme ord hver gang i stedet for wall paa ét billede og walls paa det
  // naeste. Stefs egne ord foerst: de er facit for hvad tingene hedder her.
  keywordVocabulary(limit = 300) {
    return this.db.all(
      `SELECT word, MAX(manual) AS manuel, COUNT(*) AS antal
       FROM keywords GROUP BY word
       ORDER BY manuel DESC, antal DESC, word LIMIT ?`,
      limit
    ).map((r) => r.word);
  }

  markKeywordRun(fileId, model, words) {
    this.db.run(
      `INSERT INTO keyword_runs(file_id, model, words, run_at) VALUES(?,?,?,?)
       ON CONFLICT(file_id) DO UPDATE SET model=excluded.model, words=excluded.words,
         run_at=excluded.run_at`,
      fileId, model, words, this.now()
    );
  }

  // Nulstiller kvitteringerne, saa alt godkendt kan koeres igennem igen,
  // fx paa en anden model. Ordene fra sidste koersel bliver staaende til
  // de bliver overskrevet, saa der ikke er et hul undervejs.
  clearKeywordRuns() {
    return this.db.run('DELETE FROM keyword_runs').changes;
  }

  // Gemmer automatiske noegleord; manuelt tilfoejede ord roeres aldrig.
  saveKeywords(fileId, entries) {
    this.db.transaction(() => {
      this.db.run('DELETE FROM keywords WHERE file_id=? AND manual=0', fileId);
      for (const { word, score } of entries) {
        this.db.run(
          'INSERT INTO keywords(file_id, word, score, manual) VALUES(?,?,?,0) ON CONFLICT(file_id, word) DO NOTHING',
          fileId, word, score
        );
      }
    });
  }

  // ---------- Noegleord ----------
  //
  // At fjerne et ord er nu bare at fjerne det. Foer blev hver sletning
  // ogsaa gemt som en varig afvisning, saa ordet aldrig kunne komme igen
  // paa det billede. Det gav mening dengang appen selv gaettede og skulle
  // laere af rettelserne. Nu kommer ordene fra Claude, ingen laeser
  // afvisningerne, og de gjorde kun en oprydning uigenkaldelig uden at
  // det stod nogen steder.

  addKeyword(fileId, word) {
    const trimmed = String(word || '').trim();
    if (!trimmed) throw new Error('The keyword is empty');
    this.db.run(
      `INSERT INTO keywords(file_id, word, score, manual) VALUES(?,?,1000,1)
       ON CONFLICT(file_id, word) DO UPDATE SET manual=1, score=1000`,
      fileId, trimmed
    );
    this.emit('changed');
  }

  removeKeyword(fileId, word) {
    this.db.run('DELETE FROM keywords WHERE file_id=? AND word=?', fileId, word);
    this.emit('changed');
  }

  // Fjerner et ord fra en bunke valgte billeder. Det er vejen til at rydde
  // et forkert ord op i én omgang: klik ordet i sidepanelet, marker de
  // billeder det er forkert paa, og fjern det derfra.
  // Er ordet et faelles serieord, som synkSerieOrd ville laegge paa filen
  // igen, hvis det kun blev fjernet her? Saa { serie, fileIds } med alle de
  // af seriens mastre der har ordet; ellers null.
  serieOrd(fileId, word) {
    const img = this.db.get(
      `SELECT i.id, i.series_id, s.name FROM versions v JOIN images i ON i.id = v.image_id
       JOIN series s ON s.id = i.series_id WHERE v.file_id=? OR i.master_file_id=? LIMIT 1`,
      fileId, fileId
    );
    if (!img) return null;
    const mastre = this.db.all('SELECT id FROM images WHERE series_id=?', img.series_id)
      .map((i) => this.masterFil(i.id))
      .filter(Boolean);
    const med = mastre.filter((m) => this.db.get('SELECT 1 AS ok FROM keywords WHERE file_id=? AND word=?', m.id, word));
    const andre = med.filter((m) => m.id !== fileId).length;
    if (andre < 2 || andre * 2 < mastre.length) return null;
    return { serie: img.name, antal: mastre.length, fileIds: med.map((m) => m.id) };
  }

  removeKeywordFromFiles(fileIds, word) {
    const trimmed = String(word || '').trim();
    if (!trimmed || !fileIds || !fileIds.length) return 0;
    let n = 0;
    this.db.transaction(() => {
      for (const id of fileIds) {
        n += this.db.run('DELETE FROM keywords WHERE file_id=? AND word=?', id, trimmed).changes;
      }
    });
    this.emit('changed');
    return n;
  }

  // Rydder alt appen selv har gaettet, og lader det Stef har skrevet ind
  // staa. Bruges naar de automatiske noegleord tages ud af drift, saa
  // chips og soegning ikke bliver ved med at vise gamle gaet.
  // Alle ord, ogsaa Stefs egne. Bruges kun ved skiftet til soegeord for
  // kunderne, som Stef har sagt ja til.
  clearAllKeywords() {
    const antal = this.db.run('DELETE FROM keywords').changes;
    if (antal) this.emit('changed');
    return antal;
  }

  clearAutoKeywords() {
    const antal = this.db.run('DELETE FROM keywords WHERE manual=0').changes;
    if (antal) this.emit('changed');
    return antal;
  }

  // Vaerkerne i en serie skal kunne findes paa de samme ord. Et ord som
  // mindst halvdelen af seriens vaerker har (og mindst to), faar resten af
  // serien ogsaa, som et automatisk ord paa vaerkets master. Hvert vaerk
  // beholder sine egne ord. Returnerer antallet af ord der blev lagt paa.
  synkSerieOrd() {
    let lagtPaa = 0;
    const serier = this.db.all(
      'SELECT series_id AS id FROM images WHERE series_id IS NOT NULL GROUP BY series_id HAVING COUNT(*) > 1'
    );
    for (const { id } of serier) {
      const mastre = this.db.all('SELECT id FROM images WHERE series_id=?', id)
        .map((i) => this.masterFil(i.id))
        .filter(Boolean);
      if (mastre.length < 2) continue;
      const ordPr = mastre.map((m) => new Set(this.keywordsForFile(m.id).map((k) => k.word)));
      const antal = new Map();
      for (const ord of ordPr) for (const w of ord) antal.set(w, (antal.get(w) || 0) + 1);
      const faelles = [...antal].filter(([, n]) => n >= 2 && n * 2 >= mastre.length).map(([w]) => w);
      mastre.forEach((m, i) => {
        for (const w of faelles) {
          if (ordPr[i].has(w)) continue;
          this.db.run(
            'INSERT INTO keywords(file_id, word, score, manual) VALUES(?,?,500,0) ON CONFLICT(file_id, word) DO NOTHING',
            m.id, w
          );
          lagtPaa += 1;
        }
      });
    }
    if (lagtPaa) this.emit('changed');
    return lagtPaa;
  }

  keywordsForFile(fileId) {
    return this.db.all(
      'SELECT word, score, manual FROM keywords WHERE file_id=? ORDER BY manual DESC, score DESC',
      fileId
    );
  }

  // Filer hvis noegleord (auto eller manuelle) indeholder teksten.
  filesWithKeywordLike(text) {
    const soegning = String(text || '').trim().toLowerCase();
    if (!soegning) return [];
    return this.db.all(
      `SELECT DISTINCT k.file_id FROM keywords k
       JOIN files f ON f.id = k.file_id
       WHERE f.present=1 AND lower(k.word) LIKE ? ESCAPE '\\'
       ORDER BY k.file_id`,
      `%${escapeLike(soegning)}%`
    ).map((r) => r.file_id);
  }

  // Tallet skal matche hvad et klik viser: kun filer der er den effektive
  // fil for mindst én ikke-kasseret version taelles med.
  //
  // Listen vises alfabetisk, saa et ord er til at finde. Udvalget sker
  // stadig paa antal: skulle der skaeres, er det de sjaeldneste ord der
  // ryger, ikke dem sidst i alfabetet. En alfabetisk graense ville lade
  // hele enden af alfabetet forsvinde uden varsel.
  topKeywords(limit = 500) {
    return this.db.all(
      `WITH levende AS MATERIALIZED (${effektiveFiler("v.rating != 'kasseret'")})
       SELECT word, antal FROM (
         SELECT k.word AS word, COUNT(DISTINCT k.file_id) AS antal
         FROM keywords k
         JOIN files f ON f.id = k.file_id AND f.present=1
         JOIN levende l ON l.fid = k.file_id
         GROUP BY k.word ORDER BY antal DESC, k.word LIMIT ?
       ) ORDER BY lower(word)`,
      limit
    );
  }

  getMeta(key) {
    const r = this.db.get('SELECT value FROM meta WHERE key=?', key);
    return r ? r.value : null;
  }

  setMeta(key, value) {
    this.db.run(
      'INSERT INTO meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key, value
    );
  }

  counts() {
    const total = this.db.get(
      `SELECT COUNT(*) AS c FROM versions v JOIN images i ON i.id=v.image_id
       JOIN files f ON f.id=COALESCE(v.file_id, i.master_file_id) WHERE f.present=1`
    ).c;
    const byRating = Object.fromEntries(
      this.db.all(
        `SELECT v.rating, COUNT(*) AS c FROM versions v JOIN images i ON i.id=v.image_id
         JOIN files f ON f.id=COALESCE(v.file_id, i.master_file_id)
         WHERE f.present=1 GROUP BY v.rating`
      ).map((r) => [r.rating, r.c])
    );
    const indexed = this.db.get(
      'SELECT COUNT(*) AS c FROM embeddings e JOIN files f ON f.id=e.file_id AND f.present=1'
    ).c;
    return { total, byRating, indexed };
  }
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toRel(root, abs) {
  const rel = abs.startsWith(root) ? abs.slice(root.length).replace(/^[/\\]/, '') : abs;
  return rel.split('\\').join('/');
}
