// Pakningen af den byggede app. electron-builder dropper devDependencies
// uden en advarsel, og en .node-fil inde i asar'en kan ikke indlaeses. Begge
// dele opdages ellers foerst naar man trykker paa en knap i den byggede app.
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { binaryKind, checkPackagedSharp } from '../scripts/check-packaged-sharp.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('package.json', () => {
  it('har sharp som almindelig afhaengighed, ikke devDependency', () => {
    expect(pkg.dependencies.sharp).toBeTruthy();
    expect(pkg.devDependencies?.sharp).toBeUndefined();
  });

  it('pakker sharp og dens binaerer ud af asar', () => {
    expect(pkg.build.asarUnpack).toEqual(expect.arrayContaining([
      'node_modules/sharp/**/*',
      'node_modules/@img/**/*',
    ]));
  });

  it('bygger til Intel', () => {
    const arch = pkg.build.mac.target.flatMap((t) => t.arch);
    expect(arch).toEqual(['x64']);
  });

  it('har sharp som almindelig afhaengighed i lock-filen', () => {
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    expect(lock.packages['node_modules/sharp'].dev).toBeUndefined();
    expect(lock.packages['node_modules/@img/sharp-darwin-x64'].dev).toBeUndefined();
  });
});

function macho(cpu) {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(cpu, 4);
  return b;
}

describe('binaerer', () => {
  it('kender Intel og Apple Silicon paa en Mach-O-fil', () => {
    expect(binaryKind(macho(0x01000007))).toBe('darwin-x64');
    expect(binaryKind(macho(0x0100000c))).toBe('darwin-arm64');
    expect(binaryKind(Buffer.from('tekst, ikke en binaer'))).toBe('unknown');
  });
});

describe('den pakkede app', () => {
  function pakke(opts = {}) {
    const res = mkdtempSync(join(tmpdir(), 'at-pack-'));
    const nm = join(res, 'app.asar.unpacked', 'node_modules');
    if (opts.sharp !== false) {
      mkdirSync(join(nm, 'sharp'), { recursive: true });
      writeFileSync(join(nm, 'sharp', 'package.json'), '{}');
    }
    if (opts.cpu !== null) {
      mkdirSync(join(nm, '@img', 'sharp-darwin-x64', 'lib'), { recursive: true });
      writeFileSync(join(nm, '@img', 'sharp-darwin-x64', 'lib', 'sharp-darwin-x64.node'), macho(opts.cpu ?? 0x01000007));
    }
    if (opts.libvips !== false) {
      mkdirSync(join(nm, '@img', 'sharp-libvips-darwin-x64', 'lib'), { recursive: true });
      writeFileSync(join(nm, '@img', 'sharp-libvips-darwin-x64', 'lib', 'libvips-cpp.8.17.3.dylib'), 'x');
    }
    return res;
  }

  it('godkender en komplet Intel-pakke', () => {
    const res = pakke();
    try { expect(checkPackagedSharp(res, 'darwin-x64')).toEqual([]); } finally { rmSync(res, { recursive: true, force: true }); }
  });

  it('finder en sharp der ikke er udpakket af asar', () => {
    const res = pakke({ sharp: false });
    try { expect(checkPackagedSharp(res, 'darwin-x64')[0]).toMatch(/not unpacked/); } finally { rmSync(res, { recursive: true, force: true }); }
  });

  it('finder en binaer der ikke er bygget til Intel', () => {
    const res = pakke({ cpu: 0x0100000c });
    try { expect(checkPackagedSharp(res, 'darwin-x64').join('|')).toMatch(/built for darwin-arm64, not darwin-x64/); } finally { rmSync(res, { recursive: true, force: true }); }
  });

  it('finder en manglende Intel-binaer', () => {
    const res = pakke({ cpu: null });
    try { expect(checkPackagedSharp(res, 'darwin-x64')[0]).toMatch(/sharp-darwin-x64 binary package is missing/); } finally { rmSync(res, { recursive: true, force: true }); }
  });

  it('finder en manglende libvips', () => {
    const res = pakke({ libvips: false });
    try { expect(checkPackagedSharp(res, 'darwin-x64').join('|')).toMatch(/libvips/); } finally { rmSync(res, { recursive: true, force: true }); }
  });
});
