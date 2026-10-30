// Beskaering af en masterfil. Resultatet er en ny fil ved siden af masteren,
// som saa bliver en version af vaerket.
//
// Paa macOS bruges sips: det bevarer bitdybde (16 bit TIFF) og farveprofil.
// sharp kan ikke skrive 16 bit TIFF, og en beskaering ville saa stille og
// roligt blive til 8 bit. sharp bruges kun som reserve, og i saa fald meldes
// det tilbage (bit8), saa det kan siges til brugeren.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, rmSync, renameSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { uniquePath } from './util.mjs';

const run = promisify(execFile);

// De formater en beskaering kan have. Navnet bruges i filnavnet, og
// forholdet er bredde / hoejde. "free" har intet fast forhold.
export const BESKAERINGER = {
  '1:1': { navn: '1-1', forhold: 1 },
  '2:3': { navn: '2-3', forhold: 2 / 3 },
  '3:2': { navn: '3-2', forhold: 3 / 2 },
  '1:2': { navn: '1-2', forhold: 1 / 2 },
  '2:1': { navn: '2-1', forhold: 2 },
  free: { navn: 'free', forhold: null },
};

// Et rektangel i det viste billede gjort praecist: bredde og hoejde i
// formatets forhold paa pixlen ("2:3" giver fx 2000 x 3000, aldrig 2000 x
// 3001), saa stort som muligt inden for rektanglet og centreret i det.
export function eksakt({ left, top, width, height }, ratio) {
  const [p, q] = String(ratio || '').split(':').map(Number);
  if (!p || !q) return { left, top, width, height };
  const k = Math.max(1, Math.min(Math.floor(width / p), Math.floor(height / q)));
  const nw = k * p;
  const nh = k * q;
  return {
    left: left + Math.floor((width - nw) / 2),
    top: top + Math.floor((height - nh) / 2),
    width: nw,
    height: nh,
  };
}

// Rektanglet i billedets egen retning, naar billedet er vist drejet
// `rotation` grader med uret. Alle tal er pixel. Med et format bliver det
// praecist i det format, som det vises.
export function tilRaaPixel({ x, y, w, h }, bredde, hoejde, rotation, ratio = null) {
  const r = ((Number(rotation) || 0) % 360 + 360) % 360;
  const drejet = r === 90 || r === 270;
  const vistB = drejet ? hoejde : bredde;
  const vistH = drejet ? bredde : hoejde;
  const fri = {
    left: Math.max(0, Math.min(vistB - 1, Math.round(x * vistB))),
    top: Math.max(0, Math.min(vistH - 1, Math.round(y * vistH))),
  };
  fri.width = Math.max(1, Math.min(vistB - fri.left, Math.round(w * vistB)));
  fri.height = Math.max(1, Math.min(vistH - fri.top, Math.round(h * vistH)));
  const { left: dx, top: dy, width: dw, height: dh } = ratio ? eksakt(fri, ratio) : fri;
  switch (r) {
    case 90: return { left: dy, top: hoejde - dx - dw, width: dh, height: dw };
    case 180: return { left: bredde - dx - dw, top: hoejde - dy - dh, width: dw, height: dh };
    case 270: return { left: bredde - dy - dh, top: dx, width: dh, height: dw };
    default: return { left: dx, top: dy, width: dw, height: dh };
  }
}

function filnavn(kilde, ratio, rect) {
  const stem = basename(kilde, extname(kilde));
  const info = BESKAERINGER[ratio] ?? BESKAERINGER.free;
  const mal = info.forhold === null ? `free ${rect.width}x${rect.height}` : info.navn;
  return `${stem} ${mal}${extname(kilde)}`;
}

