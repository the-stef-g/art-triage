// Den indbyggede JPEG i RAW-filer. Filerne her er bygget i haanden: en
// TIFF-header (som CR2, NEF, ARW og DNG begynder med), en miniature, et
// tabsfrit "raa-billede" (SOF3) og den rigtige forhaandsvisning, i den
// raekkefoelge kameraer lægger dem.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { indbyggetJpeg, jpegHoved } from '../electron/lib/rawpreview.mjs';
import { exifOrientationFromBuffer, canonRetningFromBuffer } from '../electron/lib/exif.mjs';
import { Thumbnailer, medRetning } from '../electron/lib/thumbs.mjs';

let dir;
let sharp;

async function jpeg(w, h, farve) {
  return sharp({ create: { width: w, height: h, channels: 3, background: farve } }).jpeg().toBuffer();
}

// Et billede med en markeret hjoerne, saa en rotation kan ses.
async function medHjoerne(w, h) {
  const pix = Buffer.alloc(w * h * 3, 40);
  for (let y = 0; y < Math.floor(h / 4); y++) for (let x = 0; x < Math.floor(w / 4); x++) {
    const i = (y * w + x) * 3;
    pix[i] = 250; pix[i + 1] = 20; pix[i + 2] = 20;
  }
  return sharp(pix, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

// En lille TIFF-header med IFD0 der har retningen, som en CR2.
function tiffMedRetning(retning, le = true) {
  const b = Buffer.alloc(8 + 2 + 12 + 4);
  b.write(le ? 'II' : 'MM', 0, 'latin1');
  le ? b.writeUInt16LE(42, 2) : b.writeUInt16BE(42, 2);
  le ? b.writeUInt32LE(8, 4) : b.writeUInt32BE(8, 4);
  const w16 = (v, o) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  w16(1, 8); w16(0x0112, 10); w16(3, 12);
  le ? b.writeUInt32LE(1, 14) : b.writeUInt32BE(1, 14);
  w16(retning, 18);
  return b;
}


// En CR2 hvor retningen kun staar i Canons egen blok: IFD0 -> EXIF-IFD ->
// MakerNote (en IFD) -> tag 4 (ShotInfo), felt 27 (AutoRotate).
function canonMedAutoRotate(v, le = true) {
  const b = Buffer.alloc(62 + 60);
  const w16 = (x, o) => (le ? b.writeUInt16LE(x, o) : b.writeUInt16BE(x, o));
  const w32 = (x, o) => (le ? b.writeUInt32LE(x, o) : b.writeUInt32BE(x, o));
  b.write(le ? 'II' : 'MM', 0, 'latin1'); w16(42, 2); w32(8, 4);
  w16(1, 8); w16(0x8769, 10); w16(4, 12); w32(1, 14); w32(26, 18);
  w16(1, 26); w16(0x927c, 28); w16(7, 30); w32(78, 32); w32(44, 36);
  w16(1, 44); w16(0x0004, 46); w16(3, 48); w32(30, 50); w32(62, 54);
  w16(v, 62 + 27 * 2);
  return b;
}

// Et SOF3-segment: tabsfri JPEG, som CR2 bruger til selve raa-billedet.
function tabsfri(w, h) {
  const sof = Buffer.from([0xff, 0xc3, 0x00, 0x0b, 0x10, h >> 8, h & 255, w >> 8, w & 255, 0x01, 0x01, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x02]), sof, sos, Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'at-raw-'));
  sharp = (await import('sharp')).default;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('indbygget JPEG', () => {
  it('finder den stoerste almindelige JPEG og springer miniature og raa-data over', async () => {
    const lille = await jpeg(160, 120, '#888888');
    const stor = await jpeg(1600, 1000, '#3366cc');
    const raa = tabsfri(5000, 3000);
    const fil = join(dir, 'a.cr2');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(1), Buffer.alloc(100), lille, Buffer.alloc(50, 1), stor, Buffer.alloc(20), raa]));
    const res = indbyggetJpeg(fil);
    expect(res.width).toBe(1600);
    expect(res.height).toBe(1000);
    expect(res.buffer.equals(stor)).toBe(true);
  });

  it('afslutter ved den rigtige JPEG-slutning, ikke miniaturens inde i EXIF', async () => {
    const stor = await jpeg(1200, 800, '#cc6633');
    const inde = await jpeg(160, 120, '#222222');
    // APP1 med en hel JPEG indeni, lige efter SOI.
    const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), inde]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(app1.length + 2);
    const ydre = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, stor.subarray(2)]);
    const fil = join(dir, 'b.nef');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(1), Buffer.alloc(30), ydre, Buffer.alloc(40)]));
    const res = indbyggetJpeg(fil);
    expect(res.width).toBe(1200);
    expect(res.buffer.equals(ydre)).toBe(true);
    // Kan indlaeses som billede.
    expect((await sharp(res.buffer).metadata()).width).toBe(1200);
  });

  it('giver null for en fil uden almindelig JPEG, og for en kun med miniature', async () => {
    const tom = join(dir, 'c.arw');
    writeFileSync(tom, Buffer.concat([tiffMedRetning(1), tabsfri(4000, 3000)]));
    expect(indbyggetJpeg(tom)).toBeNull();
    const kunLille = join(dir, 'd.dng');
    writeFileSync(kunLille, Buffer.concat([tiffMedRetning(1), await jpeg(160, 120, '#999999')]));
    expect(indbyggetJpeg(kunLille)).toBeNull();
    expect(indbyggetJpeg(join(dir, 'findes-ikke.cr2'))).toBeNull();
  });

  it('afvises ved en afkortet JPEG', async () => {
    const stor = await jpeg(1600, 1000, '#3366cc');
    const fil = join(dir, 'e.cr2');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(1), stor.subarray(0, Math.floor(stor.length / 2))]));
    expect(indbyggetJpeg(fil)).toBeNull();
  });

  it('laeser stoerrelsen ud af SOF', async () => {
    expect(jpegHoved(await jpeg(321, 123, '#000000'))).toMatchObject({ width: 321, height: 123 });
    expect(jpegHoved(Buffer.from('ikke en jpeg'))).toBeNull();
  });
});

