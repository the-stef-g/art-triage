// Fase 5: printfilen til Prodigi. Prodigi vil have RGB, og deres egne
// ICC-profiler er kun til proevetryk og maa ikke lægges i filen. Filen
// laves derfor i sRGB, 8 bit, maerket 300 DPI, i fuld opløsning: Prodigi
// skalerer selv til den størrelse der bestilles. Masteren roeres ikke.
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PRINT_DPI = 300;

// Printfilens navn har altid formatet med, ogsaa naar der kun er ét:
// "Desert 2-3.png". Det er det format Prodigi printer i.
export const PRINTFORMATER = { '1-1': 1, '2-3': 2 / 3, '3-2': 3 / 2, '1-2': 1 / 2, '2-1': 2 };

export function printfilNavn(base, token) {
  return `${base} ${token}.png`;
}

// Det printformat der ligger taettest paa billedets form (bredde / hoejde),
// maalt som forholdet mellem de to, saa 3:2 og 2:3 er lige langt fra 1:1.
export function naermesteFormat(bredde, hoejde) {
  const f = bredde / hoejde;
  let bedst = '1-1';
  for (const [token, forhold] of Object.entries(PRINTFORMATER)) {
    if (Math.abs(Math.log(f / forhold)) < Math.abs(Math.log(f / PRINTFORMATER[bedst]))) bedst = token;
  }
  return bedst;
}

// base er filens navn uden format. token er formatet i navnet, naar filen
// er en beskaering i et fast format; ellers (masteren selv eller en fri
// beskaering) findes det taetteste format ud fra billedets form. optaget er
// de formater, der allerede har en beskaering i Master: dem bruges der.
// rotation er brugerens egen drejning (grader med uret), lagt oven paa
// filens EXIF-retning, saa printfilen staar som billedet vises i appen.
// En eksisterende printfil med samme navn erstattes: den er afledt af
// filen og laves bare igen. Returnerer { path, bytes, token, afvigelse }.
export async function lavPrintfil({ kilde, mappe, base, token = null, optaget = [], rotation = 0 }) {
  if (!existsSync(kilde)) throw new Error('The file is not on disk');
  const sharp = (await import('sharp')).default;
  const r = ((Number(rotation) || 0) % 360 + 360) % 360;
  const meta = await sharp(kilde, { failOn: 'none', limitInputPixels: false }).metadata();
  let [b, h] = [meta.width, meta.height];
  if (meta.orientation >= 5) [b, h] = [h, b];
  if (r === 90 || r === 270) [b, h] = [h, b];
  if (!b || !h) throw new Error('Could not read the size of the file');
  const format = token || naermesteFormat(b, h);
  if (!token && optaget.includes(format)) {
    throw new Error(`There is already a ${format.replace('-', ':')} crop of this work. Its print file is made from the crop.`);
  }
  // Hvor meget filens form afviger fra formatet, i procent.
  const afvigelse = Math.round(Math.abs(Math.log((b / h) / PRINTFORMATER[format])) * 1000) / 10;
  mkdirSync(mappe, { recursive: true });
  const dest = join(mappe, printfilNavn(base, format));
  const tmp = `${dest}.tmp.png`;
  try {
    let img = sharp(kilde, { failOn: 'none', limitInputPixels: false }).rotate();
    if (r) img = sharp(await img.toBuffer(), { limitInputPixels: false }).rotate(r);
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
  return { path: dest, bytes: statSync(dest).size, token: format, afvigelse };
}
