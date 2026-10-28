// De fem faser: Sort, Edit, Product, Crops og Print. Fasen er ikke en status
// man saetter, den foelger af mapperne, og det er det testene holder oeje med.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, utimesSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { editorFraSti, udenEditorSuffiks, masterNavn } from '../electron/lib/util.mjs';
import { exifTidFromBuffer } from '../electron/lib/exif.mjs';
import { lavMaster } from '../electron/lib/master.mjs';

let root;
let db;
let catalog;

function skriv(rel, indhold = rel) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, indhold);
}
const alle = () => catalog.listVersions({ visKasserede: true });
const raekke = (rel) => alle().find((r) => r.rel_path === rel);
const fase = (n) => catalog.listVersions({ fase: n }).map((r) => r.rel_path).sort();

// En minimal JPEG med DateTimeOriginal (og evt. SubSecTimeOriginal).
function jpegMedTid(dato, subsec = null) {
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const text = Buffer.from(`${dato}\0`, 'latin1');
  const sub = subsec === null ? null : Buffer.from(`${subsec}\0`, 'latin1');
  const n = sub ? 2 : 1;
  const exifAt = 8 + 18;
  const exifSize = 2 + 12 * n + 4;
  const textAt = exifAt + exifSize;
  const subAt = textAt + text.length;
  const felter = [Buffer.concat([u16(0x9003), u16(2), u32(text.length), u32(textAt)])];
  if (sub) felter.push(Buffer.concat([u16(0x9291), u16(2), u32(sub.length), sub.length > 4 ? u32(subAt) : Buffer.concat([sub, Buffer.alloc(4 - sub.length)])]));
  const tiff = Buffer.concat([
    Buffer.from('II', 'latin1'), u16(42), u32(8),
    u16(1), u16(0x8769), u16(4), u32(1), u32(exifAt), u32(0),
    u16(n), ...felter, u32(0),
    text, ...(sub && sub.length > 4 ? [sub] : []),
  ]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app1.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])]);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'sga-faser-'));
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
  skriv('Import/Ahl/x.cr2', 'x');
  skriv('Import/Ahl/y.cr2', 'y');
  skriv('Import/Ahl/z.cr2', 'z');
  catalog.brugMappestruktur();
  catalog.sync();
});

afterEach(() => {
  try { db.close(); } catch { /* lukket */ }
  rmSync(root, { recursive: true, force: true });
});

describe('fasen foelger af mapperne', () => {
  it('Sort, Edit, Product, Crops og Print', () => {
    catalog.setRating([raekke('Import/Ahl/x.cr2').version_id], 'godkendt');
    catalog.setRating([raekke('Import/Ahl/y.cr2').version_id], 'godkendt');
    catalog.setRating([raekke('Import/Ahl/z.cr2').version_id], 'kandidat');
    skriv('Approved/x/Edits/x-neo.tif', 'e');
    skriv('Approved/y/Master/y.tif', 'm');
    skriv('Approved/y/Master/y 2-3.tif', 'c');
    // Et vaerk med en master er ude af Edit, ogsaa med sine filer i Edits.
    skriv('Approved/y/Edits/y-denoise.tif', 'd');
    catalog.sync();

    expect(fase(1)).toEqual(['Candidate/Ahl/z.cr2']);
    expect(fase(2)).toEqual(['Approved/x/Edits/x-neo.tif', 'Approved/x/Original/x.cr2']);
    expect(catalog.editVaerker()).toEqual(['x']);
    expect(fase(3)).toEqual(['Approved/y/Master/y.tif']); // én flise pr. vaerk
    expect(fase(4)).toEqual(['Approved/y/Master/y 2-3.tif', 'Approved/y/Master/y.tif']);
    expect(fase(5)).toEqual(['Approved/y/Master/y 2-3.tif']);
    expect(catalog.faseTal()).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });
  });

  it('i Product vises en beskaering, hvis vaerket kun har beskaerne mastere', () => {
    catalog.setRating([raekke('Import/Ahl/x.cr2').version_id], 'godkendt');
    skriv('Approved/x/Master/x 1-1.tif', 'c');
    catalog.sync();
    expect(fase(3)).toEqual(['Approved/x/Master/x 1-1.tif']);
  });
});