describe('retning', () => {
  it('laeser Canons AutoRotate og oversaetter den til en EXIF-retning', () => {
    expect([0, 1, 2, 3].map((v) => canonRetningFromBuffer(canonMedAutoRotate(v)))).toEqual([1, 6, 3, 8]);
    expect(canonRetningFromBuffer(canonMedAutoRotate(3, false))).toBe(8);
    expect(canonRetningFromBuffer(tiffMedRetning(6))).toBeNull();
    expect(canonRetningFromBuffer(Buffer.from('nej'))).toBeNull();
  });

  it('laeser retningen fra IFD0, baade little og big endian', () => {
    expect(exifOrientationFromBuffer(tiffMedRetning(6, true))).toBe(6);
    expect(exifOrientationFromBuffer(tiffMedRetning(8, false))).toBe(8);
    expect(exifOrientationFromBuffer(Buffer.from('nej'))).toBeNull();
  });

  it('giver for alle otte retninger det samme som sharps egen EXIF-rotation', async () => {
    const w = 6;
    const h = 4;
    // Unikke pixelvaerdier, saa en forkert drejning eller spejling ses.
    const pix = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { pix[i * 3] = i * 10; pix[i * 3 + 1] = 255 - i * 10; pix[i * 3 + 2] = i; }
    for (let o = 1; o <= 8; o++) {
      const tiff = await sharp(pix, { raw: { width: w, height: h, channels: 3 } })
        .tiff({ compression: 'none' })
        .withMetadata({ orientation: o })
        .toBuffer();
      const facit = await sharp(tiff).rotate().raw().toBuffer({ resolveWithObject: true });
      const mit = await medRetning(sharp(pix, { raw: { width: w, height: h, channels: 3 } }), o)
        .raw().toBuffer({ resolveWithObject: true });
      expect([o, mit.info.width, mit.info.height]).toEqual([o, facit.info.width, facit.info.height]);
      expect([o, mit.data.equals(facit.data)]).toEqual([o, true]);
    }
  });
});

