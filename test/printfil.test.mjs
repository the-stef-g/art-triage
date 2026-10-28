// Fase 5: printfilen til Prodigi. sRGB, 8 bit, 300 DPI, PNG i fuld
// opløsning, og Prodigis profiler kommer ikke i filen.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { lavPrintfil } from '../electron/lib/printfil.mjs';

let root;
let db;
let catalog;

const alle = () => catalog.listVersions({ visKasserede: true });
const raekke = (rel) => alle().find((r) => r.rel_path === rel);

// Groen i sRGB (0, 200, 0), regnet om til Display P3 og gemt som 16 bit
// TIFF med P3-profilen i filen.
async function p3Tiff(abs, width = 60, height = 40) {
  mkdirSync(join(abs, '..'), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 200, b: 0 } } })
    .withIccProfile('p3')
    .toColourspace('rgb16')
    .tiff()
    .toFile(abs);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'sga-print-'));
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
  mkdirSync(join(root, 'Import', 'Ahl'), { recursive: true });
  writeFileSync(join(root, 'Import', 'Ahl', 'Desert.cr2'), 'raw');
  catalog.brugMappestruktur();
  catalog.sync();
  catalog.setRating([raekke('Import/Ahl/Desert.cr2').version_id], 'godkendt');
});

afterEach(() => {
  db.close?.();
  rmSync(root, { recursive: true, force: true });
});

