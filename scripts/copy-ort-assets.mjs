// Kopierer onnxruntime-web's WASM-filer til public/ort, saa transformers.js
// kan koere helt lokalt uden CDN. Koeres automatisk efter npm install.

import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const outDir = join(projectRoot, 'public', 'ort');

function findOrtDist() {
  // "exports" i onnxruntime-web blokerer require.resolve af package.json,
  // saa vi tjekker de kendte placeringer direkte.
  const candidates = [
    join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist'),
    join(projectRoot, 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web', 'dist'),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

try {
  const dist = findOrtDist();
  if (!dist || !existsSync(dist)) {
    console.warn('[billedflow] onnxruntime-web ikke fundet; springer WASM-kopiering over');
    process.exit(0);
  }
  mkdirSync(outDir, { recursive: true });
  // Alle varianter (plain, jsep, jspi, asyncify): runtimen vaelger selv
  // hvilken den beder om, saa alle skal med.
  const wanted = readdirSync(dist).filter((f) =>
    /^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(f)
  );
  for (const f of wanted) cpSync(join(dist, f), join(outDir, f));
  console.log(`[billedflow] kopierede ${wanted.length} ORT-filer til public/ort`);
} catch (err) {
  console.warn('[billedflow] WASM-kopiering fejlede (fortsaetter):', err.message);
}
