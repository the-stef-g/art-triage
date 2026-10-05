// Vaerket: alt der hoerer til et billede foer det sendes til shoppen.
// Tekster rettes kun her; Woo er en kopi (docs/plan-shop.md). Alt gemmes
// i kataloget, saa det overlever genstart og genscanning.
import { basename } from 'node:path';
import { stemOf } from './util.mjs';
import { exifYear } from './exif.mjs';

export const CATEGORIES = ['Graphic Design', 'Photography', 'Paintings', 'Sculptures'];
// Unikke vaerker: ét eksemplar, mål og én pris. Resten sælges som print.
export const UNIQUE_CATEGORIES = new Set(['Paintings', 'Sculptures']);
export const TEMPLATES = ['spread', 'poster'];
export const CROP_FORMATS = ['1:1', '2:3', '3:2', '1:2', '2:1'];
export const TEXT_FIELDS = ['description', 'short_text', 'alt_text'];

// Felter der kan rettes, og hvordan hvert ét gøres rent foer det gemmes.
// Alt der ikke staar her afvises, saa en tastefejl i UI'et ikke ender som
// en stille kolonne.
function tekst(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

const FELTER = {
  title: tekst,
  year(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1000 || n > 2999) throw new Error('The year must be a four-digit year');
    return n;
  },
  category(v) {
    const s = tekst(v);
    if (s && !CATEGORIES.includes(s)) throw new Error(`Unknown category: ${s}`);
    return s;
  },
  technique: tekst,
  template(v) {
    if (!TEMPLATES.includes(v)) throw new Error(`Unknown template: ${v}`);
    return v;
  },
  section_colour(v) {
    const s = tekst(v);
    if (!s) return null;
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (!m) throw new Error('The colour must be a hex colour such as #c2410c');
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return `#${hex.toLowerCase()}`;
  },
  catalogue_number: tekst,
  video: tekst,
  prints: (v) => (v ? 1 : 0),
  dimensions: tekst,
  price(v) {
    const s = tekst(v);
    if (!s) return null;
    const n = s.replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(n)) throw new Error('The price must be a number such as 1200 or 1200.50');
    return n;
  },
  notes: tekst,
  description: tekst,
  short_text: tekst,
  alt_text: tekst,
};

// Titlen er filnavnet uden endelse, medmindre den er rettet.
export function defaultTitle(relPath) {
  return stemOf(basename(relPath));
}

// Katalognummeret er tallet sidst i titlen: "Desert Canyon 04" -> "04".
// Foranstillede nuller bevares, for det er sådan titlen skrives.
export function trailingNumber(title) {
  const m = /(\d+)\s*$/.exec(String(title || ''));
  return m ? m[1] : null;
}

export class Works {
  constructor(catalog) {
    this.catalog = catalog;
    this.db = catalog.db;
  }

  _image(imageId) {
    const row = this.db.get(
      `SELECT i.id, i.series_id, s.name AS series_name, f.rel_path, f.id AS file_id
       FROM images i
       JOIN files f ON f.id = i.master_file_id
       LEFT JOIN series s ON s.id = i.series_id
       WHERE i.id=?`,
      imageId
    );
    if (!row) throw new Error('That image does not exist');
    return row;
  }

  // Raekken oprettes foerste gang. EXIF-aaret slaas op én gang og husker,
  // at der er kigget, saa et eksternt drev ikke skal laeses ved hver visning.
  _ensure(img) {
    let row = this.db.get('SELECT * FROM works WHERE image_id=?', img.id);
    if (!row) {
      this.db.run('INSERT INTO works(image_id, updated_at) VALUES(?,?)', img.id, this.catalog.now());
      row = this.db.get('SELECT * FROM works WHERE image_id=?', img.id);
    }
    if (!row.exif_checked) {
      const file = this.catalog.getFile(img.file_id);
      if (file?.present) {
        const year = exifYear(this.catalog.abs(file.rel_path));
        this.db.run('UPDATE works SET exif_year=?, exif_checked=1 WHERE image_id=?', year, img.id);
        row = { ...row, exif_year: year, exif_checked: 1 };
      }
    }
    return row;
  }

  // Godkendt og faerdig: først da er billedet et vaerk der kan sendes.
  isEligible(imageId) {
    return Boolean(this.db.get(
      "SELECT 1 AS ok FROM versions WHERE image_id=? AND rating='godkendt' AND finished=1 LIMIT 1",
      imageId
    ));
  }

  cropsFor(imageId) {
    return this.db.all(
      'SELECT format, version_id FROM work_crops WHERE image_id=?',
      imageId
    ).map((r) => ({ format: r.format, versionId: r.version_id }))
      .sort((a, b) => CROP_FORMATS.indexOf(a.format) - CROP_FORMATS.indexOf(b.format));
  }

