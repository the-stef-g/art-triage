// Tjekker at sharp er med i den pakkede app, udpakket af asar, og at
// binaeren passer til maskinen appen skal koere paa. electron-builder
// dropper devDependencies uden en advarsel, og en .node-fil inde i en
// asar kan ikke indlaeses. Begge dele giver foerst en fejl naar appen
// koeres, saa tjekket sker i byggeriet.
//
// Brug: node scripts/check-packaged-sharp.mjs <Resources-mappen> <darwin-x64|linux-x64>
// Resources-mappen er "Art Triage.app/Contents/Resources" paa macOS.
import { existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Hvilken processor en Mach-O-fil er bygget til, eller ELF paa Linux.
export function binaryKind(buf) {
  if (buf.length >= 8 && buf.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = buf.readUInt32LE(4);
    if (cpu === 0x01000007) return 'darwin-x64';
    if (cpu === 0x0100000c) return 'darwin-arm64';
    return `darwin-cpu-${cpu.toString(16)}`;
  }
  if (buf.length >= 20 && buf.toString('latin1', 1, 4) === 'ELF') {
    const machine = buf.readUInt16LE(18);
    if (machine === 0x3e) return 'linux-x64';
    if (machine === 0xb7) return 'linux-arm64';
    return `linux-machine-${machine.toString(16)}`;
  }
  return 'unknown';
}

function head(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(32);
    readSync(fd, buf, 0, 32, 0);
    return buf;
  } finally {
    closeSync(fd);
  }
}

// Returnerer en liste af fejl; tom liste betyder at alt er i orden.
export function checkPackagedSharp(resources, platform) {
  const fejl = [];
  const unpacked = join(resources, 'app.asar.unpacked', 'node_modules');
  if (!existsSync(join(unpacked, 'sharp', 'package.json'))) {
    fejl.push('sharp is not unpacked from the asar (app.asar.unpacked/node_modules/sharp is missing)');
    return fejl;
  }
  const img = join(unpacked, '@img');
  const pakker = existsSync(img) ? readdirSync(img) : [];
  const binaerPakke = pakker.find((n) => n === `sharp-${platform}`);
  if (!binaerPakke) {
    fejl.push(`the sharp-${platform} binary package is missing (found: ${pakker.join(', ') || 'none'})`);
    return fejl;
  }
  const lib = join(img, binaerPakke, 'lib');
  const node = existsSync(lib) ? readdirSync(lib).find((n) => n.endsWith('.node')) : null;
  if (!node) {
    fejl.push(`no .node file in ${binaerPakke}/lib`);
  } else {
    const slags = binaryKind(head(join(lib, node)));
    if (slags !== platform) fejl.push(`${node} is built for ${slags}, not ${platform}`);
  }
  const vips = pakker.find((n) => n === `sharp-libvips-${platform}`);
  if (!vips) fejl.push(`the sharp-libvips-${platform} package is missing`);
  else if (!readdirSync(join(img, vips, 'lib')).some((n) => /^libvips-cpp.*\.(dylib|so.*)$/.test(n))) {
    fejl.push(`no libvips library in ${vips}/lib`);
  }
  // Maa ikke vaere pakket ind i asar'en uden at vaere udpakket.
  return fejl;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [resources, platform] = process.argv.slice(2);
  if (!resources || !platform) {
    console.error('Usage: node scripts/check-packaged-sharp.mjs <Resources dir> <darwin-x64|linux-x64>');
    process.exit(2);
  }
  const fejl = checkPackagedSharp(resources, platform);
  if (fejl.length) {
    for (const f of fejl) console.error(`PACKAGING ERROR: ${f}`);
    process.exit(1);
  }
  console.log(`OK: sharp is packaged, unpacked and built for ${platform}`);
}
