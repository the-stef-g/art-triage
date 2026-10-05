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

// Hvad der gik galt, paa en linje. execFile lægger programmets egen
// besked i stderr; err.message er kun "Command failed: ...".
function kortFejl(err) {
  const tekst = String(err?.stderr || err?.message || err || 'unknown error').trim();
  return tekst.replace(/\s+/g, ' ').slice(0, 300);
}

export class Thumbnailer {
  // onError({ stage, file, message }) faar den rigtige fejl hver gang et
  // trin svigter, ogsaa naar et senere trin redder billedet. Uden det
  // var en mislykket forhaandsvisning bare null, og aarsagen var vaek.
  constructor({
    cacheDir, rasterizeSvg = null, platform = process.platform, runner = run, onError = null,
  }) {
    this.cacheDir = cacheDir;
    this.rasterizeSvg = rasterizeSvg;
    this.platform = platform;
    this.runner = runner;
    this.onError = onError;
    this.lastError = null;
    this.inflight = new Map();
    mkdirSync(cacheDir, { recursive: true });
  }

  _report(stage, absPath, err) {
    const message = kortFejl(err);
    this.lastError = `${stage}: ${message}`;
    try {
      this.onError?.({ stage, file: basename(absPath), message });
    } catch {
      // en logger der fejler maa ikke vaelte forhaandsvisningen
    }
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
      .catch((err) => {
        this._report('preview', absPath, err);
        return null;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async _generate(fileId, mtime, absPath, size) {
    if (!existsSync(absPath)) {
      this._report('preview', absPath, 'the file is not on disk (is the drive connected?)');
      return null;
    }
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
      await this.runner('sips', [
        '-s', 'format', 'jpeg',
        '-s', 'formatOptions', '85',
        '--resampleHeightWidthMax', String(size),
        absPath, '--out', tmp,
      ]);
      renameSync(tmp, out);
      return out;
    } catch (err) {
      this._report('sips', absPath, err);
      rmSync(tmp, { force: true });
    }
    // Quick Look som fallback (bl.a. .ai og eksotiske formater).
    const qlDir = mkdtempSync(join(tmpdir(), 'bf-ql-'));
    try {
      await this.runner('qlmanage', ['-t', '-s', String(size), '-o', qlDir, absPath]);
      const produced = readdirSync(qlDir).find((f) => f.endsWith('.png'));
      if (produced) {
        const outPng = join(this.cacheDir, `${key}.png`);
        renameSync(join(qlDir, produced), outPng);
        return outPng;
      }
      this._report('qlmanage', absPath, 'it produced no image');
    } catch (err) {
      this._report('qlmanage', absPath, err);
    } finally {
      rmSync(qlDir, { recursive: true, force: true });
    }
    // Sidste udvej: sharp laeser TIFF, PNG, JPEG og WebP selv om systemets
    // billedmotor ikke kunne, fx en TIFF med et usaedvanligt farverum.
    return this._generateSharp(key, absPath, size);
  }

  async _generateSharp(key, absPath, size) {
    const ext = extOf(absPath);
    const sharpOk = RASTER_EXTS.has(ext) || ext === 'svg';
    if (!sharpOk) return null; // RAW/PSD/HEIC kraever macOS
    let sharp;
    try {
      sharp = (await import('sharp')).default;
    } catch (err) {
      // Det er her en manglende sharp i den pakkede app viser sig.
      this._report('sharp', absPath, `sharp could not be loaded: ${kortFejl(err)}`);
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
    } catch (err) {
      this._report('sharp', absPath, err);
      rmSync(tmp, { force: true });
      return null;
    }
  }

  // Forhaandsvisning til en betalt analyse eller en upload: den i den
  // oenskede stoerrelse, ellers den stoerste der allerede ligger i cachen
  // for samme udgave af filen. En 512 eller 2048 px visning, som griddet og
  // inspektoeren allerede har lavet, er rigeligt til at beskrive et billede.
  async previewFor(fileId, mtime, absPath, size, { minSize = 256 } = {}) {
    const exact = await this.ensure(fileId, mtime, absPath, size);
    if (exact) return { path: exact, size, exact: true };
    const praefiks = `${fileId}-${mtime}-`;
    let bedste = null;
    try {
      for (const navn of readdirSync(this.cacheDir)) {
        const m = navn.startsWith(praefiks) && /^(\d+)\.(jpg|png)$/.exec(navn.slice(praefiks.length));
        if (!m) continue;
        const px = Number(m[1]);
        if (px >= minSize && (!bedste || px > bedste.size)) bedste = { path: join(this.cacheDir, navn), size: px, exact: false };
      }
    } catch {
      // cache-mappen kan ikke laeses; saa er der ingen at falde tilbage paa
    }
    if (bedste) {
      this._report('preview', absPath, `using the cached ${bedste.size} px preview instead of a new ${size} px one`);
    }
    return bedste;
  }
}

export function placeholderLabel(relPath) {
  return extOf(relPath).toUpperCase() || basename(relPath);
}