describe('forhaandsvisning af en RAW-fil', () => {
  function lav(runner, opts = {}) {
    const fejl = [];
    const t = new Thumbnailer({
      cacheDir: join(dir, 'cache'), platform: 'darwin', runner,
      onError: (e) => fejl.push(e), ...opts,
    });
    return { t, fejl };
  }
  const ingenProgrammer = async () => { throw Object.assign(new Error('spawn EBADF'), { code: 'EBADF' }); };

  it('bruger den indbyggede JPEG uden at starte noget program', async () => {
    const kald = [];
    const fil = join(dir, 'Banegaarden.cr2');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(1), await jpeg(1600, 1000, '#3366cc')]));
    const { t, fejl } = lav(async (...a) => { kald.push(a); });
    const sti = await t.ensure(1, 5, fil, 1024);
    expect(sti).toMatch(/1-5-1024\.jpg$/);
    // Kun et spoergsmaal om retningen, ingen forhaandsvisning laves af sips.
    expect(kald.filter((k) => !k[1].includes('-g'))).toEqual([]);
    expect(fejl).toEqual([]);
    const m = await sharp(sti).metadata();
    expect([m.width, m.height]).toEqual([1024, 640]);
  });

  it('lægger RAW-filens retning paa, naar JPEG\'en ikke har sin egen', async () => {
    const fil = join(dir, 'staaende.cr2');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(6), await medHjoerne(1600, 1000)]));
    const { t } = lav(ingenProgrammer);
    const sti = await t.ensure(2, 5, fil, 2048);
    const m = await sharp(sti).metadata();
    expect([m.width, m.height]).toEqual([1000, 1600]); // staaende, ikke liggende
  });

  it('retter en staaende RAW-fil, selv om JPEG\'en selv siger retning 1', async () => {
    const pix = Buffer.alloc(1600 * 1000 * 3, 90);
    const jpegMed1 = await sharp(pix, { raw: { width: 1600, height: 1000, channels: 3 } })
      .jpeg().withMetadata({ orientation: 1 }).toBuffer();
    const fil = join(dir, 'staaende1.cr2');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(6), jpegMed1]));
    const { t } = lav(ingenProgrammer);
    // Samme retning ved alle stoerrelser, ogsaa griddets og inspektoerens.
    for (const [id, str] of [[6, 512], [7, 2048]]) {
      const m = await sharp(await t.ensure(id, 5, fil, str)).metadata();
      expect(m.height).toBeGreaterThan(m.width);
    }
  });

  it('bruger Canons AutoRotate, naar IFD0 ingen retning har', async () => {
    const fil = join(dir, 'canon.cr2');
    writeFileSync(fil, Buffer.concat([canonMedAutoRotate(3), await medHjoerne(1600, 1000)]));
    const { t } = lav(ingenProgrammer);
    const m = await sharp(await t.ensure(10, 5, fil, 2048)).metadata();
    expect([m.width, m.height]).toEqual([1000, 1600]);
  });

  it('spoerger sips om retningen, naar RAW-filen og JPEG\'en ingen har', async () => {
    const fil = join(dir, 'ukendt.cr2');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(1), await medHjoerne(1600, 1000)]));
    const { t } = lav(async (cmd, args) => ({ stdout: `${args[2]}\n  orientation: 6\n` }));
    const m = await sharp(await t.ensure(8, 5, fil, 2048)).metadata();
    expect([m.width, m.height]).toEqual([1000, 1600]);
  });

  it('lægger brugerens egen drejning oven paa, og glemmer cachen ved ny drejning', async () => {
    const fil = join(dir, 'drej.cr2');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(1), await medHjoerne(1600, 1000)]));
    let grader = 0;
    const { t } = lav(ingenProgrammer, { rotationFor: () => grader });
    let m = await sharp(await t.ensure(9, 5, fil, 512)).metadata();
    expect([m.width, m.height]).toEqual([512, 320]);
    grader = 90;
    t.forgetFile(9);
    expect(t.findExisting(9, 5, 512)).toBeNull();
    m = await sharp(await t.ensure(9, 5, fil, 512)).metadata();
    expect([m.width, m.height]).toEqual([320, 512]);
  });

  it('toemmer en cache fra en aeldre version, og lader en ny staa', async () => {
    const cache = join(dir, 'cache');
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, '1-5-512.jpg'), 'gammel');
    lav(ingenProgrammer);
    expect(existsSync(join(cache, '1-5-512.jpg'))).toBe(false);
    writeFileSync(join(cache, '1-5-512.jpg'), 'ny');
    lav(ingenProgrammer);
    expect(existsSync(join(cache, '1-5-512.jpg'))).toBe(true);
  });

  it('rammer ikke sips og qlmanage naar RAW-filen har en indbygget JPEG, ogsaa uden sharp-krav', async () => {
    const fil = join(dir, 'x.nef');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(1), await jpeg(800, 600, '#aa3333')]));
    const { t } = lav(ingenProgrammer);
    expect(await t.ensure(3, 1, fil, 512)).toBeTruthy();
    expect(t.failed.size).toBe(0);
  });

  it('falder tilbage paa sips naar der ingen indbygget JPEG er, og melder aarsagen', async () => {
    const fil = join(dir, 'tom.cr2');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(1), Buffer.alloc(500)]));
    const kald = [];
    const { t, fejl } = lav(async (cmd, args) => {
      kald.push(cmd);
      writeFileSync(args[args.indexOf('--out') + 1], 'jpeg');
    });
    const sti = await t.ensure(4, 1, fil, 512);
    expect(sti).toBeTruthy();
    expect(kald).toEqual(['sips']);
    expect(fejl[0]).toMatchObject({ stage: 'embedded-jpeg', file: 'tom.cr2' });
    expect(fejl[0].message).toMatch(/no embedded JPEG/);
  });

  it('bruger en miniature som sidste udvej, naar alt andet svigter', async () => {
    // En RAW-fil hvor den eneste JPEG er 640 x 480 (over minimum) virker; her
    // er den under graensen, saa sips proeves foerst og fejler.
    const fil = join(dir, 'lille.cr2');
    writeFileSync(fil, Buffer.concat([tiffMedRetning(1), await jpeg(300, 200, '#aaaaaa')]));
    const { t, fejl } = lav(ingenProgrammer);
    const sti = await t.ensure(5, 1, fil, 512);
    expect(sti).toBeTruthy();
    expect(fejl.map((f) => f.stage)).toContain('sips');
  });
});

