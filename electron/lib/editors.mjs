// Finder installerede billed-editors og aabner filer i dem.
// Stefs standardvalg (Luminar Neo og Topaz-apps) ligger oeverst.
import { execFile } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const KNOWN = [
  { re: /luminar/i, label: 'Luminar Neo' },
  { re: /topaz photo|photo ai/i, label: 'Topaz Photo AI' },
  { re: /gigapixel/i, label: 'Topaz Gigapixel AI' },
  { re: /photoshop/i, label: 'Photoshop' },
  { re: /affinity photo/i, label: 'Affinity Photo' },
  { re: /pixelmator/i, label: 'Pixelmator Pro' },
  { re: /acorn/i, label: 'Acorn' },
  { re: /gimp/i, label: 'GIMP' },
];

// Programmerne der altid kan vaelges som status under Edits, ogsaa naar
// appen ikke finder dem i Applications. Appen opfinder ikke andre navne.
export const FASTE_STATUSER = ['Luminar Neo', 'Topaz Photo AI', 'Photoshop'];

// Alle navne en Edits-status kan have: de faste, og de programmer appen
// kender fra Applications og fra "Other app".
export function statusNavne(customApps = []) {
  return [...new Set([...FASTE_STATUSER, ...detectEditors(customApps).map((e) => e.label)])];
}

function appsIn(dir, depth = 1) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const p = join(dir, ent.name);
    if (ent.name.endsWith('.app')) out.push(p);
    else if (depth > 0 && !ent.name.startsWith('.')) out.push(...appsIn(p, depth - 1));
  }
  return out;
}

export function detectEditors(customApps = []) {
  const found = [];
  if (process.platform === 'darwin') {
    const candidates = [
      ...appsIn('/Applications'),
      ...appsIn(join(homedir(), 'Applications')),
    ];
    for (const known of KNOWN) {
      const match = candidates.find((p) => known.re.test(basename(p, '.app')));
      if (match && !found.some((f) => f.appPath === match)) {
        found.push({ appPath: match, label: known.label });
      }
    }
  }
  for (const p of customApps) {
    if (!existsSync(p)) continue;
    if (found.some((f) => f.appPath === p)) continue;
    found.push({ appPath: p, label: basename(p, '.app') });
  }
  return found;
}

// Aabner filen i den valgte app (eller systemets standardprogram).
export function openInApp(appPath, filePath) {
  return new Promise((resolve, reject) => {
    const done = (err) => (err ? reject(err) : resolve());
    if (process.platform === 'darwin') {
      const args = appPath ? ['-a', appPath, filePath] : [filePath];
      execFile('open', args, done);
    } else {
      execFile('xdg-open', [filePath], done);
    }
  });
}
