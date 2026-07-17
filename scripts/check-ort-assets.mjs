// Tjekker efter build at alle ORT-wasm-filer, som den bundtede
// AI-kode refererer til, faktisk ligger i dist/ort. Fanger den
// fejlklasse hvor runtimen beder om en variant (fx .asyncify.mjs)
// som kopiscriptet ikke fik med. Koeres i CI efter `npm run build`.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(projectRoot, 'dist', 'assets');
const ortDir = join(projectRoot, 'dist', 'ort');

if (!existsSync(assetsDir)) {
  console.error('dist/assets findes ikke; koer `npm run build` foerst');
  process.exit(1);
}

const aiBundles = readdirSync(assetsDir).filter((f) => /^ai-.*\.js$/.test(f));
if (!aiBundles.length) {
  console.error('Ingen ai-*.js bundle fundet i dist/assets');
  process.exit(1);
}

const refererede = new Set();
for (const f of aiBundles) {
  const kode = readFileSync(join(assetsDir, f), 'utf8');
  for (const m of kode.matchAll(/ort-wasm-simd-threaded[\w.-]*\.(?:mjs|wasm)/g)) {
    refererede.add(m[0]);
  }
}

if (!refererede.size) {
  console.error('Ingen ORT-filreferencer fundet i AI-bundlen; det ligner en fejl');
  process.exit(1);
}

let fejl = 0;
for (const navn of [...refererede].sort()) {
  if (existsSync(join(ortDir, navn))) {
    console.log(`OK      dist/ort/${navn}`);
  } else if (existsSync(join(assetsDir, navn))) {
    // Vite bundter selv nogle varianter som hash-navngivne assets.
    console.log(`OK      dist/assets/${navn}`);
  } else {
    console.error(`MANGLER ${navn} (hverken i dist/ort eller dist/assets)`);
    fejl = 1;
  }
}
process.exit(fejl);
