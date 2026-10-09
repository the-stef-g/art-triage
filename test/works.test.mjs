// Vaerket: docs/plan-shop.md, felterne pr. vaerk. Testene holder oeje
// med det der ellers gaar stille galt: standardvaerdier der skal regnes
// ud, felter der skal afvises, og at alt overlever en genscanning.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { Works, defaultTitle, trailingNumber } from '../electron/lib/works.mjs';
import { exifYearFromBuffer, yearFromExifDate } from '../electron/lib/exif.mjs';

let root;
let db;
let catalog;
let works;

// En minimal JPEG med EXIF: APP1 med en TIFF der har ExifIFD og
// DateTimeOriginal. Bygget i haanden, saa testen ikke er afhaengig af et kamera.
function jpegMedExif(dato, { littleEndian = true } = {}) {
  const le = littleEndian;
  const u16 = (n) => { const b = Buffer.alloc(2); le ? b.writeUInt16LE(n) : b.writeUInt16BE(n); return b; };
  const u32 = (n) => { const b = Buffer.alloc(4); le ? b.writeUInt32LE(n) : b.writeUInt32BE(n); return b; };
  const text = Buffer.from(`${dato}\0`, 'latin1');
  // Layout: header(8) IFD0(2+12+4=18) ExifIFD(2+12+4=18) tekst
  const exifIfdAt = 8 + 18;
  const textAt = exifIfdAt + 18;
  const tiff = Buffer.concat([
    Buffer.from(le ? 'II' : 'MM', 'latin1'), u16(42), u32(8),
    u16(1), u16(0x8769), u16(4), u32(1), u32(exifIfdAt), u32(0),
    u16(1), u16(0x9003), u16(2), u32(text.length), u32(textAt), u32(0),
    text,
  ]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app1.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])]);
}

function skriv(rel, indhold = rel) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, indhold);
}

function imageIdFor(rel) {
  return catalog.listVersions({ visKasserede: true }).find((r) => r.rel_path === rel).image_id;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'art-triage-works-'));
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
  works = new Works(catalog);
});

afterEach(() => {
  try { db.close(); } catch { /* allerede lukket */ }
  rmSync(root, { recursive: true, force: true });
});

describe('standardvaerdier', () => {
  it('bruger filnavnet som titel', () => {
    expect(defaultTitle('serie/Desert Canyon 04.tif')).toBe('Desert Canyon 04');
    skriv('Desert Canyon 04.png');
    catalog.sync();
    const w = works.get(imageIdFor('Desert Canyon 04.png'));
    expect(w.title).toBeNull();
    expect(w.effective.title).toBe('Desert Canyon 04');
  });

  it('tager katalognummeret fra tallet sidst i titlen, med nuller', () => {
    expect(trailingNumber('Desert Canyon 04')).toBe('04');
    expect(trailingNumber('Blue Door')).toBeNull();
    skriv('Desert Canyon 04.png');
    catalog.sync();
    const id = imageIdFor('Desert Canyon 04.png');
    expect(works.get(id).effective.catalogueNumber).toBe('04');
    works.save(id, { catalogue_number: '7' });
    expect(works.get(id).effective.catalogueNumber).toBe('7');
    works.save(id, { catalogue_number: '' });
    expect(works.get(id).effective.catalogueNumber).toBe('04');
  });

  it('tager aaret fra EXIF og ikke fra filens dato', () => {
    skriv('foto.jpg', jpegMedExif('2019:06:14 18:02:11'));
    catalog.sync();
    const id = imageIdFor('foto.jpg');
    const w = works.get(id);
    expect(w.year).toBeNull();
    expect(w.effective.year).toBe(2019);
    works.save(id, { year: 2021 });
    expect(works.get(id).effective.year).toBe(2021);
    works.save(id, { year: '' });
    expect(works.get(id).effective.year).toBe(2019);
  });

  it('giver intet aar naar filen ingen EXIF har', () => {
    skriv('uden.png');
    catalog.sync();
    expect(works.get(imageIdFor('uden.png')).effective.year).toBeNull();
  });
});

