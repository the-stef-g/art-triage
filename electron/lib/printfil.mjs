// Fase 5: printfilen til Prodigi. Prodigi vil have RGB, og deres egne
// ICC-profiler er kun til proevetryk og maa ikke lægges i filen. Filen
// laves derfor i sRGB, 8 bit, maerket 300 DPI, i fuld opløsning: Prodigi
// skalerer selv til den størrelse der bestilles. Masteren roeres ikke.
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PRINT_DPI = 300;

// Navnet paa printfilen: beskaeringens navn med .png ("Desert 2-3.png").
export function printfilNavn(stem) {
  return `${stem}.png`;
}

// rotation er brugerens egen drejning (grader med uret), lagt oven paa
// filens EXIF-retning, saa printfilen staar som billedet vises i appen.
// En eksisterende printfil med samme navn erstattes: den er afledt af
// beskaeringen og laves bare igen.
export async function lavPrintfil({ kilde, mappe, stem, rotation = 0 }) {
  if (!existsSync(kilde)) throw new Error('The file is not on disk');
  const sharp = (await import('sharp')).default;
  mkdirSync(mappe, { recursive: true });
  const dest = join(mappe, printfilNavn(stem));
  const tmp = `${dest}.tmp.png`;
  const r = ((Number(rotation) || 0) % 360 + 360) % 360;
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
  return { path: dest, bytes: statSync(dest).size };
}