  get(imageId) {
    const img = this._image(imageId);
    const row = this._ensure(img);
    const title = row.title || defaultTitle(img.rel_path);
    const generated = parseGenerated(row.generated);
    return {
      imageId,
      title: row.title,
      year: row.year,
      category: row.category,
      technique: row.technique,
      template: row.template,
      sectionColour: row.section_colour,
      catalogueNumber: row.catalogue_number,
      video: row.video,
      prints: Boolean(row.prints),
      dimensions: row.dimensions,
      price: row.price,
      notes: row.notes,
      description: row.description,
      shortText: row.short_text,
      altText: row.alt_text,
      wooProductId: row.woo_product_id,
      crops: this.cropsFor(imageId),
      seriesId: img.series_id,
      seriesName: img.series_name,
      // Det der faktisk bruges, naar feltet er tomt.
      effective: {
        title,
        year: row.year ?? row.exif_year ?? null,
        catalogueNumber: row.catalogue_number || trailingNumber(title),
      },
      unique: UNIQUE_CATEGORIES.has(row.category),
      eligible: this.isEligible(imageId),
      editedTexts: editedTexts(row, generated),
    };
  }

  // patch bruger de samme navne som kolonnerne. Ukendte felter afvises.
  save(imageId, patch) {
    const img = this._image(imageId);
    this._ensure(img);
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(patch || {})) {
      const rens = FELTER[key];
      if (!rens) throw new Error(`Unknown work field: ${key}`);
      sets.push(`${key}=?`);
      params.push(rens(value));
    }
    if (sets.length) {
      sets.push('updated_at=?');
      params.push(this.catalog.now(), imageId);
      this.db.run(`UPDATE works SET ${sets.join(', ')} WHERE image_id=?`, ...params);
    }
    return this.get(imageId);
  }

  // Markerer en version som en beskaering, eller fjerner markeringen med
  // format=null. Formatet flytter med, hvis en anden version havde det.
  setCrop(imageId, versionId, format) {
    this._image(imageId);
    const v = this.db.get('SELECT image_id FROM versions WHERE id=?', versionId);
    if (!v || v.image_id !== imageId) throw new Error('That version does not belong to this image');
    if (format !== null && format !== undefined && !CROP_FORMATS.includes(format)) {
      throw new Error(`Unknown crop format: ${format}`);
    }
    this.db.transaction(() => {
      this.db.run('DELETE FROM work_crops WHERE version_id=?', versionId);
      if (format) {
        this.db.run('DELETE FROM work_crops WHERE image_id=? AND format=?', imageId, format);
        this.db.run(
          'INSERT INTO work_crops(version_id, image_id, format) VALUES(?,?,?)',
          versionId, imageId, format
        );
      }
    });
    return this.cropsFor(imageId);
  }

  // Claudes udkast gemmes sammen med en kopi af det der blev genereret.
  // Saa kan appen senere se, om Stef har rettet i en tekst, og spoerge
  // foer den overskrives.
  saveGeneratedTexts(imageId, texts) {
    const img = this._image(imageId);
    this._ensure(img);
    const generated = {};
    const sets = [];
    const params = [];
    for (const field of TEXT_FIELDS) {
      if (texts[field] === undefined) continue;
      const clean = tekst(texts[field]);
      generated[field] = clean;
      sets.push(`${field}=?`);
      params.push(clean);
    }
    if (!sets.length) return this.get(imageId);
    const old = parseGenerated(this.db.get('SELECT generated FROM works WHERE image_id=?', imageId).generated);
    this.db.run(
      `UPDATE works SET ${sets.join(', ')}, generated=?, updated_at=? WHERE image_id=?`,
      ...params, JSON.stringify({ ...old, ...generated }), this.catalog.now(), imageId
    );
    return this.get(imageId);
  }

  // Woo-produktets id gemmes, saa der aldrig laves dubletter.
  setWooProductId(imageId, id) {
    this._ensure(this._image(imageId));
    this.db.run('UPDATE works SET woo_product_id=?, updated_at=? WHERE image_id=?', id ?? null, this.catalog.now(), imageId);
  }
}

function parseGenerated(json) {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

// Tekster der staar der og ikke er det Claude skrev. En tekst uden
// "genereret" kopi er skrevet i haanden og regnes som rettet.
function editedTexts(row, generated) {
  const out = [];
  for (const field of TEXT_FIELDS) {
    const nu = row[field];
    if (nu && nu !== generated[field]) out.push(field);
  }
  return out;
}
