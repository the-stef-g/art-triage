// Baggrundsindeksering: soerger for at alle billeder har en embedding og
// automatiske danske noegleord. Koerer stille og roligt en fil ad gangen,
// saa soegninger og UI altid har foersteprioritet.
import { EventEmitter } from 'node:events';
import { VOCAB, vocabHash } from './vocab.mjs';
import { normalize, dot } from './searchIndex.mjs';

// Standard-model-id; den faktiske model kan afvige naar AI-vinduet
// falder tilbage til en anden kandidat, og meldes via ready-beskeden.
export const MODEL_ID = 'siglip-base-patch16-256-multilingual';
const KEYWORDS_PER_IMAGE = 6;
const KEYWORD_THRESHOLD = 0.2;

export class Indexer extends EventEmitter {
  constructor({ catalog, thumbs, ai, searchIndex, model = MODEL_ID }) {
    super();
    this.model = model;
    this.catalog = catalog;
    this.thumbs = thumbs;
    this.ai = ai;
    this.searchIndex = searchIndex;
    this.running = false;
    this.stopped = false;
    this.progress = { done: 0, total: 0, phase: 'venter' };
    this.vocabVecs = null; // [{word, vec}]
  }

  stop() {
    this.stopped = true;
  }

  // Kaldes naar AI-vinduet melder hvilken model der faktisk blev indlaest.
  setModel(model) {
    if (model === this.model) return;
    this.model = model;
    this.vocabVecs = null;
  }

  setProgress(patch) {
    this.progress = { ...this.progress, ...patch };
    this.emit('progress', this.progress);
  }

  // Kaldes ved biblioteksaabning og efter hver synkronisering.
  kick() {
    if (this.running || this.stopped) return;
    this.running = true;
    this._loop()
      .catch(() => {})
      .finally(() => {
        this.running = false;
      });
  }

  async _loop() {
    if (!this.ai.ready) return; // kick() kaldes igen naar AI melder klar
    await this._ensureVocab();
    for (;;) {
      if (this.stopped) return;
      const pending = this.catalog.filesNeedingEmbedding(this.model);
      if (!pending.length) {
        this.setProgress({ phase: 'faerdig', done: 0, total: 0 });
        return;
      }
      this.setProgress({ phase: 'billeder', total: this.progress.total || pending.length });
      const file = pending[0];
      await this._indexFile(file);
      this.setProgress({ done: this.progress.done + 1 });
    }
  }

  async _indexFile(file) {
    const absPath = this.catalog.abs(file.rel_path);
    let vec = null;
    const thumbPath = await this.thumbs.ensure(file.id, file.mtime, absPath, 512);
    if (thumbPath) {
      try {
        vec = await this.ai.embedImage(`thumb://img/${file.id}?s=512&v=${file.mtime}`);
      } catch {
        vec = null;
      }
    }
    if (!vec) {
      // Markering: kan ikke indekseres (ingen preview). dim=0.
      this.catalog.saveEmbedding(file.id, this.model, new Float32Array(0));
      return;
    }
    const norm = normalize(vec);
    this.catalog.saveEmbedding(file.id, this.model, norm);
    this.searchIndex.upsert(file.id, norm);
    this._assignKeywords(file.id, norm);
  }

  _assignKeywords(fileId, vec) {
    if (!this.vocabVecs) return;
    const scored = this.vocabVecs
      .map(({ word, vec: wv }) => ({ word, score: dot(vec, wv) }))
      .sort((a, b) => b.score - a.score)
      .filter((s) => s.score >= KEYWORD_THRESHOLD)
      .slice(0, KEYWORDS_PER_IMAGE);
    this.catalog.saveKeywords(fileId, scored);
  }

  // Ordlistens embeddings beregnes en gang pr. model/ordliste og caches i DB.
  async _ensureVocab() {
    if (this.vocabVecs) return;
    const key = `vocab:${this.model}:${vocabHash()}`;
    const cached = this.catalog.getMeta(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      this.vocabVecs = parsed.map(({ word, vec }) => {
        const buf = Buffer.from(vec, 'base64');
        return {
          word,
          vec: Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)),
        };
      });
      return;
    }
    this.setProgress({ phase: 'ordliste', done: 0, total: VOCAB.length });
    const out = [];
    for (let i = 0; i < VOCAB.length; i++) {
      if (this.stopped) return;
      const { word, prompt } = VOCAB[i];
      const vec = normalize(await this.ai.embedText(prompt));
      out.push({ word, vec });
      if (i % 10 === 0) this.setProgress({ done: i });
    }
    this.vocabVecs = out;
    this.catalog.setMeta(key, JSON.stringify(out.map(({ word, vec }) => ({
      word,
      vec: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64'),
    }))));
    this.setProgress({ phase: 'venter', done: 0, total: 0 });
  }

  // Ved redigeringer skal filen indekseres om.
  invalidateFiles(fileIds) {
    for (const id of fileIds) {
      this.catalog.clearEmbedding(id);
      this.searchIndex.remove(id);
    }
    this.kick();
  }
}
