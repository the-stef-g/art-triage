import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';

// Filtyper appen haandterer. RAW-listen daekker de gaengse kameramaerker.
export const RASTER_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp', 'gif', 'bmp']);
export const RAW_EXTS = new Set([
  'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf',
  'rw2', 'pef', 'srw', 'x3f', '3fr', 'fff', 'iiq', 'erf', 'mrw', 'dcr', 'kdc', 'mos',
]);
export const SPECIAL_EXTS = new Set(['psd', 'heic', 'heif', 'svg', 'ai']);

export function extOf(p) {
  return extname(p).slice(1).toLowerCase();
}

export function isSupported(p) {
  const e = extOf(p);
  return RASTER_EXTS.has(e) || RAW_EXTS.has(e) || SPECIAL_EXTS.has(e);
}

// Hurtig indholds-signatur: stoerrelse + foerste 1 MB.
// Bruges til at genkende flyttede/omdoebte filer og opdage redigeringer.
export function quickHash(absPath, size) {
  const h = createHash('sha1');
  h.update(String(size));
  const fd = openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, 1024 * 1024));
    const n = readSync(fd, buf, 0, buf.length, 0);
    h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

export const IGNORED_DIRS = new Set(['.billedflow', 'node_modules']);

// Gaar hele mappetraeet igennem og returnerer alle understoettede billedfiler.
export function walkImages(root) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? join(root, rel) : root;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!IGNORED_DIRS.has(ent.name)) stack.push(childRel);
      } else if (ent.isFile() && isSupported(ent.name)) {
        try {
          const st = statSync(join(abs, childRel.slice(rel ? rel.length + 1 : 0)));
          out.push({ rel: childRel, size: st.size, mtime: Math.floor(st.mtimeMs) });
        } catch {
          // fil forsvandt midt i scanningen
        }
      }
    }
  }
  return out;
}

// Returnerer alle mapper (til mappetraeet), også tomme.
export function walkDirs(root) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? join(root, rel) : root;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.') || IGNORED_DIRS.has(ent.name)) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      out.push(childRel);
      stack.push(childRel);
    }
  }
  return out.sort();
}

export function stemOf(fileName) {
  const e = extname(fileName);
  return e ? fileName.slice(0, -e.length) : fileName;
}

export function slug(s) {
  return s
    .toLowerCase()
    .replace(/[æå]/g, 'a')
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kopi';
}

// Finder et ledigt filnavn ved at tilfoeje " 2", " 3" osv.
export function uniquePath(absPath) {
  if (!existsSync(absPath)) return absPath;
  const dir = dirname(absPath);
  const e = extname(absPath);
  const stem = basename(absPath, e);
  for (let i = 2; i < 1000; i++) {
    const cand = join(dir, `${stem} ${i}${e}`);
    if (!existsSync(cand)) return cand;
  }
  throw new Error(`Kan ikke finde ledigt navn for ${absPath}`);
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
}