describe('programmet staar i filnavnet', () => {
  it('den sidste endelse er det seneste program, og kun i Edits', () => {
    expect(editorFraSti('Approved/w/Edits/a-neo.tif')).toBe('Luminar Neo');
    expect(editorFraSti('Approved/w/Edits/a-neo-tp.tif')).toBe('Topaz Photo AI');
    expect(editorFraSti('Approved/w/Edits/a-neo-Edit.jpg')).toBe('Luminar Neo');
    expect(editorFraSti('Approved/w/Edits/a-ps 1.psd')).toBe('Photoshop');
    expect(editorFraSti('Approved/w/Edits/neon.tif')).toBe(null);
    expect(editorFraSti('Approved/w/Master/a-neo.tif')).toBe(null);
    expect(udenEditorSuffiks('Desert-neo-tp')).toBe('Desert');
    // Masterens navn: vaerkets navn naar redigeringen begynder med det,
    // ellers uden de kendte endelser, uanset store og smaa bogstaver og
    // med eller uden bindestreg.
    expect(masterNavn('IMG_1234-Denoise-paint-tp', 'IMG_1234')).toBe('IMG_1234');
    expect(masterNavn('img_1234denoise', 'IMG_1234')).toBe('IMG_1234');
    expect(masterNavn('Desert Canyon-denoise', 'IMG_9')).toBe('Desert Canyon');
    expect(masterNavn('Desert Canyon Sketch_PS', 'IMG_9')).toBe('Desert Canyon');
    expect(masterNavn('Desert Canyonpano', 'IMG_9')).toBe('Desert Canyon');
    expect(masterNavn('Lamps', 'IMG_9')).toBe('Lamps');
    expect(masterNavn('Lamps-ps', 'IMG_9')).toBe('Lamps');
    expect(masterNavn('Paint', 'IMG_9')).toBe('Paint');
    expect(udenEditorSuffiks('Desert-neo-Edit')).toBe('Desert-Edit');
  });

  it('vises som Edits-status paa flisen', () => {
    catalog.setRating([raekke('Import/Ahl/x.cr2').version_id], 'godkendt');
    skriv('Approved/x/Edits/x-ps.psd', 'e');
    catalog.sync();
    expect(raekke('Approved/x/Edits/x-ps.psd')).toMatchObject({ editor: 'Photoshop', edited: 1 });
  });
});

