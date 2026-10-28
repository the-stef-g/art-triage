// Fase 5: printfilen til Prodigi. Prodigi vil have RGB, og deres egne
// ICC-profiler er kun til proevetryk og maa ikke lægges i filen. Filen
// laves derfor i sRGB, 8 bit, maerket 300 DPI, i fuld opløsning: Prodigi
// skalerer selv til den størrelse der bestilles. Masteren roeres ikke.
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

export const PRINT_DPI = 300;

// Printfilens navn har altid formatet med, ogsaa naar der kun er ét:
// "Desert 2-3.png". Det er det format Prodigi printer i.
export const PRINTFORMATER = { '1-1': 1, '2-3': 2 / 3, '3-2': 3 / 2, '1-2': 1 / 2, '2-1': 2 };

export function printfilNavn(base, token) {
  return `${base} ${token}.png`;
}

// Billedets maal som det vises: EXIF-retning og egen drejning med.
async function vistStoerrelse(sharp, fil, rotation = 0) {
  const meta = await sharp(fil, { failOn: 'none', limitInputPixels: false }).metadata();
  let [b, h] = [meta.width, meta.height];
  if (meta.orientation >= 5) [b, h] = [h, b];
  if (rotation === 90 || rotation === 270) [b, h] = [h, b];
  return { b, h };
}

// Antal pixels i en fil, eller 0 hvis den ikke kan laeses.
export async function pixelAreal(fil) {
  try {
    const sharp = (await import('sharp')).default;
    const m = await sharp(fil, { failOn: 'none', limitInputPixels: false }).metadata();
    return (m.width || 0) * (m.height || 0);
  } catch {
    return 0;
  }
}

// base er filens navn uden format, og token formatet ("2-3"). Printfilen
// laves af den stoerste forstoerrelse fra Edits (fx "Desert 2-3-giga.tif"
// fra Gigapixel), og ellers af beskaeringen selv. Den er altid praecis i sit
// format: en fil der er en pixel eller to skaev (fx efter en forstoerrelse),
// skaeres til i midten; en der er mere end 1 % skaev, afvises. rotation er
// brugerens egen drejning af beskaeringen. En eksisterende printfil med samme
// navn erstattes. Returnerer { path, bytes, token, kilde, bredde, hoejde }.
export async function lavPrintfil({ kilde, mappe, base, token, forstoerrelser = [], rotation = 0 }) {
  if (!PRINTFORMATER[token]) {
    throw new Error('Only a crop in one of the five print formats (1:1, 2:3, 3:2, 1:2, 2:1) can be printed');
  }
  if (!existsSync(kilde)) throw new Error('The file is not on disk');
  const sharp = (await import('sharp')).default;
  const r = ((Number(rotation) || 0) % 360 + 360) % 360;

  // Den stoerste af beskaeringen og dens forstoerrelser.
  let valgt = { fil: kilde, rot: r, ...(await vistStoerrelse(sharp, kilde, r)) };
  for (const f of forstoerrelser) {
    if (!existsSync(f)) continue;
    try {
      const st = await vistStoerrelse(sharp, f, 0);
      if (st.b * st.h > valgt.b * valgt.h) valgt = { fil: f, rot: 0, ...st };
    } catch {
      // en fil der ikke kan laeses, bruges ikke
    }
  }
  if (!valgt.b || !valgt.h) throw new Error('Could not read the size of the file');

  // Praecist i formatet.
  const [p, q] = token.split('-').map(Number);
  let udsnit = null;
  if (valgt.b * q !== valgt.h * p) {
    const k = Math.min(Math.floor(valgt.b / p), Math.floor(valgt.h / q));
    const nb = k * p;
    const nh = k * q;
    if (nb < valgt.b * 0.99 || nh < valgt.h * 0.99) {
      throw new Error(`${basename(valgt.fil)} is ${valgt.b} × ${valgt.h} pixels, which is not ${p}:${q}. Crop it again under 4 Crops.`);
    }
    udsnit = { left: Math.floor((valgt.b - nb) / 2), top: Math.floor((valgt.h - nh) / 2), width: nb, height: nh };
  }

  mkdirSync(mappe, { recursive: true });
  const dest = join(mappe, printfilNavn(base, token));
  const tmp = `${dest}.tmp.png`;
  try {
    let img = sharp(valgt.fil, { failOn: 'none', limitInputPixels: false }).rotate();
    if (valgt.rot) img = sharp(await img.toBuffer(), { limitInputPixels: false }).rotate(valgt.rot);
    if (udsnit) img = sharp(await img.toBuffer(), { limitInputPixels: false }).extract(udsnit);
    // Den indlejrede profil (fx Adobe RGB, ProPhoto eller en CMYK-profil)
    // bruges til at regne farverne om til sRGB, og sRGB lægges i filen.
    await img
      .toColourspace('srgb')
      .withIccProfile('srgb')
      .withMetadata({ density: PRINT_DPI })
      .png({ compressionLevel: 9 })
      .toFile(tmp);
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new Error(`The print file could not be made: ${String(err?.message || err).trim().slice(0, 200)}`);
  }
  return {
    path: dest,
    bytes: statSync(dest).size,
    token,
    kilde: valgt.fil,
    bredde: udsnit ? udsnit.width : valgt.b,
    hoejde: udsnit ? udsnit.height : valgt.h,
  };
}
