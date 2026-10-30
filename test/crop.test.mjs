// Beskaering af en masterfil: en ny fil ved siden af, aldrig en overskrivning.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cropMaster, tilRaaPixel } from '../electron/lib/crop.mjs';

let dir;
let sharp;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sga-crop-'));
  sharp = (await import('sharp')).default;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// 400 x 200: roed oeverst til venstre (en kvart bredde og en halv hoejde), resten graa.
async function master(navn) {
  const w = 400; const h = 200;
  const pix = Buffer.alloc(w * h * 3, 120);
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < w / 4; x++) {
    const i = (y * w + x) * 3;
    pix[i] = 240; pix[i + 1] = 20; pix[i + 2] = 20;
  }
  const fil = join(dir, navn);
  const img = sharp(pix, { raw: { width: w, height: h, channels: 3 } });
  await (navn.endsWith('.png') ? img.png() : img.tiff({ compression: 'lzw' })).toFile(fil);
  return fil;
}

describe('rektanglet i filens egne pixel', () => {
  it('uden drejning er det uaendret', () => {
    expect(tilRaaPixel({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 400, 200, 0))
      .toEqual({ left: 100, top: 100, width: 200, height: 100 });
  });

  it('naar billedet vises drejet, rammer det samme sted i filen', () => {
    const r = { x: 0, y: 0, w: 0.5, h: 0.25 }; // oeverst til venstre i det viste billede
    // 90 med uret: oeverst til venstre er nederst til venstre i filen
    expect(tilRaaPixel(r, 400, 200, 90)).toEqual({ left: 0, top: 100, width: 100, height: 100 });
    // 180: nederst til hoejre
    expect(tilRaaPixel(r, 400, 200, 180)).toEqual({ left: 200, top: 150, width: 200, height: 50 });
    // 270: oeverst til hoejre
    expect(tilRaaPixel(r, 400, 200, 270)).toEqual({ left: 300, top: 0, width: 100, height: 100 });
  });
});

describe('beskaering', () => {
  it('gemmer en ny fil ved siden af masteren, med formatet i navnet', async () => {
    const fil = await master('Desert 01.png');
    const res = await cropMaster({ kilde: fil, rect: { x: 0, y: 0, w: 0.25, h: 0.5 }, ratio: '1:1', platform: 'linux' });
    expect(res.path).toBe(join(dir, 'Desert 01 1-1.png'));
    expect(existsSync(fil)).toBe(true); // masteren er urørt
    const { data, info } = await sharp(res.path).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([100, 100]);
    expect(data[0]).toBeGreaterThan(200); // det roede hjoerne
    expect(data[1]).toBeLessThan(60);
  });

  it('overskriver aldrig en tidligere beskaering', async () => {
    const fil = await master('A.png');
    const a = await cropMaster({ kilde: fil, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ratio: '3:2', platform: 'linux' });
    const b = await cropMaster({ kilde: fil, rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, ratio: '3:2', platform: 'linux' });
    expect(a.path).not.toBe(b.path);
    expect(readdirSync(dir).filter((n) => n.endsWith('.png'))).toHaveLength(3);
  });

  it('en beskaering er praecis i sit format, paa pixlen', async () => {
    const fil = await master('B.png');
    // 200 x 100 vist, i 2:3 bliver det det stoerste 2:3 indenfor: 66 x 99.
    const res = await cropMaster({ kilde: fil, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ratio: '2:3', platform: 'linux' });
    expect(res.path).toMatch(/B 2-3\.png$/);
    const m = await sharp(res.path).metadata();
    expect([m.width, m.height]).toEqual([66, 99]);
    expect(m.width * 3).toBe(m.height * 2);
  });

  it('der findes ingen fri beskaering', async () => {
    const fil = await master('B2.png');
    await expect(cropMaster({ kilde: fil, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ratio: 'free', platform: 'linux' })).rejects.toThrow(/Unknown crop format/);
  });

  it('en drejning laegges paa, saa filen staar som den vises', async () => {
    const fil = await master('C.png');
    // Vist 90 med uret er billedet 200 x 400, og det roede hjoerne ligger oeverst til hoejre.
    const res = await cropMaster({ kilde: fil, rect: { x: 0.5, y: 0, w: 0.5, h: 0.25 }, rotation: 90, ratio: '1:1', platform: 'linux' });
    const { data, info } = await sharp(res.path).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([100, 100]);
    expect(data[0]).toBeGreaterThan(200); // roed i hjoernet
  });

  it('en fri drejning: billedet drejes om midten, og det uden for bliver gennemsigtigt', async () => {
    const fil = await master('D.png');
    // Hele feltet i 2:1, drejet 10 grader: hjoernerne falder uden for billedet.
    const res = await cropMaster({ kilde: fil, rect: { x: 0, y: 0, w: 1, h: 1 }, ratio: '2:1', vinkel: 10, platform: 'linux' });
    const { data, info } = await sharp(res.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([400, 200]);
    expect(data[3]).toBe(0); // gennemsigtigt hjoerne
    const midt = ((100 * info.width) + 200) * info.channels;
    expect(data[midt + 3]).toBe(255);
    expect(data[midt]).toBeGreaterThan(100); // graat i midten
    // En JPEG kan ikke vaere gennemsigtig: dér bliver det hvidt.
    const jpg = join(dir, 'E.jpg');
    await sharp(fil).jpeg().toFile(jpg);
    const r2 = await cropMaster({ kilde: jpg, rect: { x: 0, y: 0, w: 1, h: 1 }, ratio: '2:1', vinkel: 10, platform: 'linux' });
    const px = await sharp(r2.path).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(Math.min(...px)).toBeGreaterThan(240);
  });

  it('afviser et ukendt format og en fil der ikke findes', async () => {
    const fil = await master('D.png');
    await expect(cropMaster({ kilde: fil, rect: { x: 0, y: 0, w: 1, h: 1 }, ratio: '5:7', platform: 'linux' })).rejects.toThrow(/Unknown crop format/);
    await expect(cropMaster({ kilde: join(dir, 'findes-ikke.tif'), rect: { x: 0, y: 0, w: 1, h: 1 }, platform: 'linux' })).rejects.toThrow(/not on disk/);
  });
});

describe('beskaering paa macOS bruger sips', () => {
  // En falsk sips der bare skriver filen, saa kaldene kan ses.
  function falsk(kald) {
    return async (cmd, args) => {
      kald.push([cmd, args]);
      writeFileSync(args[args.indexOf('--out') + 1], 'resultat');
    };
  }

  it('beskaerer med sips, saa bitdybde og farveprofil bevares', async () => {
    const fil = await master('E.tif');
    const kald = [];
    const res = await cropMaster({ kilde: fil, rect: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, ratio: '2:1', platform: 'darwin', runner: falsk(kald) });
    expect(kald).toHaveLength(1);
    expect(kald[0][0]).toBe('sips');
    expect(kald[0][1].slice(0, 6)).toEqual(['--cropToHeightWidth', '100', '200', '--cropOffset', '100', '100']);
    expect(res.bit8).toBe(false);
    expect(res.path).toMatch(/E 2-1\.tif$/);
    expect(readdirSync(dir).some((n) => n.includes('.tmp'))).toBe(false);
  });

  it('en drejning laegges paa i et andet sips-kald', async () => {
    const fil = await master('F.tif');
    const kald = [];
    await cropMaster({ kilde: fil, rect: { x: 0, y: 0, w: 0.5, h: 0.25 }, rotation: 90, ratio: '1:1', platform: 'darwin', runner: falsk(kald) });
    expect(kald).toHaveLength(2);
    expect(kald[0][1].slice(0, 6)).toEqual(['--cropToHeightWidth', '100', '100', '--cropOffset', '100', '0']);
    expect(kald[1][1].slice(0, 2)).toEqual(['-r', '90']);
  });

  it('falder tilbage paa sharp, og siger det, hvis sips svigter paa en TIFF', async () => {
    const fil = await master('G.tif');
    const res = await cropMaster({
      kilde: fil, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ratio: '2:1', platform: 'darwin',
      runner: async () => { throw new Error('sips svigtede'); },
    });
    expect(res.bit8).toBe(true);
    expect((await sharp(res.path).metadata()).width).toBe(200);
  });
});