describe('fase 2', () => {
  beforeEach(() => {
    catalog.setRating([raekke('Import/Ahl/x.cr2').version_id], 'godkendt');
  });

  it('en kopi til et program faar endelsen og ligger i Edits', () => {
    const id = raekke('Approved/x/Original/x.cr2').version_id;
    const a = catalog.kopiTilEdits(id, 'neo');
    expect(a).toBe(join(root, 'Approved/x/Edits/x-neo.cr2'));
    expect(readFileSync(a, 'utf8')).toBe('x');
    const b = catalog.kopiTilEdits(id, 'neo');
    expect(b).not.toBe(a); // overskriver aldrig
    catalog.sync();
    const kopi = raekke('Approved/x/Edits/x-neo.cr2');
    expect(kopi.editor).toBe('Luminar Neo');
    // Videre fra en redigering: endelserne kaedes.
    expect(catalog.kopiTilEdits(kopi.version_id, 'tp')).toBe(join(root, 'Approved/x/Edits/x-neo-tp.cr2'));
    expect(() => catalog.kopiTilEdits(raekke('Import/Ahl/y.cr2').version_id, 'neo')).toThrow(/Approved/);
  });

  it('en master laves af redigeringen og hedder som vaerket', async () => {
    skriv('Approved/x/Edits/x-neo-tp.tif', 'redigeret');
    catalog.sync();
    const maal = catalog.masterMaal(raekke('Approved/x/Edits/x-neo-tp.tif').version_id);
    const res = await lavMaster(maal);
    expect(res.path).toBe(join(root, 'Approved/x/Master/x.tif'));
    expect(res.konverteret).toBe(false);
    catalog.sync();
    expect(fase(2)).toEqual([]);
    expect(fase(3)).toEqual(['Approved/x/Master/x.tif']);
    expect(raekke('Approved/x/Original/x.cr2').finished).toBe(1);
  });

  it('en RAW kan ikke vaere master, og en PSD kraever macOS', async () => {
    const raw = catalog.masterMaal(raekke('Approved/x/Original/x.cr2').version_id);
    await expect(lavMaster(raw)).rejects.toThrow(/RAW/);
    skriv('Approved/x/Edits/x-ps.psd', 'psd');
    catalog.sync();
    const psd = catalog.masterMaal(raekke('Approved/x/Edits/x-ps.psd').version_id);
    await expect(lavMaster({ ...psd, platform: 'linux' })).rejects.toThrow(/macOS/);
    const kald = [];
    const res = await lavMaster({
      ...psd, platform: 'darwin',
      runner: async (cmd, args) => { kald.push(args); writeFileSync(args[args.indexOf('--out') + 1], 'tiff'); },
    });
    expect(res.path).toBe(join(root, 'Approved/x/Master/x.tif'));
    expect(kald[0].slice(0, 3)).toEqual(['-s', 'format', 'tiff']);
  });

  it('kassér: originalen til Discarded, redigeringerne ud af kataloget', () => {
    skriv('Approved/x/Edits/x-neo.tif', 'e');
    catalog.sync();
    const { filer, arbejdsmappe } = catalog.kasserVaerk(raekke('Approved/x/Edits/x-neo.tif').version_id);
    expect(filer).toEqual([join(root, 'Approved/x/Edits/x-neo.tif')]);
    expect(arbejdsmappe).toBe(join(root, 'Approved/x'));
    expect(existsSync(join(root, 'Discarded/x/x.cr2'))).toBe(true);
    expect(raekke('Discarded/x/x.cr2').rating).toBe('kasseret');
    expect(raekke('Approved/x/Edits/x-neo.tif')).toBeUndefined();
    expect(fase(2)).toEqual([]);
  });

  it('et vaerk med en master kan ikke kasseres herfra', () => {
    skriv('Approved/x/Master/x.tif', 'm');
    catalog.sync();
    expect(() => catalog.kasserVaerk(raekke('Approved/x/Master/x.tif').version_id)).toThrow(/master/);
  });
});

describe('filer man selv lægger i Edits', () => {
  it('en fil der allerede var i kataloget og flyttes ind i Edits, bliver en del af vaerket', () => {
    skriv('Import/Ahl/andet.tif', 'tif');
    catalog.sync();
    catalog.setRating([raekke('Import/Ahl/x.cr2').version_id], 'godkendt');
    renameSync(join(root, 'Import/Ahl/andet.tif'), join(root, 'Approved/x/Edits/andet.tif'));
    catalog.sync();
    const r = raekke('Approved/x/Edits/andet.tif');
    expect(r.rating).toBe('godkendt');
    expect(r.image_id).toBe(raekke('Approved/x/Original/x.cr2').image_id);
    expect(fase(2)).toContain('Approved/x/Edits/andet.tif');
    expect(fase(1)).not.toContain('Approved/x/Edits/andet.tif');
    // Og det sker kun én gang.
    expect(catalog._tilknytArbejdsmapper()).toBe(0);
  });
});

describe('tomme mapper i Import', () => {
  it('slettes ved en skanning, naar de har staaet tomme et stykke tid', () => {
    mkdirSync(join(root, 'Import', 'Gammel', 'Under'), { recursive: true });
    mkdirSync(join(root, 'Import', 'Ny'), { recursive: true });
    const gammel = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(join(root, 'Import', 'Gammel', 'Under'), gammel, gammel);
    utimesSync(join(root, 'Import', 'Gammel'), gammel, gammel);
    catalog.sync();
    expect(existsSync(join(root, 'Import', 'Gammel'))).toBe(false);
    // En mappe man lige har lavet, faar lov at staa.
    expect(existsSync(join(root, 'Import', 'Ny'))).toBe(true);
    expect(existsSync(join(root, 'Import'))).toBe(true);
  });
});

