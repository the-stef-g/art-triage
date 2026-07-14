// Thumbnail-pipeline. Paa macOS bruges systemets egen billedmotor (sips og
// qlmanage), som laeser alt Finder kan vise: JPEG, TIFF, PNG, RAW, PSD, HEIC
// og .ai (via PDF-preview). SVG rasteriseres af Chromium gennem en injiceret
// callback. Paa Linux (udvikling/CI) bruges sharp til standardformaterne.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, renameSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { extOf, RASTER_EXTS } from './util.mjs';

const run = promisify(execFile);

export class Thumbnailer {
  constructor({ cacheDir, rasterizeSvg = null, platform = process.platform }) {
    this.cacheDir = cacheDir;
    this.rasterizeSvg = rasterizeSvg;
    this.platform = platform;
    this.inflight = new Map();
    mkdirSync(cacheDir, { recursive: true });
  }

  cacheKey(fileId, mtime, size) {
    return `${fileId}-${mtime}-${size}`;
  }

  findExisting(fileId, mtime, size) {
    for (const ext of ['jpg', 'png']) {
      const p = join(this.cacheDir, `${this.cacheKey(fileId, mtime, size)}.${ext}`);
      if (existsSync(p)) return p;
    }
    return null;
  }

  // Returnerer stien til en cachet thumbnail, eller null hvis filen ikke
  // kan previewes paa denne platform (UI viser saa en pladsholder).
  async ensure(fileId, mtime, absPath, size) {
    const existing = this.findExisting(fileId, mtime, size);
    if (existing) return existing;
    const key = this.cacheKey(fileId, mtime, size);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = this._generate(fileId, mtime, absPath, size)
      .catch(() => null)
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async _generate(fileId, mtime, absPath, size) {
    if (!existsSync(absPath)) return null;
    const key = this.cacheKey(fileId, mtime, size);
    const ext = extOf(absPath);

    if (ext === 'svg' && this.rasterizeSvg) {
      const out = join(this.cacheDir, `${key}.png`);
      const tmp = `${out}.tmp-${process.pid}.png`;
      await this.rasterizeSvg(absPath, size, tmp);
      renameSync(tmp, out);
      return out;
    }

    if (this.platform === 'darwin') {
      return this._generateMac(key, absPath, size);
    }
    return this._generateSharp(key, absPath, size);
  }

  async _generateMac(key, absPath, size) {
    const out = join(this.cacheDir, `${key}.jpg`);
    const tmp = `${out}.tmp-${process.pid}.jpg`;
    try {
      await run('sips', [
        '-s', 'format', 'jpeg',
        '-s', 'formatOptions', '85',
        '--resampleHeightWidthMax', String(size),
        absPath, '--out', tmp,
      ]);
      renameSync(tmp, out);
      return out;
    } catch {
      rmSync(tmp, { force: true });
    }
    // Quick Look som fallback (bl.a. .ai og eksotiske formater).
    const qlDir = mkdtempSync(join(tmpdir(), 'bf-ql-'));
    try {
      await run('qlmanage', ['-t', '-s', String(size), '-o', qlDir, absPath]);
      const produced = readdirSync(qlDir).find((f) => f.endsWith('.png'));
      if (!produced) return null;
      const outPng = join(this.cacheDir, `${key}.png`);
      renameSync(join(qlDir, produced), outPng);
      return outPng;
    } catch {
      return null;
    } finally {
      rmSync(qlDir, { recursive: true, force: true });
    }
  }

  async _generateSharp(key, absPath, size) {
    const ext = extOf(absPath);
    const sharpOk = RASTER_EXTS.has(ext) || ext === 'svg';
    if (!sharpOk) return null; // RAW/PSD/HEIC kraever macOS
    let sharp;
    try {
      sharp = (await import('sharp')).default;
    } catch {
      return null;
    }
    const out = join(this.cacheDir, `${key}.jpg`);
    const tmp = `${out}.tmp-${process.pid}.jpg`;
    try {
      await sharp(absPath, { failOn: 'truncated' })
        .rotate()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#1c1c1e' })
        .jpeg({ quality: 85 })
        .toFile(tmp);
      renameSync(tmp, out);
      return out;
    } catch {
      rmSync(tmp, { force: true });
      return null;
    }
  }
}

export function placeholderLabel(relPath) {
  return extOf(relPath).toUpperCase() || basename(relPath);
}
