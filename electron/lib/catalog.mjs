// Katalogmotoren: holder databasen i sync med mappen paa disken og ejer
// al logik om billeder, versioner (virtuelle kopier), status, serier og
// filflytning. GUI-lag og AI-lag taler kun med denne klasse.
import { EventEmitter } from 'node:events';
import {
  copyFileSync, mkdirSync, renameSync, existsSync, statSync,
} from 'node:fs';
import { join, dirname, basename, extname, posix } from 'node:path';
import {
  walkImages, walkDirs, quickHash, stemOf, slug, uniquePath, extOf, daCollator,
} from './util.mjs';

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
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_versions_image ON versions(image_id);
CREATE INDEX IF NOT EXISTS idx_versions_file ON versions(file_id);
CREATE INDEX IF NOT EXISTS idx_keywords_word ON keywords(word);
`;

export class Catalog extends EventEmitter {
  constructor(db, root) {
    super();
    this.db = db;
    this.root = root;
    db.exec(SCHEMA);
    this._migrate();
  }

  // Skemamigreringer for biblioteker oprettet med aeldre versioner.
  _migrate() {
    const kolonner = this.db.all('PRAGMA table_info(keywords)').map((k) => k.name);
    if (!kolonner.includes('manual')) {
      this.db.exec('ALTER TABLE keywords ADD COLUMN manual INTEGER NOT NULL DEFAULT 0');
    }
  }

  abs(rel) {
    return join(this.root, rel);
  }

  now() {
    return Date.now();
  }

  // ---------- Scanning og synkronisering ----------

  // Koerer en fuld afstemning mellem disk og database. Idempotent, saa
  // watcheren kan kalde den ved enhver aendring.
  sync() {
    const disk = new Map(walkImages(this.root).map((f) => [f.rel, f]));
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
            hash = quickHash(this.abs(row.rel_path), d.size);
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
          hash = quickHash(this.abs(n.rel), n.size);
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

        const stackImage = this._findStackTarget(n.rel);
        if (stackImage) {
          this.db.run(
            'INSERT INTO versions(image_id, file_id, name, is_master, rating, edited, created_at) VALUES(?,?,?,0,?,1,?)',
            stackImage.imageId, fileId, stackImage.versionName, 'ubedomt', this.now()
          );
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
        changedFileIds.push(fileId);
      }
    });

    if (changedFileIds.length || missing.length) this.emit('changed');
    if (editedFileIds.length) this.emit('files-edited', editedFileIds);
    return { changed: changedFileIds.length, edited: editedFileIds.length };
  }

  // Saetter redigeret-flag paa alle versioner der bruger denne fil.
  _markEdited(fileId) {
    this.db.run('UPDATE versions SET edited=1 WHERE file_id=?', fileId);
    this.db.run(
      `UPDATE versions SET edited=1 WHERE file_id IS NULL AND image_id IN
        (SELECT id FROM images WHERE master_file_id=?)`,
      fileId
    );
  }

  // Finder det billede en ny, afledt fil hoerer til: samme mappe og et
  // stem der starter med et eksisterende billedes stem (fx
  // "IMG_1234-gigapixel.tif" hoerer til "IMG_1234.CR2").
  _findStackTarget(rel) {
    const dir = posix.dirname(rel);
    const stem = stemOf(posix.basename(rel));
    const prefix = dir === '.' ? '' : `${dir}/`;
    const siblings = this.db.all(
      `SELECT f.id, f.rel_path FROM files f
       WHERE f.present=1 AND f.rel_path LIKE ? AND f.rel_path NOT LIKE ?`,
      `${prefix}%`, `${prefix}%/%`
    );
    let best = null;
    for (const s of siblings) {
      if (s.rel_path === rel) continue; // ikke matche sig selv
      const sStem = stemOf(posix.basename(s.rel_path));
      if (sStem === stem) {
        // Samme navn, anden filtype: hoerer sammen.
        if (!best || sStem.length > best.stemLen) best = { fileId: s.id, stemLen: sStem.length, suffix: '' };
      } else if (
        stem.startsWith(sStem) &&
        /^[-_. ()]/.test(stem.slice(sStem.length))
      ) {
        if (!best || sStem.length > best.stemLen) {
          best = { fileId: s.id, stemLen: sStem.length, suffix: stem.slice(sStem.length) };
        }
      }
    }
    if (!best) return null;
    const owner = this._imageForFile(best.fileId);
    if (!owner) return null;
    const suffix = best.suffix.replace(/^[-_. ()]+|[)]+$/g, '');
    const versionName = suffix || extOf(rel).toUpperCase();
    return { imageId: owner.imageId, versionName };
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
              v.rating, v.edited, v.finished,
              f.id AS file_id, f.rel_path, f.mtime, f.size,
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
      rows.sort((a, b) =>
        daCollator.compare(a.rel_path, b.rel_path)
        || (b.is_master - a.is_master)
        || (a.version_id - b.version_id));
    }
    return rows;
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

  filePathForVersion(versionId) {
    const v = this.getVersion(versionId);
    if (!v) return null;
    const f = this.getFile(v.effective_file_id);
    return f ? this.abs(f.rel_path) : null;
  }

  // ---------- Status ----------

  setRating(versionIds, rating) {
    if (!['ubedomt', 'godkendt', 'kasseret'].includes(rating)) {
      throw new Error(`Ukendt bedømmelse: ${rating}`);
    }
    this.db.transaction(() => {
      for (const id of versionIds) {
        this.db.run('UPDATE versions SET rating=? WHERE id=?', rating, id);
      }
    });
    this.emit('changed');
  }

  setFlag(versionIds, flag, value) {
    if (!['edited', 'finished'].includes(flag)) throw new Error(`Ukendt flag: ${flag}`);
    this.db.transaction(() => {
      for (const id of versionIds) {
        this.db.run(`UPDATE versions SET ${flag}=? WHERE id=?`, value ? 1 : 0, id);
      }
    });
    this.emit('changed');
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
    const r = this.db.run(
      'INSERT INTO versions(image_id, file_id, name, is_master, created_at) VALUES(?,NULL,?,0,?)',
      v.image_id, name, this.now()
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
    if (!master || !master.present) throw new Error('Masterfilen mangler på disken');
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
              f.rel_path, f.mtime
       FROM versions v
       JOIN images i ON i.id = v.image_id
       JOIN files f ON f.id = COALESCE(v.file_id, i.master_file_id)
       WHERE v.image_id=? ORDER BY v.is_master DESC, v.id ASC`,
      imageId
    );
  }

  // ---------- Serier ----------

  listSeries() {
    return this.db.all(
      `SELECT s.id, s.name, COUNT(i.id) AS image_count
       FROM series s LEFT JOIN images i ON i.series_id = s.id
       GROUP BY s.id ORDER BY s.name COLLATE NOCASE`
    );
  }

  createSeries(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Serien skal have et navn');
    const existing = this.db.get('SELECT id FROM series WHERE name=?', trimmed);
    if (existing) return existing.id;
    return this.db.run('INSERT INTO series(name) VALUES(?)', trimmed).lastInsertRowid;
  }

  assignSeries(imageIds, seriesId) {
    this.db.transaction(() => {
      for (const id of imageIds) {
        this.db.run('UPDATE images SET series_id=? WHERE id=?', seriesId ?? null, id);
      }
    });
    this.emit('changed');
  }

  deleteSeries(seriesId) {
    this.db.run('DELETE FROM series WHERE id=?', seriesId);
    this.emit('changed');
  }

  // ---------- Mapper og flytning ----------

  folderTree() {
    const dirs = walkDirs(this.root);
    const counts = new Map();
    for (const f of this.db.all('SELECT rel_path FROM files WHERE present=1')) {
      const dir = posix.dirname(f.rel_path);
      const key = dir === '.' ? '' : dir;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const rootNode = { name: basename(this.root), rel: '', children: [], count: counts.get('') || 0 };
    const byRel = new Map([['', rootNode]]);
    for (const rel of dirs) {
      const node = { name: posix.basename(rel), rel, children: [], count: counts.get(rel) || 0 };
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
    if (moved.length) this.emit('changed');
    return moved;
  }

  // Flytter filer hvor ALLE tilknyttede versioner er kasserede til _kasseret/.
  moveDiscarded() {
    const rows = this.db.all(
      `SELECT DISTINCT f.id FROM files f
       WHERE f.present=1 AND f.rel_path NOT LIKE '\\_kasseret/%' ESCAPE '\\'
       AND EXISTS (
         SELECT 1 FROM versions v JOIN images i ON i.id=v.image_id
         WHERE COALESCE(v.file_id, i.master_file_id)=f.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM versions v JOIN images i ON i.id=v.image_id
         WHERE COALESCE(v.file_id, i.master_file_id)=f.id AND v.rating != 'kasseret'
       )`
    );
    return this.moveFiles(rows.map((r) => r.id), '_kasseret');
  }

  // ---------- Embeddings og noegleord ----------

  filesNeedingEmbedding(model) {
    return this.db.all(
      `SELECT f.id, f.rel_path, f.mtime FROM files f
       WHERE f.present=1
       AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.file_id=f.id AND e.model=?)`,
      model
    );
  }

  saveEmbedding(fileId, model, vec) {
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    this.db.run(
      `INSERT INTO embeddings(file_id, model, dim, vec, indexed_at) VALUES(?,?,?,?,?)
       ON CONFLICT(file_id) DO UPDATE SET model=excluded.model, dim=excluded.dim,
         vec=excluded.vec, indexed_at=excluded.indexed_at`,
      fileId, model, vec.length, buf, this.now()
    );
  }

  clearEmbedding(fileId) {
    this.db.run('DELETE FROM embeddings WHERE file_id=?', fileId);
    this.db.run('DELETE FROM keywords WHERE file_id=?', fileId);
  }

  allEmbeddings(model) {
    return this.db.all(
      `SELECT e.file_id, e.dim, e.vec FROM embeddings e
       JOIN files f ON f.id = e.file_id
       WHERE e.model=? AND f.present=1`,
      model
    );
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

  addKeyword(fileId, word) {
    const trimmed = String(word || '').trim();
    if (!trimmed) throw new Error('Noegleordet er tomt');
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

  topKeywords(limit = 40) {
    return this.db.all(
      `SELECT word, COUNT(*) AS antal FROM keywords k
       JOIN files f ON f.id=k.file_id
       WHERE f.present=1 GROUP BY word ORDER BY antal DESC, word LIMIT ?`,
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
