// Forhaandsvisninger paa macOS: sips, saa qlmanage, saa sharp, og til sidst
// en forhaandsvisning der allerede ligger i cachen. En TIFF som sips ikke
// kunne give en 1024 px visning af gav foer bare null, uden en aarsag
// nogen steder, og "Write texts" fejlede med en besked der ikke sagde mere.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Thumbnailer } from '../electron/lib/thumbs.mjs';
import { exportJpeg } from '../electron/lib/shop.mjs';

let dir;
let tiff;

function fejlende(stderr = 'Error 4: no file was written') {
  return async () => {
    throw Object.assign(new Error('Command failed: sips'), { stderr });
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'at-thumbs-'));
  const sharp = (await import('sharp')).default;
  tiff = join(dir, 'billede.tif');
  await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .tiff()
    .toFile(tiff);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function lav(opts = {}) {
  const fejl = [];
  const t = new Thumbnailer({
    cacheDir: join(dir, 'cache'),
    platform: 'darwin',
    runner: fejlende(),
    onError: (e) => fejl.push(e),
    ...opts,
  });
  return { t, fejl };
}

describe('mac: sips, qlmanage, sharp', () => {
  it('bruger sips naar den virker, uden at melde fejl', async () => {
    const { writeFileSync: skriv } = await import('node:fs');
    const runner = async (cmd, args) => {
      expect(cmd).toBe('sips');
      skriv(args[args.indexOf('--out') + 1], 'jpeg');
    };
    const { t, fejl } = lav({ runner });
    const sti = await t.ensure(1, 5, tiff, 1024);
    expect(sti).toMatch(/1-5-1024\.jpg$/);
    expect(fejl).toEqual([]);
  });

  it('falder tilbage paa sharp, og melder hvorfor sips og qlmanage svigtede', async () => {
    const { t, fejl } = lav();
    const sti = await t.ensure(1, 5, tiff, 1024);
    expect(sti).toMatch(/1-5-1024\.jpg$/);
    expect(existsSync(sti)).toBe(true);
    expect(fejl.map((f) => f.stage)).toEqual(['sips', 'qlmanage']);
    // Programmets egen besked, ikke bare "Command failed".
    expect(fejl[0]).toMatchObject({ file: 'billede.tif', message: 'Error 4: no file was written' });
  });

  it('giver null og gemmer aarsagen naar ingen vej virker', async () => {
    const psd = join(dir, 'lag.psd');
    writeFileSync(psd, 'ikke et billede');
    const { t, fejl } = lav();
    expect(await t.ensure(2, 5, psd, 1024)).toBeNull();
    expect(fejl.map((f) => f.stage)).toEqual(['sips', 'qlmanage']);
    expect(t.lastError).toMatch(/^qlmanage:/);
  });

  it('melder en fil der ikke findes paa disken', async () => {
    const { t, fejl } = lav();
    expect(await t.ensure(3, 5, join(dir, 'vaek.tif'), 1024)).toBeNull();
    expect(fejl[0].message).toMatch(/not on disk/);
  });
});

describe('forhaandsvisning med tilbagefald', () => {
  async function cache(t, fileId, mtime, sizer) {
    for (const px of sizer) {
      writeFileSync(join(t.cacheDir, `${fileId}-${mtime}-${px}.jpg`), 'x');
    }
  }

  it('vaelger den oenskede stoerrelse naar den kan laves', async () => {
    const { t } = lav();
    const res = await t.previewFor(1, 5, tiff, 1024);
    expect(res).toMatchObject({ size: 1024, exact: true });
  });

  it('falder tilbage paa den stoerste cachede visning naar den nye ikke kan laves', async () => {
    const psd = join(dir, 'lag.psd');
    writeFileSync(psd, 'ikke et billede');
    const { t, fejl } = lav();
    await cache(t, 7, 5, [128, 512, 2048]);
    await cache(t, 7, 6, [4096]); // en anden udgave af filen
    await cache(t, 8, 5, [4096]); // en anden fil
    const res = await t.previewFor(7, 5, psd, 1024);
    expect(res).toMatchObject({ size: 2048, exact: false });
    expect(res.path).toMatch(/7-5-2048\.jpg$/);
    expect(fejl.some((f) => /cached 2048 px preview/.test(f.message))).toBe(true);
  });

  it('springer en for lille cachet visning over', async () => {
    const psd = join(dir, 'lag.psd');
    writeFileSync(psd, 'ikke et billede');
    const { t } = lav();
    await cache(t, 7, 5, [128]);
    expect(await t.previewFor(7, 5, psd, 1024)).toBeNull();
  });

  it('giver null naar der hverken kan laves eller findes noget', async () => {
    const psd = join(dir, 'lag.psd');
    writeFileSync(psd, 'ikke et billede');
    const { t } = lav();
    expect(await t.previewFor(9, 5, psd, 1024)).toBeNull();
    expect(t.lastError).toBeTruthy();
  });
});

describe('upload til shop paa macOS', () => {
  it('falder tilbage paa sharp naar sips fejler', async () => {
    const buf = await exportJpeg(tiff, 3000, 92, { platform: 'darwin', runner: fejlende() });
    expect(buf.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('naevner begge aarsager naar begge fejler', async () => {
    const psd = join(dir, 'lag.psd');
    writeFileSync(psd, 'ikke et billede');
    await expect(exportJpeg(psd, 3000, 92, { platform: 'darwin', runner: fejlende('sips says no') }))
      .rejects.toThrow(/lag\.psd.*sips: sips says no.*sharp: sharp cannot read \.psd/);
  });

  it('bruger sharp uden for macOS', async () => {
    const buf = await exportJpeg(tiff, 3000, 92, { platform: 'linux' });
    expect(buf.subarray(0, 2).toString('hex')).toBe('ffd8');
  });
});
