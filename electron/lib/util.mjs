import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, existsSync, readdirSync, statSync } from 'node:fs';
import { open as aabn, readdir as laesMappe, stat as statAsync } from 'node:fs/promises';
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

// Samme signatur som quickHash, men uden at blokere hovedprocessen mens
// filen laeses. Giver noejagtig samme vaerdi.
export async function quickHashAsync(absPath, size) {
  const h = createHash('sha1');
  h.update(String(size));
  const fil = await aabn(absPath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, 1024 * 1024));
    const { bytesRead } = await fil.read(buf, 0, buf.length, 0);
    h.update(buf.subarray(0, bytesRead));
  } finally {
    await fil.close();
  }
  return h.digest('hex');
}

// Koerer fn paa hvert element, hoejst `graense` ad gangen.
export async function mapGraense(liste, graense, fn) {
  let naeste = 0;
  const arbejdere = Array.from({ length: Math.min(graense, liste.length) }, async () => {
    while (naeste < liste.length) {
      const i = naeste++;
      await fn(liste[i], i);
    }
  });
  await Promise.all(arbejdere);
}

// "Print files" er produktionsfilerne i et vaerks arbejdsmappe, ikke billeder
// der skal sorteres.
export const IGNORED_DIRS = new Set(['.art-triage', '.billedflow', 'node_modules', 'Print files']);

// Hvor katalogdata ligger ved siden af billederne.
//
// Appen hed Billedflow indtil den skiftede navn, og de biblioteker der
// blev lavet dengang har en .billedflow-mappe med bedoemmelser, serier og
// virtuelle kopier. Den flyttes ikke: at omdoebe en mappe med rigtige
// data er en unoedig risiko, og gaar det galt midtvejs, er arbejdet paa
// tusindvis af billeder tabt. I stedet bruges den gamle mappe videre naar
// den findes, og kun nye biblioteker faar .art-triage.
export function dataDirFor(root) {
  const nyt = join(root, '.art-triage');
  if (existsSync(nyt)) return nyt;
  const gammelt = join(root, '.billedflow');
  if (existsSync(gammelt)) return gammelt;
  return nyt;
}

// Er biblioteksroden tilgaengelig lige nu?
//
// walkImages sluger laesefejl og gaar videre, saa et eksternt drev der
// ikke er tilsluttet giver praecis samme svar som en tom mappe: nul
// billeder. Uden det her tjek ville en synkronisering laese det som at
// hele biblioteket var slettet. Naar billederne ligger paa eksterne
// diske, er frakoblede drev hverdag og ikke et saertilfaelde.
export function libraryAvailable(root) {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
}

// Gaar hele mappetraeet igennem og returnerer alle understoettede billedfiler.
// Med en liste af topmapper laeses kun de mapper (og ikke loese filer i
// roden). Uden en liste laeses det hele.
function medIndhold(rel, navn, inkluder) {
  return !inkluder || rel !== '' || inkluder.has(navn);
}

// Staar der en mappe der hedder Import (ogsaa " Import" med mellemrum
// foran, som faar den til at ligge oeverst) i biblioteksroden, er det den der
// sorteres. Returnerer mappens rigtige navn, eller null.
export function findImportMappe(root) {
  try {
    const fund = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\s*import\s*$/i.test(e.name))
      .map((e) => e.name)
      .sort();
    return fund[0] ?? null;
  } catch {
    return null;
  }
}

export function walkImages(root, inkluder = null) {
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
        if (!IGNORED_DIRS.has(ent.name) && medIndhold(rel, ent.name, inkluder)) stack.push(childRel);
      } else if (ent.isFile() && isSupported(ent.name) && !(inkluder && !rel)) {
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

// Det samme som walkImages, men giver tid tilbage til brugerfladen mens
// der laeses. Paa et eksternt drev tager 15.000 stat-kald sekunder, og den
// synkrone version holdt hele appen i den tid ved hver genskanning.
export async function walkImagesAsync(root, inkluder = null) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? join(root, rel) : root;
    let entries;
    try {
      entries = await laesMappe(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    const filer = [];
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!IGNORED_DIRS.has(ent.name) && medIndhold(rel, ent.name, inkluder)) stack.push(childRel);
      } else if (ent.isFile() && isSupported(ent.name) && !(inkluder && !rel)) {
        filer.push(childRel);
      }
    }
    await mapGraense(filer, 32, async (childRel) => {
      try {
        const st = await statAsync(join(root, childRel));
        out.push({ rel: childRel, size: st.size, mtime: Math.floor(st.mtimeMs) });
      } catch {
        // fil forsvandt midt i scanningen
      }
    });
  }
  return out;
}

// Returnerer alle mapper (til mappetraeet), også tomme.
export function walkDirs(root, inkluder = null) {
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
      if (!medIndhold(rel, ent.name, inkluder)) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      out.push(childRel);
      stack.push(childRel);
    }
  }
  return out.sort(daCollator.compare);
}

// Beskaeringens plads i filnavnet: et mellemrum (eller _) og formatet, som
// "Desert Canyon 01 2-3.tif". Kun filer i et vaerks Master-mappe har en
// beskaering. Navnet er sandheden: aendrer man det, foelger etiketten med.
export const BESKAERING_I_NAVN = { '1-1': '1:1', '2-3': '2:3', '3-2': '3:2', '1-2': '1:2', '2-1': '2:1' };