describe('gamle mappenavne', () => {
  it('omdoeber Originals og Masters til Original og Master og beholder bedoemmelsen', () => {
    catalog.setRating([raekke('Import/Ahl/x.cr2').version_id], 'godkendt');
    // Som et bibliotek fra foer 0.16: mapperne hed Originals og Masters.
    const nu = join(root, 'Approved', 'x');
    rmSync(join(nu, 'Master'), { recursive: true, force: true });
    mkdirSync(join(nu, 'Originals'), { recursive: true });
    writeFileSync(join(nu, 'Originals', 'x.cr2'), readFileSync(join(nu, 'Original', 'x.cr2')));
    rmSync(join(nu, 'Original'), { recursive: true, force: true });
    skriv('Approved/x/Masters/x 2-3.tif', 'm');
    db.run("UPDATE files SET rel_path='Approved/x/Originals/x.cr2' WHERE rel_path='Approved/x/Original/x.cr2'");
    catalog.sync();
    expect(raekke('Approved/x/Originals/x.cr2').rating).toBe('godkendt');

    catalog.brugMappestruktur();
    expect(existsSync(join(nu, 'Originals'))).toBe(false);
    expect(existsSync(join(nu, 'Masters'))).toBe(false);
    expect(existsSync(join(nu, 'Original', 'x.cr2'))).toBe(true);
    expect(existsSync(join(nu, 'Master', 'x 2-3.tif'))).toBe(true);
    catalog.sync();
    expect(raekke('Approved/x/Original/x.cr2').rating).toBe('godkendt');
    expect(raekke('Approved/x/Master/x 2-3.tif').crop).toBe('2:3');
    expect(alle().some((r) => /Originals|Masters/.test(r.rel_path))).toBe(false);
  });
});

describe('filmstrip', () => {
  it('viser hele Import, med kandidaterne, i den raekkefoelge de er taget', async () => {
    for (const n of ['x', 'y', 'z']) {
      utimesSync(join(root, `Import/Ahl/${n}.cr2`), new Date('2029-01-01'), new Date('2029-01-01'));
    }
    skriv('Import/Serie/c.jpg', jpegMedTid('2024:05:01 10:00:00', '200'));
    skriv('Import/Serie/a.jpg', jpegMedTid('2024:05:01 10:00:00', '700'));
    skriv('Import/Serie/b.jpg', jpegMedTid('2024:05:01 09:59:58'));
    skriv('Import/Serie/uden.jpg', 'ingen exif');
    utimesSync(join(root, 'Import/Serie/uden.jpg'), new Date('2030-01-01'), new Date('2030-01-01'));
    skriv('Import/Serie/under/d.jpg', jpegMedTid('2024:05:01 09:00:00'));
    catalog.sync();
    catalog.setRating([raekke('Import/Serie/c.jpg').version_id], 'kandidat');
    catalog.setRating([raekke('Import/Ahl/z.cr2').version_id], 'kasseret');
    const { omfang, billeder: strip } = await catalog.filmstrip(raekke('Import/Serie/a.jpg').file_id);
    expect(omfang).toBe('import');
    expect(strip.map((r) => r.rel_path)).toEqual([
      'Import/Serie/under/d.jpg', 'Import/Serie/b.jpg', 'Candidate/Serie/c.jpg', 'Import/Serie/a.jpg',
      'Import/Ahl/x.cr2', 'Import/Ahl/y.cr2', 'Import/Serie/uden.jpg',
    ]);
    // Med de kasserede vist er de ogsaa med.
    const alle = await catalog.filmstrip(raekke('Import/Serie/a.jpg').file_id, { visKasserede: true });
    expect(alle.billeder.map((r) => r.rel_path)).toContain('Discarded/Ahl/z.cr2');
    // Tidspunktet gemmes, saa det kun laeses én gang.
    expect(catalog.getFile(raekke('Import/Serie/b.jpg').file_id).taken_at).toBeGreaterThan(0);
    expect(catalog.getFile(raekke('Import/Serie/uden.jpg').file_id).taken_at).toBe(-1);
  });

  it('laeser sekunder og brøkdele', () => {
    const a = exifTidFromBuffer(jpegMedTid('2024:05:01 10:00:00', '25'));
    const b = exifTidFromBuffer(jpegMedTid('2024:05:01 10:00:00', '700'));
    expect(b - a).toBe(450);
    expect(exifTidFromBuffer(Buffer.from('nej'))).toBe(null);
  });
});