describe('EXIF-laeseren', () => {
  it('laeser baade little og big endian', () => {
    expect(exifYearFromBuffer(jpegMedExif('2015:01:02 03:04:05'))).toBe(2015);
    expect(exifYearFromBuffer(jpegMedExif('2016:01:02 03:04:05', { littleEndian: false }))).toBe(2016);
  });

  it('afviser nuldato og vroevl i stedet for at gaette', () => {
    expect(yearFromExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(yearFromExifDate('i gaar')).toBeNull();
    expect(exifYearFromBuffer(Buffer.from('ikke et billede'))).toBeNull();
    expect(exifYearFromBuffer(jpegMedExif('0000:00:00 00:00:00'))).toBeNull();
  });

  it('taaler en afkortet fil', () => {
    const hel = jpegMedExif('2015:01:02 03:04:05');
    expect(() => exifYearFromBuffer(hel.subarray(0, 40))).not.toThrow();
  });
});

describe('felterne', () => {
  let id;
  beforeEach(() => {
    skriv('Blue Door 02.png');
    catalog.sync();
    id = imageIdFor('Blue Door 02.png');
  });

  it('gemmer alle felter og overlever en genscanning', () => {
    works.save(id, {
      category: 'Photography', technique: 'Digital art', template: 'poster',
      section_colour: '#ABC', video: 'film.mp4', prints: true, notes: 'Early light',
      description: 'D', short_text: 'S', alt_text: 'A',
    });
    catalog.sync();
    const w = works.get(id);
    expect(w).toMatchObject({
      category: 'Photography', technique: 'Digital art', template: 'poster',
      sectionColour: '#aabbcc', video: 'film.mp4', prints: true, notes: 'Early light',
      description: 'D', shortText: 'S', altText: 'A',
    });
  });

  it('afviser ukendt kategori, skabelon, farve, aar, pris og felt', () => {
    expect(() => works.save(id, { category: 'Sculpture' })).toThrow(/category/);
    expect(() => works.save(id, { template: 'banner' })).toThrow(/template/);
    expect(() => works.save(id, { section_colour: 'orange' })).toThrow(/colour/);
    expect(() => works.save(id, { year: 99 })).toThrow(/year/);
    expect(() => works.save(id, { price: 'billig' })).toThrow(/price/);
    expect(() => works.save(id, { woo_product_id: 5 })).toThrow(/Unknown/);
  });

  it('tillader tom farve og tom kategori, og saetter pris med komma', () => {
    works.save(id, { section_colour: '#fff', category: 'Paintings', price: '1200,50' });
    works.save(id, { section_colour: '', category: '' });
    const w = works.get(id);
    expect(w.sectionColour).toBeNull();
    expect(w.category).toBeNull();
    expect(w.price).toBe('1200.50');
  });

  it('kender unikke vaerker paa kategorien', () => {
    works.save(id, { category: 'Sculptures' });
    expect(works.get(id).unique).toBe(true);
    works.save(id, { category: 'Photography' });
    expect(works.get(id).unique).toBe(false);
  });

  it('kraever godkendt og faerdig foer det er et vaerk der kan sendes', () => {
    const vid = catalog.listVersions({}).find((r) => r.image_id === id).version_id;
    expect(works.get(id).eligible).toBe(false);
    catalog.setRating([vid], 'godkendt');
    expect(works.get(id).eligible).toBe(false);
    catalog.setStage([vid], 'finished');
    expect(works.get(id).eligible).toBe(true);
    catalog.setRating([vid], 'kandidat');
    expect(works.get(id).eligible).toBe(false);
  });
});

describe('beskaeringer', () => {
  let id;
  let master;
  let kopi1;
  let kopi2;
  beforeEach(() => {
    skriv('Blue Door 02.png');
    catalog.sync();
    id = imageIdFor('Blue Door 02.png');
    master = catalog.listVersions({}).find((r) => r.image_id === id).version_id;
    kopi1 = catalog.createVirtualCopy(master);
    kopi2 = catalog.createVirtualCopy(master);
  });

  it('markerer versioner med hvert sit format', () => {
    works.setCrop(id, kopi1, '2:3');
    works.setCrop(id, kopi2, '1:1');
    expect(works.get(id).crops).toEqual([
      { format: '1:1', versionId: kopi2 },
      { format: '2:3', versionId: kopi1 },
    ]);
  });

  it('flytter formatet naar en anden version faar det', () => {
    works.setCrop(id, kopi1, '2:3');
    works.setCrop(id, kopi2, '2:3');
    expect(works.get(id).crops).toEqual([{ format: '2:3', versionId: kopi2 }]);
  });

  it('giver en version ét format ad gangen, og fjerner det med null', () => {
    works.setCrop(id, kopi1, '2:3');
    works.setCrop(id, kopi1, '3:2');
    expect(works.get(id).crops).toEqual([{ format: '3:2', versionId: kopi1 }]);
    works.setCrop(id, kopi1, null);
    expect(works.get(id).crops).toEqual([]);
  });

  it('afviser ukendt format og en version fra et andet billede', () => {
    skriv('Andet.png');
    catalog.sync();
    const andet = catalog.listVersions({}).find((r) => r.rel_path === 'Andet.png').version_id;
    expect(() => works.setCrop(id, kopi1, '4:3')).toThrow(/format/);
    expect(() => works.setCrop(id, andet, '1:1')).toThrow(/belong/);
  });

  it('fjerner markeringen naar versionen slettes', () => {
    works.setCrop(id, kopi1, '2:3');
    catalog.deleteVersion(kopi1);
    expect(works.get(id).crops).toEqual([]);
  });
});

describe('beskaeringer fra filnavnene', () => {
  it('er filerne i Masters med et format i navnet, og de gamle markeringer fylder hullerne', () => {
    catalog.mappestyring = true;
    skriv('Blue Door 02.cr2');
    catalog.sync();
    const id = imageIdFor('Blue Door 02.cr2');
    catalog.setRating([catalog.listVersions({}).find((r) => r.image_id === id).version_id], 'godkendt');
    skriv('Approved/Blue Door 02/Masters/Blue Door 02 3-2.tif');
    skriv('Approved/Blue Door 02/Masters/Blue Door 02 1-1.tif');
    skriv('Approved/Blue Door 02/Masters/Blue Door 02 uden.tif');
    catalog.sync();
    const rows = catalog.listVersions({}).filter((r) => r.image_id === id);
    const vid = (navn) => rows.find((r) => r.rel_path.endsWith(navn)).version_id;
    expect(works.get(id).crops).toEqual([
      { format: '1:1', versionId: vid('1-1.tif') },
      { format: '3:2', versionId: vid('3-2.tif') },
    ]);
    // En markering lavet i haanden for et format ingen fil har, gaelder stadig.
    works.setCrop(id, vid('uden.tif'), '2:3');
    expect(works.get(id).crops.map((c) => c.format)).toEqual(['1:1', '2:3', '3:2']);
  });
});

describe('tekster fra Claude', () => {
  let id;
  beforeEach(() => {
    skriv('Blue Door 02.png');
    catalog.sync();
    id = imageIdFor('Blue Door 02.png');
  });

  it('regner kun egne rettelser som rettede', () => {
    expect(works.get(id).editedTexts).toEqual([]);
    works.saveGeneratedTexts(id, { description: 'Claude D', short_text: 'Claude S', alt_text: 'Claude A' });
    expect(works.get(id).editedTexts).toEqual([]);
    works.save(id, { short_text: 'Min egen' });
    expect(works.get(id).editedTexts).toEqual(['short_text']);
  });

  it('regner en tekst skrevet i haanden for rettet', () => {
    works.save(id, { alt_text: 'Skrevet selv' });
    expect(works.get(id).editedTexts).toEqual(['alt_text']);
  });

  it('er ikke rettet naar man skriver det samme som Claude', () => {
    works.saveGeneratedTexts(id, { description: 'Claude D' });
    works.save(id, { description: 'Claude D' });
    expect(works.get(id).editedTexts).toEqual([]);
  });
});

describe('woo-id', () => {
  it('gemmes og overlever en genscanning', () => {
    skriv('Blue Door 02.png');
    catalog.sync();
    const id = imageIdFor('Blue Door 02.png');
    works.setWooProductId(id, 4711);
    catalog.sync();
    expect(works.get(id).wooProductId).toBe(4711);
  });
});

describe('seriens felter til shoppen', () => {
  let id;
  let serieId;
  beforeEach(() => {
    skriv('Blue Door 02.png');
    catalog.sync();
    id = imageIdFor('Blue Door 02.png');
    serieId = catalog.createSeries('Blue Doors');
    catalog.assignSeries([id], serieId);
  });

  it('er tomme som udgangspunkt, saa Woo ikke faar en standardvaerdi', () => {
    expect(works.get(id).series).toEqual({ id: serieId, name: 'Blue Doors', intro: null, template: null, colour: null });
  });

  it('gemmer intro, skabelon og farve', () => {
    catalog.setSeriesShop(serieId, { intro: ' Two lines ', template: 'wall', colour: '#ABC' });
    expect(works.get(id).series).toMatchObject({ intro: 'Two lines', template: 'wall', colour: '#aabbcc' });
    catalog.setSeriesShop(serieId, { template: '' });
    expect(works.get(id).series.template).toBeNull();
  });

  it('afviser ukendt skabelon, farve og felt', () => {
    expect(() => catalog.setSeriesShop(serieId, { template: 'grid' })).toThrow(/template/);
    expect(() => catalog.setSeriesShop(serieId, { colour: 'gul' })).toThrow(/colour/);
    expect(() => catalog.setSeriesShop(serieId, { name: 'x' })).toThrow(/Unknown/);
  });

  it('har ingen serie paa et vaerk uden serie', () => {
    catalog.assignSeries([id], null);
    expect(works.get(id).series).toBeNull();
  });
});