describe('fejlede forhaandsvisninger og nyt forsoeg', () => {
  const ingenProgrammer = async () => { throw Object.assign(new Error('spawn EBADF'), { code: 'EBADF' }); };

  it('husker hvilke der fejlede, og glemmer dem igen ved nyt forsoeg', async () => {
    const psd = join(dir, 'lag.psd');
    writeFileSync(psd, 'ikke et billede');
    const antal = [];
    const t = new Thumbnailer({ cacheDir: join(dir, 'cache'), platform: 'darwin', runner: ingenProgrammer });
    t.onFailedChange = (n) => antal.push(n);
    expect(await t.ensure(9, 1, psd, 512)).toBeNull();
    expect(t.failed.get(9)).toMatchObject({ file: 'lag.psd' });
    expect(t.retryFailed()).toBe(1);
    expect(t.failed.size).toBe(0);
    expect(antal).toEqual([1, 0]);
  });

  it('fjerner en fil fra listen naar den lykkes ved naeste forsoeg', async () => {
    const fil = join(dir, 'a.png');
    writeFileSync(fil, 'x');
    let virker = false;
    const t = new Thumbnailer({
      cacheDir: join(dir, 'cache'), platform: 'darwin',
      runner: async (cmd, args) => {
        if (!virker) throw new Error('nej');
        writeFileSync(args[args.indexOf('--out') + 1], 'jpeg');
      },
    });
    expect(await t.ensure(1, 1, fil, 512)).toBeNull();
    expect(t.failed.size).toBe(1);
    virker = true;
    t.retryFailed();
    expect(await t.ensure(1, 1, fil, 512)).toBeTruthy();
    expect(t.failed.size).toBe(0);
  });
});

describe('programmer der ikke kan startes', () => {
  it('proever igen ved EBADF og lykkes', async () => {
    const fil = join(dir, 'a.png');
    writeFileSync(fil, 'x');
    let kald = 0;
    const t = new Thumbnailer({
      cacheDir: join(dir, 'cache'), platform: 'darwin',
      runner: async (cmd, args) => {
        kald += 1;
        if (kald < 3) throw Object.assign(new Error('spawn EBADF'), { code: 'EBADF' });
        writeFileSync(args[args.indexOf('--out') + 1], 'jpeg');
      },
    });
    expect(await t.ensure(1, 1, fil, 512)).toBeTruthy();
    expect(kald).toBe(3);
  });

  it('starter hoejst tre programmer ad gangen', async () => {
    let nu = 0;
    let max = 0;
    const t = new Thumbnailer({
      cacheDir: join(dir, 'cache'), platform: 'darwin',
      runner: async (cmd, args) => {
        nu += 1;
        max = Math.max(max, nu);
        await new Promise((ok) => setTimeout(ok, 15));
        writeFileSync(args[args.indexOf('--out') + 1], 'jpeg');
        nu -= 1;
      },
    });
    const filer = [];
    for (let i = 0; i < 12; i++) {
      const f = join(dir, `f${i}.png`);
      writeFileSync(f, 'x');
      filer.push(t.ensure(i + 1, 1, f, 512));
    }
    expect((await Promise.all(filer)).every(Boolean)).toBe(true);
    expect(max).toBe(3);
  });

  it('skriver antallet af aabne filer i fejlen naar processen ikke kan startes', async () => {
    const fil = join(dir, 'lag.psd');
    writeFileSync(fil, 'x');
    const fejl = [];
    const t = new Thumbnailer({
      cacheDir: join(dir, 'cache'), platform: 'darwin',
      runner: async () => { throw new Error('spawn EBADF'); }, // uden kode: ingen genforsoeg
      onError: (e) => fejl.push(e),
    });
    await t.ensure(1, 1, fil, 512);
    expect(fejl[0].message).toMatch(/spawn EBADF \[open files: \d+\]/);
  });
});
