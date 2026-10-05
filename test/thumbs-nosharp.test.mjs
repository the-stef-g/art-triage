// Naar sharp ikke er med i den pakkede app, skal fejlen staa i loggen med
// sit rigtige navn, ikke forsvinde som en tom forhaandsvisning.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('sharp', () => {
  throw new Error("Cannot find module 'sharp'");
});

const { Thumbnailer } = await import('../electron/lib/thumbs.mjs');

describe('sharp mangler', () => {
  it('melder at sharp ikke kunne indlaeses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'at-nosharp-'));
    try {
      const tif = join(dir, 'a.tif');
      writeFileSync(tif, 'x');
      const fejl = [];
      const t = new Thumbnailer({
        cacheDir: join(dir, 'cache'),
        platform: 'darwin',
        runner: async () => { throw new Error('sips failed'); },
        onError: (e) => fejl.push(e),
      });
      expect(await t.ensure(1, 1, tif, 1024)).toBeNull();
      expect(fejl.map((f) => f.stage)).toEqual(['sips', 'qlmanage', 'sharp']);
      expect(fejl[2].message).toMatch(/^sharp could not be loaded: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
