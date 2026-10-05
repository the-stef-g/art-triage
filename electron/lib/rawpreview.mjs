// Den indbyggede JPEG i en RAW-fil. Hvert kamera gemmer en fuld JPEG i RAW-
// filen til bagsiden af skaermen, og den er det hurtigste og mest paalidelige
// at vise: ingen RAW-fremkaldelse, intet eksternt program, ingen afhaengighed
// af at sips og qlmanage kan startes.
//
// Formaterne gemmer den forskellige steder (CR2, NEF, ARW, DNG og de andre
// TIFF-baserede i IFD'er, CR3 i en ISO-boks, RAF efter en header). I stedet
// for ét udtraek pr. format letes der efter JPEG-strommene selv: de
// begynder med FF D8 FF, de har et SOF-segment med stoerrelsen, og de ender
// med FF D9. Den stoerste af de almindelige JPEG'er er forhaandsvisningen.
// De tabsfrie JPEG'er (SOF3), som CR2 bruger til selve raa-billedet, er ikke
// forhaandsvisninger og tages ikke med.
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';

const CHUNK = 4 * 1024 * 1024;
// Forhaandsvisningerne ligger tidligt i filen. Det er ikke vaerd at laese en
// 150 MB mellemformatsfil helt igennem for at lede efter dem.
const MAX_SCAN = 48 * 1024 * 1024;
// Ingen rigtig forhaandsvisning er mindre end det her; smaat er miniaturen
// (160 x 120) som alle kameraer lægger ved siden af.
const MIN_AREAL = 160 * 160;
// Baseline, extended sequential og progressive. SOF3 er tabsfri og er raa-data.
const SOF_FORHAANDSVISNING = new Set([0xc0, 0xc1, 0xc2]);
const SOF_ALLE = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export const RAW_EXTS_MED_FORHAANDSVISNING = new Set([
  'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf',
  'rw2', 'pef', 'srw', 'x3f', '3fr', 'fff', 'iiq', 'erf', 'mrw', 'dcr', 'kdc', 'mos',
]);

function laes(fd, pos, laengde) {
  const buf = Buffer.alloc(laengde);
  const n = readSync(fd, buf, 0, laengde, pos);
  return n === laengde ? buf : buf.subarray(0, n);
}

// Gaar JPEG-segmenterne igennem fra et SOI og finder SOF. Returnerer
// { width, height, sof } eller null hvis det ikke er en JPEG der kan bruges.
export function jpegHoved(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  let pos = 2;
  for (let i = 0; i < 400 && pos + 4 <= buf.length; i++) {
    if (buf[pos] !== 0xff) return null;
    const marker = buf[pos + 1];
    if (marker === 0xff) { pos += 1; continue; } // fyldbyte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return null; // data uden foregaaende SOF
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2) return null;
    if (SOF_ALLE.has(marker)) {
      if (pos + 9 > buf.length) return null;
      return {
        sof: marker,
        height: buf.readUInt16BE(pos + 5),
        width: buf.readUInt16BE(pos + 7),
      };
    }
    pos += 2 + len;
  }
  return null;
}

// Finder alle steder en JPEG-strøm kan begynde, uden at laese hele filen
// ind paa én gang.
function findKandidater(fd, stoerrelse) {
  const out = [];
  let pos = 0;
  let hale = Buffer.alloc(0);
  while (pos < stoerrelse) {
    const del = laes(fd, pos, Math.min(CHUNK, stoerrelse - pos));
    if (!del.length) break;
    const buf = hale.length ? Buffer.concat([hale, del]) : del;
    const base = pos - hale.length;
    let i = 0;
    for (;;) {
      i = buf.indexOf(0xff, i);
      if (i < 0 || i + 3 > buf.length) break;
      if (buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) out.push(base + i);
      i += 1;
    }
    hale = buf.subarray(Math.max(0, buf.length - 2));
    pos += del.length;
  }
  return out;
}

// Efter SOS ligger entropi-koden, hvor FF altid efterfoelges af 00 eller et
// restart-maerke. Det foerste FF D9 er derfor den rigtige afslutning.
function findSlut(fd, start, stoerrelse) {
  // Hop forbi segmenterne frem til SOS.
  let pos = start + 2;
  for (let i = 0; i < 400; i++) {
    const h = laes(fd, pos, 4);
    if (h.length < 4 || h[0] !== 0xff) return -1;
    const marker = h[1];
    if (marker === 0xff) { pos += 1; continue; }
    const len = h.readUInt16BE(2);
    pos += 2 + len;
    if (marker === 0xda) break;
  }
  // Laes frem til FF D9.
  let hale = Buffer.alloc(0);
  while (pos < stoerrelse) {
    const del = laes(fd, pos, Math.min(CHUNK, stoerrelse - pos));
    if (!del.length) return -1;
    const buf = hale.length ? Buffer.concat([hale, del]) : del;
    const base = pos - hale.length;
    let i = 0;
    for (;;) {
      i = buf.indexOf(0xff, i);
      if (i < 0 || i + 2 > buf.length) break;
      if (buf[i + 1] === 0xd9) return base + i + 2;
      i += 1;
    }
    hale = buf.subarray(Math.max(0, buf.length - 1));
    pos += del.length;
  }
  return -1;
}

// Den stoerste almindelige JPEG i filen, eller null. Returnerer
// { buffer, width, height } hvor buffer er en komplet JPEG-fil.
export function indbyggetJpeg(absPath) {
  let fd;
  try {
    fd = openSync(absPath, 'r');
    const stoerrelse = fstatSync(fd).size;
    let bedste = null;
    for (const start of findKandidater(fd, Math.min(stoerrelse, MAX_SCAN))) {
      const hoved = jpegHoved(laes(fd, start, 64 * 1024));
      if (!hoved || !SOF_FORHAANDSVISNING.has(hoved.sof)) continue;
      const areal = hoved.width * hoved.height;
      if (areal <= MIN_AREAL) continue;
      if (bedste && areal <= bedste.areal) continue;
      bedste = { start, areal, width: hoved.width, height: hoved.height };
    }
    if (!bedste) return null;
    const slut = findSlut(fd, bedste.start, stoerrelse);
    if (slut < 0) return null;
    return {
      buffer: laes(fd, bedste.start, slut - bedste.start),
      width: bedste.width,
      height: bedste.height,
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* lukket */ }
    }
  }
}
