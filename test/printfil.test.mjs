// Fase 5: printfilen til Prodigi. sRGB, 8 bit, 300 DPI, PNG i fuld
// opløsning, og Prodigis profiler kommer ikke i filen.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { lavPrintfil, naermesteFormat } from '../electron/lib/printfil.mjs';

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

  it('lægger brugerens drejning paa og erstatter en gammel printfil', async () => {
    const kilde = join(root, 'k.tif');
    await p3Tiff(kilde, 60, 40);
    const mappe = join(root, 'Print files');
    // Uden et format i navnet (en fri beskaering) findes det taetteste.
    expect((await lavPrintfil({ kilde, mappe, base: 'x' })).path).toBe(join(mappe, 'x 3-2.png'));
    const res = await lavPrintfil({ kilde, mappe, base: 'x', rotation: 90 });
    expect(res.path).toBe(join(mappe, 'x 2-3.png'));
    const m = await sharp(res.path).metadata();
    expect([m.width, m.height]).toEqual([40, 60]);
    const igen = await lavPrintfil({ kilde, mappe, base: 'x', rotation: 90 });
    expect(igen.path).toBe(res.path);
    expect(existsSync(join(mappe, 'x 2-3 1.png'))).toBe(false);
  });

  it('kender de fem printformater', () => {
    expect(naermesteFormat(3000, 2000)).toBe('3-2');
    expect(naermesteFormat(4000, 3000)).toBe('3-2');
    expect(naermesteFormat(1000, 1050)).toBe('1-1');
    expect(naermesteFormat(1000, 2100)).toBe('1-2');
  });
});

describe('printfiler i kataloget', () => {
  it('fase 5 viser om en beskaering har en printfil, og printMaal peger paa Print files', async () => {
    await p3Tiff(join(root, 'Approved', 'Desert', 'Master', 'Desert 2-3.tif'));
    catalog.sync();
    let r = catalog.listVersions({ fase: 5 })[0];
    expect(r.rel_path).toBe('Approved/Desert/Master/Desert 2-3.tif');
    expect(r.printfil).toBe(null);

    const maal = catalog.printMaal(r.version_id);
    expect(maal.mappe).toBe(join(root, 'Approved', 'Desert', 'Print files'));
    expect(maal.base).toBe('Desert');
    expect(maal.token).toBe('2-3');
    await lavPrintfil(maal);

    r = catalog.listVersions({ fase: 5 })[0];
    expect(r.printfil.rel).toBe('Approved/Desert/Print files/Desert 2-3.png');
    expect(r.printfil.bytes).toBeGreaterThan(0);
    // Print files skannes ikke: printfilen bliver ikke en version af vaerket.
    catalog.sync();
    expect(alle().some((x) => x.rel_path.includes('Print files'))).toBe(false);
  });

  it('kun filer i Master kan blive til en printfil', () => {
    const orig = alle().find((x) => x.rel_path.startsWith('Approved/Desert/Original/'));
    expect(() => catalog.printMaal(orig.version_id)).toThrow(/Master/);
  });
});