describe('lavPrintfil', () => {
  it('laver en 8 bit sRGB PNG paa 300 DPI i fuld stoerrelse, med farverne regnet om', async () => {
    const kilde = join(root, 'k.tif');
    await p3Tiff(kilde, 60, 40);
    const res = await lavPrintfil({ kilde, mappe: join(root, 'Print files'), base: 'Desert', token: '3-2' });
    expect(res.path).toBe(join(root, 'Print files', 'Desert 3-2.png'));
    const m = await sharp(res.path).metadata();
    expect(m.format).toBe('png');
    expect([m.width, m.height]).toEqual([60, 40]);
    expect(m.depth).toBe('uchar');
    expect(m.space).toBe('srgb');
    expect(m.density).toBe(300);
    expect(m.icc).toBeTruthy();
    const px = await sharp(res.path).raw().toBuffer();
    // Tilbage i sRGB er det den samme groenne, ikke P3-tallene.
    expect(Math.abs(px[0] - 0)).toBeLessThanOrEqual(2);
    expect(Math.abs(px[1] - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(px[2] - 0)).toBeLessThanOrEqual(2);
  });

  it('er altid praecis i formatet: en pixel for meget skaeres af, mere end 1 % afvises', async () => {
    const mappe = join(root, 'Print files');
    const lidt = join(root, 'lidt.tif');
    await p3Tiff(lidt, 301, 200);
    const res = await lavPrintfil({ kilde: lidt, mappe, base: 'a', token: '3-2' });
    expect([res.bredde, res.hoejde]).toEqual([300, 200]);
    const m = await sharp(res.path).metadata();
    expect([m.width, m.height]).toEqual([300, 200]);
    const skaev = join(root, 'skaev.tif');
    await p3Tiff(skaev, 80, 40);
    await expect(lavPrintfil({ kilde: skaev, mappe, base: 'b', token: '3-2' })).rejects.toThrow(/not 3:2/);
  });

  it('bruger den stoerste forstoerrelse, og lægger brugerens drejning paa beskaeringen', async () => {
    const mappe = join(root, 'Print files');
    const kilde = join(root, 'k.tif');
    await p3Tiff(kilde, 60, 40);
    const giga = join(root, 'k-giga.tif');
    await p3Tiff(giga, 240, 160);
    const res = await lavPrintfil({ kilde, mappe, base: 'x', token: '3-2', forstoerrelser: [giga] });
    expect(res.kilde).toBe(giga);
    expect([res.bredde, res.hoejde]).toEqual([240, 160]);
    // Uden forstoerrelse: beskaeringen, drejet som den vises.
    const drejet = await lavPrintfil({ kilde, mappe, base: 'y', token: '2-3', rotation: 90 });
    expect(drejet.kilde).toBe(kilde);
    expect([drejet.bredde, drejet.hoejde]).toEqual([40, 60]);
  });

  it('kun de fem printformater', async () => {
    const kilde = join(root, 'k.tif');
    await p3Tiff(kilde, 60, 40);
    await expect(lavPrintfil({ kilde, mappe: root, base: 'x', token: null })).rejects.toThrow(/five print formats/);
  });
});

describe('printfiler i kataloget', () => {
  it('fase 5 viser beskaeringen og dens -giga-fil, og printfilen laves af -giga-filen', async () => {
    await p3Tiff(join(root, 'Approved', 'Desert', 'Master', 'Desert 2-3.tif'), 40, 60);
    catalog.sync();
    let liste = catalog.listVersions({ fase: 5 });
    expect(liste.map((r) => r.rel_path)).toEqual(['Approved/Desert/Master/Desert 2-3.tif']);
    const krop = liste[0];
    expect(krop.printfil).toBe(null);
    expect(krop.giga).toBe(false);
    // Beskaeringen selv bliver ikke til en printfil.
    expect(() => catalog.printMaal(krop.version_id)).toThrow(/-giga/);

    // Forstoerrelsen fra Gigapixel i Edits kommer med i fase 5.
    await p3Tiff(join(root, 'Approved', 'Desert', 'Edits', 'Desert 2-3-Giga.tif'), 120, 180);
    catalog.sync();
    liste = catalog.listVersions({ fase: 5 });
    expect(liste.map((r) => r.rel_path).sort()).toEqual([
      'Approved/Desert/Edits/Desert 2-3-Giga.tif',
      'Approved/Desert/Master/Desert 2-3.tif',
    ]);
    expect(liste.find((r) => !r.giga).forstoerrelse).toBe('Approved/Desert/Edits/Desert 2-3-Giga.tif');
    const giga = liste.find((r) => r.giga);
    expect(giga.giga).toBe(true);
    // Samme beskaeringsmaerke som beskaeringen i Master.
    expect(giga.crop).toBe('2:3');

    const maal = catalog.printMaal(giga.version_id);
    expect(maal.kilde).toBe(join(root, 'Approved', 'Desert', 'Edits', 'Desert 2-3-Giga.tif'));
    expect(maal.mappe).toBe(join(root, 'Approved', 'Desert', 'Print files'));
    expect(maal.base).toBe('Desert');
    expect(maal.token).toBe('2-3');
    expect(maal.beskaering).toBe(join(root, 'Approved', 'Desert', 'Master', 'Desert 2-3.tif'));
    const res = await lavPrintfil(maal);
    expect([res.bredde, res.hoejde]).toEqual([120, 180]);

    liste = catalog.listVersions({ fase: 5 });
    for (const r of liste) expect(r.printfil.rel).toBe('Approved/Desert/Print files/Desert 2-3.png');
    // Print files skannes ikke: printfilen bliver ikke en version af vaerket.
    catalog.sync();
    expect(alle().some((x) => x.rel_path.includes('Print files'))).toBe(false);
  });

  it('det Gigapixel selv kalder filen, kan ogsaa bruges', async () => {
    await p3Tiff(join(root, 'Approved', 'Desert', 'Master', 'Desert 3-2.tif'), 60, 40);
    await p3Tiff(join(root, 'Approved', 'Desert', 'Edits', 'Desert 3-2-giga-gigapixel-standard-4x.tif'), 240, 160);
    catalog.sync();
    const giga = catalog.listVersions({ fase: 5 }).find((r) => r.giga);
    expect(giga.rel_path).toBe('Approved/Desert/Edits/Desert 3-2-giga-gigapixel-standard-4x.tif');
    const res = await lavPrintfil(catalog.printMaal(giga.version_id));
    expect(res.path).toBe(join(root, 'Approved', 'Desert', 'Print files', 'Desert 3-2.png'));
  });

  it('kun en -giga-fil kan blive til en printfil', () => {
    const orig = alle().find((x) => x.rel_path.startsWith('Approved/Desert/Original/'));
    expect(() => catalog.printMaal(orig.version_id)).toThrow(/-giga/);
  });
});
