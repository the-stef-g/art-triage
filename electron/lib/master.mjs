// Den sidste ting i fase 2: den faerdige redigering bliver vaerkets master i
// Masters. TIFF, JPEG og PNG kopieres som de er. Andre formater, fx en PSD,
// laves om til en flad TIFF med sips (macOS), som bevarer bitdybde og
// farveprofil. En RAW-fil er ikke redigeret og kan ikke vaere en master.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { uniquePath, extOf, RAW_EXTS } from './util.mjs';

const run = promisify(execFile);
const SOM_DE_ER = new Set(['tif', 'tiff', 'jpg', 'jpeg', 'png']);

export async function lavMaster({
  kilde, mappe, stem, platform = process.platform, runner = run,
}) {
  if (!existsSync(kilde)) throw new Error('The file is not on disk');
  const ext = extOf(kilde);
  if (RAW_EXTS.has(ext)) {
    throw new Error('A RAW file is not edited yet. Make the master from an edit in the Edits folder.');
  }
  mkdirSync(mappe, { recursive: true });
  if (SOM_DE_ER.has(ext)) {
    const dest = uniquePath(join(mappe, `${stem}${extname(kilde)}`));
    copyFileSync(kilde, dest);
    return { path: dest, konverteret: false };
  }
  if (platform !== 'darwin') {
    throw new Error(`A .${ext} file can only be turned into a master on macOS`);
  }
  const dest = uniquePath(join(mappe, `${stem}.tif`));
  const tmp = `${dest}.tmp.tif`;
  try {
    await runner('sips', ['-s', 'format', 'tiff', '-s', 'formatOptions', 'lzw', kilde, '--out', tmp]);
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new Error(`The ${ext.toUpperCase()} file could not be turned into a TIFF: ${String(err?.stderr || err?.message || err).trim().slice(0, 200)}`);
  }
  return { path: dest, konverteret: true };
}
