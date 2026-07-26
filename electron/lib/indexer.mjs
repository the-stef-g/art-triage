// Baggrundsindeksering: soerger for at alle billeder har en embedding, saa
// den semantiske soegning virker. Koerer stille og roligt en fil ad gangen,
// saa soegninger og UI altid har foersteprioritet.
//
// Automatiske noegleord er taget ud af drift. De blev gaettet ved at score
// billedet mod en dansk ordliste og derefter spoerge, om noget ord skilte
// sig ud sammenlignet med de andre ord paa netop det billede. Den
// sammenligning er vendt forkert: ordene er ikke indbyrdes kalibrerede, saa
// en formulering der generelt ligger taet paa "et fotografi" vinder paa
// hvert eneste billede. I praksis landede 'kirke' paa 1170 ud af 1200
// billeder. Noegleord skal i stedet komme fra Claude, jf. punkt 3 i
// docs/plan-cloud-noegleord.md. Indtil da er der ingen gaettede ord, og kun
// dem Stef selv skriver ind.
import { EventEmitter } from 'node:events';
import { normalize } from './searchIndex.mjs';

// Standard-model-id; den faktiske model kan afvige naar AI-vinduet
// falder tilbage til en anden kandidat, og meldes via ready-beskeden.
export const MODEL_ID = 'siglip2-base-patch16-224';

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
  }

  stop() {
    this.stopped = true;
  }

  // Kaldes naar AI-vinduet melder hvilken model der faktisk blev indlaest.
  setModel(model) {
    if (model === this.model) return;
    this.model = model;
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
