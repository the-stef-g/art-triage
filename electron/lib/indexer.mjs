// Baggrundsindeksering: soerger for at alle billeder har en embedding og
// automatiske danske noegleord. Koerer stille og roligt en fil ad gangen,
// saa soegninger og UI altid har foersteprioritet.
import { EventEmitter } from 'node:events';
import { VOCAB, vocabHash } from './vocab.mjs';
import { normalize, dot, medianMad, robustZ } from './searchIndex.mjs';

// Standard-model-id; den faktiske model kan afvige naar AI-vinduet
// falder tilbage til en anden kandidat, og meldes via ready-beskeden.
export const MODEL_ID = 'siglip2-base-patch16-224';
const KEYWORDS_PER_IMAGE = 6;
// Selvkalibrerende: et ord tildeles kun hvis det skiller sig tydeligt ud
// fra resten af ordlisten for netop dette billede (robust z-score).
const KEYWORD_Z_MIN = 2.5;
// Staerk-port: er selv det bedste ord ikke markant, faar billedet ingen
// noegleord (undgaar forkerte ord paa intetsigende billeder).
const KEYWORD_BEST_Z = 3.0;
// Antal bekraeftede eksempler foer et af Stefs egne ord foreslaas paa
// andre billeder (konservativt, saa enkelttilfaelde ikke spreder stoej).
const PROPAGATE_MIN_EXAMPLES = 2;
// Blandingsvaegt: v = norm(alpha*prompt + (1-alpha)*prototype), hvor
// alpha = K/(K+n). Jo flere af Stefs eksempler, jo mere styrer de.
const BLEND_K = 3;
// Bumpes naar tildelingslogikken aendres, saa noegleord genberegnes fra
// de gemte embeddings ved naeste biblioteksaabning.
const KEYWORD_LOGIC_VERSION = '3';

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
    this.vocabVecs = null; // [{word, vec}] raa ordliste-embeddings
    this.candidates = null; // [{word, vec}] blandet med laerte prototyper
    this.candidatesRev = -1; // feedback-revision candidates blev bygget for
  }

  stop() {
    this.stopped = true;
  }

  // Kaldes naar AI-vinduet melder hvilken model der faktisk blev indlaest.
  setModel(model) {
    if (model === this.model) return;
    this.model = model;
    this.vocabVecs = null;
    this.candidates = null;
    this.candidatesRev = -1;
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
    if (!this._ensureCandidates()) return;
    const rejected = this.catalog.rejectedWordsForFile(fileId);
    const scored = this.candidates
      .filter((c) => !rejected.has(c.word))
      .map(({ word, vec: wv }) => ({ word, score: dot(vec, wv) }));
    if (scored.length < 2) {
      this.catalog.saveKeywords(fileId, []);
      return;
    }
    const { median, mad } = medianMad(scored.map((s) => s.score));
    if (mad < 1e-9) {
      this.catalog.saveKeywords(fileId, []);
      return;
    }
    const medZ = scored
      .map((s) => ({ word: s.word, score: robustZ(s.score, median, mad) }))
      .sort((a, b) => b.score - a.score);
    // Staerk-port: er selv toppen ikke markant, faar billedet ingen ord.
    if (!medZ.length || medZ[0].score < KEYWORD_BEST_Z) {
      this.catalog.saveKeywords(fileId, []);
      return;
    }
    const valgte = medZ.filter((s) => s.score >= KEYWORD_Z_MIN).slice(0, KEYWORDS_PER_IMAGE);
    this.catalog.saveKeywords(fileId, valgte);
  }

  // Bygger kandidat-vektorerne: ordlisten blandet med de prototyper appen
  // har laert af Stefs bekraeftelser, plus hans egne ord. Genopbygges naar
  // feedback-revisionen aendrer sig. Returnerer false hvis ordlisten ikke
  // er beregnet endnu (AI har ikke koert).
  _ensureCandidates() {
    if (!this._loadVocabFromCache()) return false;
    const rev = this.catalog.feedbackRevision();
    if (this.candidates && this.candidatesRev === rev) return true;

    const globalRej = this.catalog.globallyRejectedWords();
    const confirmed = this.catalog.confirmedExamples();
    // Embeddings som opslag, saa prototyper kan beregnes.
    const embByFile = new Map();
    for (const row of this.catalog.allEmbeddings(this.model)) {
      if (!row.dim) continue;
      const buf = row.vec;
      embByFile.set(row.file_id, Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, row.dim)));
    }
    const prototype = (fileIds) => {
      const vecs = fileIds.map((id) => embByFile.get(id)).filter(Boolean);
      if (!vecs.length) return null;
      const dim = vecs[0].length;
      const sum = new Float32Array(dim);
      for (const v of vecs) for (let i = 0; i < dim; i++) sum[i] += v[i];
      return { vec: normalize(sum), n: vecs.length };
    };

    const cands = [];
    const vocabWords = new Set(this.vocabVecs.map((v) => v.word));
    // Ordliste-ord: promptvektor blandet med evt. laert prototype.
    for (const { word, vec } of this.vocabVecs) {
      if (globalRej.has(word)) continue;
      const ex = confirmed.get(word);
      const proto = ex ? prototype(ex) : null;
      if (proto) {
        const alpha = BLEND_K / (BLEND_K + proto.n);
        const blended = new Float32Array(vec.length);
        for (let i = 0; i < vec.length; i++) blended[i] = alpha * vec[i] + (1 - alpha) * proto.vec[i];
        cands.push({ word, vec: normalize(blended) });
      } else {
        cands.push({ word, vec });
      }
    }
    // Stefs egne ord (ikke i ordlisten): foreslaas naar der er nok eksempler.
    for (const [word, ex] of confirmed) {
      if (vocabWords.has(word) || globalRej.has(word)) continue;
      if (ex.length < PROPAGATE_MIN_EXAMPLES) continue;
      const proto = prototype(ex);
      if (proto) cands.push({ word, vec: proto.vec });
    }

    this.candidates = cands;
    this.candidatesRev = rev;
    return true;
  }

  // Genberegner alle noegleord fra de gemte embeddings og de aktuelle
  // kandidat-vektorer. Ren matematik, ingen AI noedvendig; koeres ved
  // biblioteksaabning og efter enhver rettelse (naar logik- eller
  // feedback-versionen er aendret siden sidst).
  recomputeKeywords() {
    if (!this._ensureCandidates()) return false; // AI har ikke lavet ordlisten endnu
    const flagKey = `kwlogic:${this.model}`;
    const oensket = `${KEYWORD_LOGIC_VERSION}:${vocabHash()}:${this.catalog.feedbackRevision()}`;
    if (this.catalog.getMeta(flagKey) === oensket) return false;
    let antal = 0;
    for (const row of this.catalog.allEmbeddings(this.model)) {
      if (!row.dim) continue;
      const buf = row.vec;
      const vec = new Float32Array(buf.buffer, buf.byteOffset, row.dim);
      this._assignKeywords(row.file_id, Float32Array.from(vec));
      antal++;
    }
    this.catalog.setMeta(flagKey, oensket);
    if (antal) this.catalog.emit('changed');
    return antal > 0;
  }

  _loadVocabFromCache() {
    if (this.vocabVecs) return true;
    const key = `vocab:${this.model}:${vocabHash()}`;
    const cached = this.catalog.getMeta(key);
    if (!cached) return false;
    const parsed = JSON.parse(cached);
    this.vocabVecs = parsed.map(({ word, vec }) => {
      const buf = Buffer.from(vec, 'base64');
      return {
        word,
        vec: Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)),
      };
    });
    return true;
  }

  // Ordlistens embeddings beregnes en gang pr. model/ordliste og caches i DB.
  async _ensureVocab() {
    if (this._loadVocabFromCache()) return;
    const key = `vocab:${this.model}:${vocabHash()}`;
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
    // recomputeKeywords ejer kwlogic-flaget; her noejes vi med at cache
    // ordlisten, saa en fuld genberegning koerer mindst en gang bagefter.
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
