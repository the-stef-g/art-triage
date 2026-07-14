// Holder alle billed-embeddings i hukommelsen og laver kosinus-soegning.
// Vektorerne er normaliserede, saa lighed = prikprodukt.
export class SearchIndex {
  constructor(catalog, model) {
    this.catalog = catalog;
    this.model = model;
    this.vectors = null; // Map<fileId, Float32Array>
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

  // Returnerer filer sorteret efter relevans. Taersklen er adaptiv: gode
  // match ligger typisk paa 0,25-0,35 i CLIP-rummet.
  query(queryVec, { limit = 500 } = {}) {
    this.ensureLoaded();
    const scored = [];
    for (const [fileId, vec] of this.vectors) {
      scored.push({ fileId, score: dot(queryVec, vec) });
    }
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) return [];
    const best = scored[0].score;
    const threshold = Math.max(0.18, best - 0.1);
    const hits = scored.filter((s) => s.score >= threshold).slice(0, limit);
    // Faa resultater er bedre end nul: vis altid en haandfuld af de bedste.
    if (hits.length < 8) return scored.slice(0, Math.min(8, scored.length));
    return hits;
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
