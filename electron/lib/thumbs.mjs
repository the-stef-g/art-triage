// Thumbnail-pipeline. Paa macOS bruges systemets egen billedmotor (sips og
// qlmanage), som laeser alt Finder kan vise: JPEG, TIFF, PNG, RAW, PSD, HEIC
// og .ai (via PDF-preview). SVG rasteriseres af Chromium gennem en injiceret
// callback. Paa Linux (udvikling/CI) bruges sharp til standardformaterne.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  existsSync, mkdirSync, renameSync, mkdtempSync, rmSync, readdirSync, writeFileSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { extOf, RASTER_EXTS, openFdCount } from './util.mjs';
import { indbyggetJpeg, RAW_EXTS_MED_FORHAANDSVISNING } from './rawpreview.mjs';
import { exifOrientation } from './exif.mjs';

const run = promisify(execFile);

// Hvad der gik galt, paa en linje. execFile lægger programmets egen
// besked i stderr; err.message er kun "Command failed: ...".
function kortFejl(err) {
  const tekst = String(err?.stderr || err?.message || err || 'unknown error').trim().replace(/\s+/g, ' ');
  // "spawn EBADF" er processen der ikke kan starte et program, typisk fordi
  // den har for mange filer aabne. Antallet staar med, saa det kan ses.
  const fds = /\bspawn E(BADF|MFILE|NFILE|AGAIN)\b/.test(tekst) ? openFdCount() : null;
  return `${tekst.slice(0, 300)}${fds === null ? '' : ` [open files: ${fds}]`}`;
}

const SPAWN_FEJL = new Set(['EBADF', 'EMFILE', 'ENFILE', 'EAGAIN']);
// Hoejst så mange sips/qlmanage ad gangen. Griddet beder om dusinvis af
// forhaandsvisninger paa én gang, og hver af dem er en ny proces.
const MAX_PROCESSER = 3;
// Der skal findes mindst saa stor en indbygget JPEG, foer den bruges i stedet
// for at lade sips fremkalde RAW-filen.
const MIN_INDBYGGET = 400;

// Retningen (EXIF 1 til 8) lagt paa et sharp-billede. En RAW-fils JPEG har
// sjaeldent selv en retning, saa den kommer fra RAW-filen.
export function medRetning(img, retning) {
  switch (retning) {
    case 2: return img.flop();
    case 3: return img.rotate(180);
    case 4: return img.flip();
    case 5: return img.rotate(270).flop();
    case 6: return img.rotate(90);
    case 7: return img.rotate(90).flop();
    case 8: return img.rotate(270);
    default: return img;
  }
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
    // Filer hvor en forhaandsvisning ikke kunne laves, til "Retry failed".
    this.failed = new Map();
    this.onFailedChange = null;
    this._aktive = 0;
    this._koe = [];
    mkdirSync(cacheDir, { recursive: true });
  }

  // Koerer et eksternt program, hoejst MAX_PROCESSER ad gangen, og prover
  // igen et par gange hvis processen ikke kunne startes. Fejlen kan vaere
  // forbigaaende, fx naar der lige er for mange filer aabne.
  async _run(cmd, args) {
    if (this._aktive >= MAX_PROCESSER) await new Promise((ok) => this._koe.push(ok));
    this._aktive += 1;
    try {
      for (let forsoeg = 0; ; forsoeg++) {
        try {
          return await this.runner(cmd, args);
        } catch (err) {
          if (forsoeg < 2 && SPAWN_FEJL.has(err?.code)) {
            await new Promise((ok) => setTimeout(ok, 150 * (forsoeg + 1)));
            continue;
          }
          throw err;
        }
      }
    } finally {
      this._aktive -= 1;
      this._koe.shift()?.();
    }
  }

  _noteFailed(fileId, mtime, absPath) {
    this.failed.set(fileId, { mtime, file: basename(absPath), reason: this.lastError });
    this.onFailedChange?.(this.failed.size);
  }

  _noteOk(fileId) {
    if (this.failed.delete(fileId)) this.onFailedChange?.(this.failed.size);
  }

  // "Retry failed": glemmer de fejlede, saa naeste foresporgsel prover paa ny.
  retryFailed() {
    const antal = this.failed.size;
    this.failed.clear();
    this.onFailedChange?.(0);
    return antal;
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
      .then((sti) => {
        if (sti) this._noteOk(fileId);
        else this._noteFailed(fileId, mtime, absPath);
        return sti;
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

    // RAW: den indbyggede JPEG foerst. Den kraever intet program og er
    // hurtigere end at fremkalde RAW-filen.
    let lille = null;
    if (RAW_EXTS_MED_FORHAANDSVISNING.has(ext)) {
      const emb = this._indbygget(absPath);
      if (emb && Math.max(emb.width, emb.height) >= MIN_INDBYGGET) {
        const sti = await this._skrivIndbygget(key, absPath, emb, size);
        if (sti) return sti;
      } else if (emb) {
        lille = emb; // kun en miniature; sips og qlmanage proeves foerst
      }
    }

    const sti = this.platform === 'darwin'
      ? await this._generateMac(key, absPath, size)
      : await this._generateSharp(key, absPath, size);
    if (sti) return sti;
    // Intet andet virkede, saa hellere en miniature end ingenting.
    if (lille) return this._skrivIndbygget(key, absPath, lille, size);
    return null;
  }

  _indbygget(absPath) {
    const emb = indbyggetJpeg(absPath);
    if (!emb) this._report('embedded-jpeg', absPath, 'no embedded JPEG preview found in the RAW file');
    return emb;
  }

  // Den indbyggede JPEG gjort til en forhaandsvisning i den oenskede
  // stoerrelse og retning. Uden sharp gemmes JPEG'en som den er.
  async _skrivIndbygget(key, absPath, emb, size) {
    const out = join(this.cacheDir, `${key}.jpg`);
    const tmp = `${out}.tmp-${process.pid}.jpg`;
    let sharp = null;
    try {
      sharp = (await import('sharp')).default;
    } catch (err) {
      this._report('sharp', absPath, `sharp could not be loaded: ${kortFejl(err)}`);
    }
    try {
      if (sharp) {
        const meta = await sharp(emb.buffer, { failOn: 'none' }).metadata();
        let img = sharp(emb.buffer, { failOn: 'none' });
        // En JPEG med egen retning rettes af sharp; ellers bruges RAW-filens.
        img = meta.orientation ? img.rotate() : medRetning(img, exifOrientation(absPath));
        await img
          .resize(size, size, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toFile(tmp);
      } else {
        writeFileSync(tmp, emb.buffer);
      }
      renameSync(tmp, out);
      return out;
    } catch (err) {
      this._report('embedded-jpeg', absPath, err);
      rmSync(tmp, { force: true });
      return null;
    }
  }

  async _generateMac(key, absPath, size) {
    const out = join(this.cacheDir, `${key}.jpg`);
    const tmp = `${out}.tmp-${process.pid}.jpg`;
    try {
      await this._run('sips', [
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
      await this._run('qlmanage', ['-t', '-s', String(size), '-o', qlDir, absPath]);
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
