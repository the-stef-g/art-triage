// Holder alle billed-embeddings i hukommelsen og laver kosinus-soegning.
// Vektorerne er normaliserede, saa lighed = prikprodukt.
//
// Scoringen er selvkalibrerende: i stedet for faste taerskler (som er
// forskellige fra model til model) maales hvor meget et billede skiller
// sig ud fra RESTEN af biblioteket for netop denne soegning. Median og
// MAD (median absolute deviation) bruges frem for gennemsnit/spredning,
// saa ogsaa soegninger med mange aegte match fungerer: medianen bliver
// liggende i "ikke-match"-klumpen.
const ROBUST_Z_MIN = 2.5;
// Portvagt: er selv det BEDSTE billede ikke markant (z under denne),
// er soegningen meningsloes, og der returneres nul resultater. Fanger
// enkelte billeder der ved et tilfaelde sniger sig over ROBUST_Z_MIN.
const BEST_Z_MIN = 3.5;

export class SearchIndex {
  constructor(catalog, model) {
    this.catalog = catalog;
    this.model = model;
    this.vectors = null; // Map<fileId, Float32Array>
  }

  // Skiftes modellen (AI-vinduet melder hvilken den faktisk fik fat i),
  // maa gamle vektorer ikke blandes med nye.
  setModel(model) {
    if (model === this.model) return;
    this.model = model;
    this.vectors = null;
  }

  load() {
    this.vectors = new Map();
    for (const row of this.catalog.allEmbeddings(this.model)) {
      if (!row.dim) continue; // dim=0 er en "kan ikke indekseres"-markering
      const buf = row.vec;
      const vec = new Float32Array(buf.buffer, buf.byteOffset, row.dim);
      this.vectors.set(row.file_id, Float32Array.from(vec));
    }
  }

  ensureLoaded() {
    if (!this.vectors) this.load();
  }

  upsert(fileId, vec) {
    this.ensureLoaded();
    this.vectors.set(fileId, vec);
  }

  remove(fileId) {
    if (this.vectors) this.vectors.delete(fileId);
  }

  size() {
    this.ensureLoaded();
    return this.vectors.size;
  }

  // Returnerer kun billeder der tydeligt skiller sig ud for soegningen,
  // sorteret efter score. En nonsens-soegning har en flad fordeling og
  // giver aerligt nul resultater.
  query(queryVec, { limit = 400, minZ = ROBUST_Z_MIN } = {}) {
    this.ensureLoaded();
    const scored = [];
    for (const [fileId, vec] of this.vectors) {
      scored.push({ fileId, score: dot(queryVec, vec) });
    }
    if (scored.length < 4) return [];
    const { median, mad } = medianMad(scored.map((s) => s.score));
    if (mad < 1e-9) return [];
    const hits = [];
    let bestZ = -Infinity;
    for (const s of scored) {
      const z = robustZ(s.score, median, mad);
      if (z > bestZ) bestZ = z;
      if (z >= minZ) hits.push({ ...s, z });
    }
    if (bestZ < BEST_Z_MIN) return [];
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
}

export function dot(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function normalize(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const norm = Math.sqrt(s) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

// Spredningen maales kun paa den nederste halvdel af fordelingen: match
// ligger altid i toppen, saa den nederste halvdel er ren stoej. Dermed
// blaeses skalaen ikke op, selv naar en stor andel af billederne matcher.
export function medianMad(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const med = kvantil(sorted);
  const nedre = sorted.filter((v) => v <= med);
  const afvigelser = nedre.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return { median: med, mad: kvantil(afvigelser) };
}

// Modificeret z-score: 1.4826 * MAD svarer til én standardafvigelse for
// normalfordelte data, saa taersklen kan taenkes som "antal spredninger".
export function robustZ(value, median, mad) {
  return (value - median) / (1.4826 * mad);
}

function kvantil(sorted) {
  const n = sorted.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
