// Bro til de skjulte AI-vinduer, hvor transformers.js koerer SigLIP-modellen.
// Der er to vinduer, hvert i sin proces: "image" (billedmodellen, til
// indeksering) og "text" (tekstmodellen, til soegning). De indlaeses
// samtidig. Foer var det ét vindue, der indlaeste dem efter hinanden, og
// indekseringen ventede paa at den langsomme tekstmodel (op til fem minutter
// paa en aeldre Intel-Mac) var klar, selv om den ikke bruger den.
// Hovedprocessen sender jobs ét ad gangen pr. vindue; tekst-jobs
// (soegninger) springer koeen over.
import { EventEmitter } from 'node:events';

let nextJobId = 1;

const ROLLER = ['image', 'text'];

const tom = () => ({ state: 'starter', progress: 0, detail: '', device: null });

export class AiBridge extends EventEmitter {
  constructor(sendToWindow) {
    super();
    this.sendToWindow = sendToWindow; // (role, msg) => void, null indtil vinduerne findes
    this.queues = { image: [], text: [] };
    this.currents = { image: null, text: null };
    this.roleStatus = { image: tom(), text: tom() };
    this.status = tom();
    // ready: billedmodellen er klar (indeksering). textReady: tekstmodellen
    // er klar (soegning). Det er to forskellige tidspunkter.
    this.ready = false;
    this.textReady = false;
    this.modelId = null;
  }

  // Den status brugerfladen viser. Er billedmodellen klar men teksten ikke,
  // vises tekstmodellens fremdrift; indekseringen koerer alligevel.
  _samlet() {
    const b = this.roleStatus.image;
    const t = this.roleStatus.text;
    const daarlig = [b, t].find((s) => s.state === 'offline' || s.state === 'fejl');
    if (daarlig) return { ...daarlig, modelId: this.modelId };
    if (this.ready && this.textReady) {
      return { state: 'klar', progress: 100, detail: '', device: b.device, modelId: this.modelId };
    }
    if (this.ready) {
      return { state: 'model', progress: t.progress, detail: t.detail || 'Preparing search model', device: b.device, modelId: this.modelId };
    }
    return { ...b, modelId: this.modelId };
  }

  _publicer() {
    this.status = this._samlet();
    this.emit('status', this.status);
  }

  // Kaldes af ipcMain naar et AI-vindue sender en besked. role saettes af
  // hovedprocessen ud fra hvilket vindue beskeden kom fra.
  handleMessage(msg) {
    const role = msg.role === 'text' ? 'text' : 'image';
    if (msg.type === 'ready') {
      this.roleStatus[role] = { state: 'klar', progress: 100, detail: '', device: msg.device ?? null };
      if (msg.modelId) this.modelId = msg.modelId;
      if (role === 'image') {
        this.ready = true;
        this.emit('image-ready', { modelId: this.modelId, device: msg.device ?? null });
      } else {
        this.textReady = true;
      }
      this._pump(role);
      this._publicer();
      return;
    }
    if (msg.type === 'status') {
      // progress kan bevidst vaere null: faserne efter download melder
      // ingen procent, og et paatvunget 0 ville se ud som om alt gik om
      // forfra. Statuslinjen udelader tallet naar det er null.
      this.roleStatus[role] = { ...this.roleStatus[role], state: msg.state, progress: msg.progress ?? null, detail: msg.detail ?? '' };
      this._publicer();
      return;
    }
    if (msg.type === 'result' || msg.type === 'error') {
      const job = this.currents[role];
      this.currents[role] = null;
      if (job && job.id === msg.id) {
        if (msg.type === 'result') job.resolve(msg);
        else job.reject(new Error(msg.message || 'AI error'));
      }
      this._pump(role);
    }
  }

  // Et vindue er doet eller genstartes. Uden role: begge.
  windowGone(role = null) {
    for (const r of role ? [role] : ROLLER) {
      if (r === 'image') this.ready = false;
      else this.textReady = false;
      this.roleStatus[r] = { state: 'fejl', progress: null, detail: 'The AI process stopped; restarting', device: null };
      if (this.currents[r]) {
        this.currents[r].reject(new Error('The AI process restarted'));
        this.currents[r] = null;
      }
    }
    this._publicer();
  }

  _enqueue(role, payload, priority) {
    return new Promise((resolve, reject) => {
      const job = { id: nextJobId++, payload, resolve, reject };
      if (priority) this.queues[role].unshift(job);
      else this.queues[role].push(job);
      this._pump(role);
    });
  }

  _pump(role) {
    const klar = role === 'image' ? this.ready : this.textReady;
    if (!klar || this.currents[role] || !this.queues[role].length || !this.sendToWindow) return;
    this.currents[role] = this.queues[role].shift();
    this.sendToWindow(role, { id: this.currents[role].id, ...this.currents[role].payload });
  }

  async embedText(text) {
    const res = await this._enqueue('text', { type: 'embed-text', text }, true);
    return new Float32Array(res.vec);
  }

  async embedImage(url) {
    const res = await this._enqueue('image', { type: 'embed-image', url }, false);
    return new Float32Array(res.vec);
  }

  pendingCount() {
    return ROLLER.reduce((n, r) => n + this.queues[r].length + (this.currents[r] ? 1 : 0), 0);
  }
}