// rect er normaliseret (0 til 1) i det billede brugeren ser, med den drejning
// der er lagt paa det. Returnerer { path, bit8 }.
// vinkel er en fri drejning af beskaeringen i grader (positiv er med uret),
// fx for at rette horisonten op. Billedet drejes om sin midte, og rect er i
// det oprindelige billedfelt; det der falder uden for det drejede billede,
// bliver gennemsigtigt (hvidt i en JPEG), saa det kan fyldes ud i fx
// Photoshop.
export async function cropMaster({
  kilde, rect, rotation = 0, ratio, vinkel = 0, platform = process.platform, runner = run,
}) {
  if (!existsSync(kilde)) throw new Error('The master file is not on disk');
  // Beskaeringerne er til print, og et print har et fast format: ingen fri.
  if (!BESKAERINGER[ratio] || ratio === 'free') throw new Error(`Unknown crop format: ${ratio}`);
  const sharp = (await import('sharp')).default;
  const meta = await sharp(kilde, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) throw new Error('Could not read the size of the master');
  const v = Number(vinkel) || 0;
  if (Math.abs(v) > 0.01) return cropDrejet({ sharp, kilde, meta, rect, rotation, ratio, vinkel: v });
  const raa = tilRaaPixel(rect, meta.width, meta.height, rotation, ratio);
  const ud = uniquePath(join(dirname(kilde), filnavn(kilde, ratio, raa)));
  const tmp = `${ud}.tmp${extname(ud)}`;
  const r = ((Number(rotation) || 0) % 360 + 360) % 360;
  // Ligger billedet med en EXIF-retning, er raa-koordinaterne ikke dem
  // brugeren ser. Saa bruges sharp, som retter retningen først.
  const harRetning = Boolean(meta.orientation && meta.orientation > 1);

  if (platform === 'darwin' && !harRetning) {
    try {
      const ext = extname(kilde).toLowerCase();
      const flag = ext === '.jpg' || ext === '.jpeg' ? ['-s', 'formatOptions', 'best'] : [];
      await runner('sips', [
        '--cropToHeightWidth', String(raa.height), String(raa.width),
        '--cropOffset', String(raa.top), String(raa.left),
        ...flag, kilde, '--out', tmp,
      ]);
      if (r) {
        // Drejningen lægges bagefter, saa filen staar som den vises.
        const tmp2 = `${tmp}.r${extname(tmp)}`;
        await runner('sips', ['-r', String(r), tmp, '--out', tmp2]);
        rmSync(tmp, { force: true });
        renameSync(tmp2, tmp);
      }
      renameSync(tmp, ud);
      return { path: ud, bit8: false };
    } catch {
      rmSync(tmp, { force: true });
      // sips svigtede: reserven nedenfor
    }
  }

  let img = sharp(kilde, { failOn: 'none' });
  if (harRetning) img = sharp(await sharp(kilde, { failOn: 'none' }).rotate().toBuffer());
  if (r) img = img.rotate(r);
  const ext = extname(kilde).toLowerCase();
  // Reserven kan ikke skrive 16 bit TIFF. Med retning eller drejning er
  // koordinaterne i det viste billede, ikke i filen.
  const vist = (harRetning || r)
    ? tilVist({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, meta, harRetning, r, ratio)
    : raa;
  img = img.extract(vist);
  if (ext === '.tif' || ext === '.tiff') img = img.tiff({ compression: 'lzw' });
  else if (ext === '.png') img = img.png();
  else img = img.jpeg({ quality: 95 });
  await img.withMetadata().toFile(tmp);
  renameSync(tmp, ud);
  return { path: ud, bit8: ext === '.tif' || ext === '.tiff' };
}

async function cropDrejet({ sharp, kilde, meta, rect, rotation, ratio, vinkel }) {
  const r = ((Number(rotation) || 0) % 360 + 360) % 360;
  const harRetning = Boolean(meta.orientation && meta.orientation > 1);
  const seksten = meta.depth === 'ushort';
  let buf = sharp(kilde, { failOn: 'none', limitInputPixels: false });
  if (harRetning) buf = buf.rotate();
  if (r) buf = sharp(await buf.toBuffer(), { limitInputPixels: false }).rotate(r);
  // Det viste billedfelt, foer den frie drejning.
  let bredde = meta.width;
  let hoejde = meta.height;
  if (harRetning && meta.orientation >= 5) [bredde, hoejde] = [hoejde, bredde];
  if (r === 90 || r === 270) [bredde, hoejde] = [hoejde, bredde];
  const ext = extname(kilde).toLowerCase();
  const jpeg = ext === '.jpg' || ext === '.jpeg';
  // Mellemresultatet er en ukomprimeret TIFF: tabsfri, og 16 bit holder.
  const drejet = await sharp(await buf.ensureAlpha().tiff({ compression: 'none' }).toBuffer(), { limitInputPixels: false })
    .rotate(vinkel, { background: jpeg ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 } })
    .tiff({ compression: 'none' })
    .toBuffer();
  const dm = await sharp(drejet, { limitInputPixels: false }).metadata();
  // Lærredet er vokset til det drejede billedes ramme; midten er den samme.
  const ox = (dm.width - bredde) / 2;
  const oy = (dm.height - hoejde) / 2;
  const felt = tilVist({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, { width: bredde, height: hoejde }, false, 0, ratio);
  const ud = uniquePath(join(dirname(kilde), filnavn(kilde, ratio, felt)));
  const tmp = `${ud}.tmp${extname(ud)}`;
  const left = Math.max(0, Math.min(dm.width - felt.width, Math.round(felt.left + ox)));
  const top = Math.max(0, Math.min(dm.height - felt.height, Math.round(felt.top + oy)));
  let img = sharp(drejet, { limitInputPixels: false }).extract({ left, top, width: felt.width, height: felt.height });
  if (seksten && !jpeg) img = img.toColourspace('rgb16');
  if (ext === '.tif' || ext === '.tiff') img = img.tiff({ compression: 'lzw' });
  else if (ext === '.png') img = img.png();
  else img = img.flatten({ background: '#ffffff' }).jpeg({ quality: 95 });
  try {
    await img.withMetadata().toFile(tmp);
    renameSync(tmp, ud);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  const m = await sharp(ud).metadata();
  return { path: ud, bit8: seksten && m.depth !== 'ushort' };
}

// Pixelrektangel i det viste billede (efter retning og drejning).
function tilVist({ x, y, w, h }, meta, harRetning, r, ratio) {
  let bredde = meta.width;
  let hoejde = meta.height;
  if (harRetning && meta.orientation >= 5) [bredde, hoejde] = [hoejde, bredde];
  if (r === 90 || r === 270) [bredde, hoejde] = [hoejde, bredde];
  const left = Math.max(0, Math.min(bredde - 1, Math.round(x * bredde)));
  const top = Math.max(0, Math.min(hoejde - 1, Math.round(y * hoejde)));
  return eksakt({
    left,
    top,
    width: Math.max(1, Math.min(bredde - left, Math.round(w * bredde))),
    height: Math.max(1, Math.min(hoejde - top, Math.round(h * hoejde))),
  }, ratio);
}
