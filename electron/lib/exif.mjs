// Optagelsesaaret fra EXIF i originalfilen. Planen siger udtrykkeligt
// optagelsesdatoen og ikke filens dato: en fil der er kopieret eller
// gemt igen faar ny dato, men billedet er stadig fra dengang.
//
// En lille laeser i stedet for en pakke, for der skal kun én ting ud:
// DateTimeOriginal. JPEG og PNG har EXIF i en blok; TIFF og de TIFF-baserede
// RAW-formater (DNG, CR2, NEF, ARW m.fl.) ER en TIFF-struktur. Resten
// (HEIC, CR3, RAF) giver null, og aaret skrives saa ind i haanden.
import { openSync, readSync, closeSync } from 'node:fs';

const LAES_BYTES = 1024 * 1024;

const TAG_ORIENTATION = 0x0112;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;

// "2023:06:14 18:02:11" -> 2023. Nuller og vrøvl giver null.
export function yearFromExifDate(text) {
  const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(String(text || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const maxYear = new Date().getFullYear() + 1;
  if (year < 1826 || year > maxYear) return null; // fotografiets opfindelse
  return year;
}

// Finder TIFF-strukturen i bufferen, uanset om den er pakket ind i JPEG,
// PNG eller er hele filen. Returnerer { buf, start } eller null.
function findTiff(buf) {
  if (buf.length < 8) return null;
  // TIFF og TIFF-baserede RAW: II*\0 eller MM\0*
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0)
    || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0 && buf[3] === 0x2a)) {
    return { start: 0 };
  }
  // JPEG: gaa segmenterne igennem til APP1 med "Exif\0\0".
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let pos = 2;
    while (pos + 4 <= buf.length) {
      if (buf[pos] !== 0xff) return null;
      const marker = buf[pos + 1];
      if (marker === 0xda || marker === 0xd9) return null; // billeddata, ingen EXIF foer
      const len = buf.readUInt16BE(pos + 2);
      if (marker === 0xe1 && buf.toString('latin1', pos + 4, pos + 10) === 'Exif\0\0') {
        return { start: pos + 10 };
      }
      pos += 2 + len;
    }
    return null;
  }
  // PNG: chunken eXIf holder TIFF-strukturen direkte.
  if (buf.toString('latin1', 1, 4) === 'PNG') {
    let pos = 8;
    while (pos + 12 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.toString('latin1', pos + 4, pos + 8);
      if (type === 'eXIf') return { start: pos + 8 };
      if (type === 'IDAT') return null;
      pos += 12 + len;
    }
  }
  return null;
}

// Laeser én IFD og returnerer { tag -> { type, count, valueOffset } }.
function readIfd(buf, tiffStart, offset, le) {
  const u16 = (p) => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
  const u32 = (p) => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
  const out = new Map();
  let pos = tiffStart + offset;
  if (pos + 2 > buf.length) return out;
  const n = Math.min(u16(pos), 512);
  pos += 2;
  for (let i = 0; i < n; i++, pos += 12) {
    if (pos + 12 > buf.length) break;
    const tag = u16(pos);
    const type = u16(pos + 2);
    const count = u32(pos + 4);
    // Vaerdier paa op til fire bytes ligger i selve feltet.
    const size = type === 2 ? count : 0;
    const valueAt = size > 4 ? tiffStart + u32(pos + 8) : pos + 8;
    out.set(tag, { type, count, valueAt, rawLong: u32(pos + 8), short: u16(pos + 8) });
  }
  return out;
}

function ascii(buf, entry) {
  if (!entry || entry.type !== 2 || entry.valueAt + entry.count > buf.length) return null;
  return buf.toString('latin1', entry.valueAt, entry.valueAt + entry.count).replace(/\0.*$/, '');
}

// Aaret fra en buffer. Eksporteret saa det kan testes uden filer.
export function exifYearFromBuffer(buf) {
  try {
    const tiff = findTiff(buf);
    if (!tiff) return null;
    const start = tiff.start;
    const le = buf[start] === 0x49;
    const ifd0 = readIfd(buf, start, le ? buf.readUInt32LE(start + 4) : buf.readUInt32BE(start + 4), le);
    const exifPtr = ifd0.get(TAG_EXIF_IFD);
    const exif = exifPtr ? readIfd(buf, start, exifPtr.rawLong, le) : new Map();
    for (const text of [
      ascii(buf, exif.get(TAG_DATETIME_ORIGINAL)),
      ascii(buf, exif.get(TAG_DATETIME_DIGITIZED)),
      ascii(buf, ifd0.get(TAG_DATETIME)),
    ]) {
      const year = yearFromExifDate(text);
      if (year) return year;
    }
    return null;
  } catch {
    // Beskaaret eller mærkelig fil: intet aar er bedre end et forkert.
    return null;
  }
}

// Billedets retning (1 til 8) fra IFD0, eller null. En RAW-fils JPEG har
// sjaeldent selv en retning; den staar paa selve filen.
export function exifOrientationFromBuffer(buf) {
  try {
    const tiff = findTiff(buf);
    if (!tiff) return null;
    const start = tiff.start;
    const le = buf[start] === 0x49;
    const ifd0 = readIfd(buf, start, le ? buf.readUInt32LE(start + 4) : buf.readUInt32BE(start + 4), le);
    const e = ifd0.get(TAG_ORIENTATION);
    return e && e.type === 3 && e.short >= 1 && e.short <= 8 ? e.short : null;
  } catch {
    return null;
  }
}

function laesHoved(absPath) {
  let fd;
  try {
    fd = openSync(absPath, 'r');
    const buf = Buffer.alloc(LAES_BYTES);
    const n = readSync(fd, buf, 0, LAES_BYTES, 0);
    return buf.subarray(0, n);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function exifOrientation(absPath) {
  const buf = laesHoved(absPath);
  return buf ? exifOrientationFromBuffer(buf) : null;
}

export function exifYear(absPath) {
  let fd;
  try {
    fd = openSync(absPath, 'r');
    const buf = Buffer.alloc(LAES_BYTES);
    const n = readSync(fd, buf, 0, LAES_BYTES, 0);
    return exifYearFromBuffer(buf.subarray(0, n));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