export function beskaeringFraSti(rel) {
  if (!/^Approved\/[^/]+\/Master\//.test(rel)) return null;
  const stem = stemOf(basename(rel));
  const m = /[ _](1-1|2-3|3-2|1-2|2-1)$/.exec(stem);
  if (m) return BESKAERING_I_NAVN[m[1]];
  return /[ _]free \d+x\d+$/.test(stem) ? 'free' : null;
}

// Filnavnet med en beskaering i (eller uden den, naar crop er null). En
// beskaering der staar der i forvejen, skiftes ud.
export function navnMedBeskaering(fileName, crop) {
  const ext = extname(fileName);
  let stem = ext ? fileName.slice(0, -ext.length) : fileName;
  stem = stem.replace(/[ _](1-1|2-3|3-2|1-2|2-1)$/, '').replace(/[ _]free \d+x\d+$/, '');
  if (crop === null || crop === undefined) return `${stem}${ext}`;
  const token = Object.entries(BESKAERING_I_NAVN).find(([, f]) => f === crop)?.[0];
  if (!token) throw new Error(`Unknown crop format: ${crop}`);
  return `${stem} ${token}${ext}`;
}

// Programmerne en kopi kan sendes til, og det de tilfoejer filnavnet:
// "Desert-neo.tif" er redigeret i Luminar Neo. Navnet er sandheden, som for
// beskaeringerne: den sidste endelse er det seneste program.
export const EDITOR_SUFFIKS = {
  'Luminar Neo': 'neo', 'Topaz Photo AI': 'tp', Photoshop: 'ps', 'Topaz Gigapixel AI': 'giga',
};

export function editorFraSti(rel) {
  if (!/^Approved\/[^/]+\/Edits\//.test(rel)) return null;
  const stem = stemOf(basename(rel));
  const fund = [...stem.matchAll(/-(neo|tp|ps|giga)(?=$|[-_ .])/gi)];
  if (!fund.length) return null;
  const s = fund[fund.length - 1][1].toLowerCase();
  return Object.keys(EDITOR_SUFFIKS).find((k) => EDITOR_SUFFIKS[k] === s) ?? null;
}

// Navnet uden programendelserne: "Desert-neo-tp" -> "Desert".
export function udenEditorSuffiks(stem) {
  return stem.replace(/(-(neo|tp|ps))+(?=$|[-_ .])/gi, '').replace(/[-_ .]+$/, '') || stem;
}

// Endelser som programmerne og jeg selv saetter paa en redigering. De
// fjernes fra masterens navn. Store og smaa bogstaver er lige gode, og
// bindestregen kan ogsaa vaere et mellemrum, en understreg eller mangle.
// Korte endelser (neo, tp, ps ...) kraever et skilletegn, ellers ville fx
// "Lamps" miste sit "ps".
const LANGE_ENDELSER = [
  'denoise', 'denoised', 'sharpen', 'sharpened', 'enhance', 'enhanced', 'upscale', 'upscaled',
  'gigapixel', 'giga', 'photoai', 'topaz', 'luminar', 'lumi', 'paint', 'painted', 'sketch', 'pano',
  'panorama', 'edit', 'edited', 'final', 'copy', 'kopi', 'affinity', 'pixelmator', 'lightroom',
];
const KORTE_ENDELSER = ['neo', 'tp', 'ps', 'gp', 'nr', 'dn', 'ai', 'lr', 'af', 'hdr', 'pxm', 'raw', 'dng'];
const LANG_RE = new RegExp(`[-_ .]*(${LANGE_ENDELSER.join('|')})$`, 'i');
const KORT_RE = new RegExp(`[-_ .]+(${KORTE_ENDELSER.join('|')})$`, 'i');

// Navnet paa masteren. Begynder redigeringens navn med vaerkets navn (som
// er originalens), er det vaerkets navn, uanset hvad der staar efter:
// "IMG_1234-Denoise-paint" -> "IMG_1234". Ellers fjernes de kendte
// endelser bagfra: "Desert Canyon sketch-tp" -> "Desert Canyon".
export function masterNavn(stem, work = '') {
  const w = String(work || '').trim();
  if (w && stem.toLowerCase().startsWith(w.toLowerCase())) return w;
  let navn = stem;
  for (;;) {
    const kortere = navn.replace(LANG_RE, '').replace(KORT_RE, '').replace(/[-_ .]+$/, '');
    if (!kortere || kortere === navn) break;
    navn = kortere;
  }
  return navn || stem;
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

// Dansk, naturlig sortering: 2 foer 19 foer 199 foer 200, og æøå til sidst.
export const daCollator = new Intl.Collator('da', { numeric: true, sensitivity: 'base' });

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

// Hvor mange filer processen har aabne lige nu, eller null hvis det ikke
// kan ses. En proces der naar sin graense kan ikke starte programmer
// (spawn EBADF) eller aabne filer, saa tallet hoerer med i fejlloggen.
export function openFdCount() {
  for (const dir of ['/dev/fd', '/proc/self/fd']) {
    try {
      return readdirSync(dir).length;
    } catch {
      // proever den naeste
    }
  }
  return null;
}
