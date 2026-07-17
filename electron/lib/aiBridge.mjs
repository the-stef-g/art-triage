// Bro til det skjulte AI-vindue, hvor transformers.js koerer CLIP-modellen
// (WebGPU hvis muligt, ellers WASM). Hovedprocessen sender jobs et ad
// gangen; tekst-jobs (soegninger) springer koeen over.
import { EventEmitter } from 'node:events';

let nextJobId = 1;

export class AiBridge extends EventEmitter {
  constructor(sendToWindow) {
    super();
    this.sendToWindow = sendToWindow; // (msg) => void, null indtil vinduet findes
    this.queue = [];
    this.current = null;
    this.status = { state: 'starter', progress: 0, detail: '', device: null };
    this.ready = false;
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  // Kaldes af ipcMain naar AI-vinduet sender en besked.
  handleMessage(msg) {
    if (msg.type === 'ready') {
      this.ready = true;
      this.setStatus({ state: 'klar', device: msg.device, modelId: msg.modelId || null, progress: 100 });
      this._pump();
      return;
    }
    if (msg.type === 'status') {
      this.setStatus({ state: msg.state, progress: msg.progress ?? 0, detail: msg.detail ?? '' });
      return;
    }
    if (msg.type === 'result' || msg.type === 'error') {
      const job = this.current;
      this.current = null;
      if (job && job.id === msg.id) {
        if (msg.type === 'result') job.resolve(msg);
        else job.reject(new Error(msg.message || 'AI-fejl'));
      }
      this._pump();
    }
  }

  windowGone() {
    this.ready = false;
    this.setStatus({ state: 'fejl', detail: 'AI-processen stoppede; genstarter' });
    if (this.current) {
      this.current.reject(new Error('AI-processen genstartede'));
      this.current = null;
    }
  }

  _enqueue(payload, priority) {
    return new Promise((resolve, reject) => {
      const job = { id: nextJobId++, payload, resolve, reject };
      if (priority) this.queue.unshift(job);
      else this.queue.push(job);
      this._pump();
    });
  }

  _pump() {
    if (!this.ready || this.current || !this.queue.length || !this.sendToWindow) return;
    this.current = this.queue.shift();
    this.sendToWindow({ id: this.current.id, ...this.current.payload });
  }

  async embedText(text) {
    const res = await this._enqueue({ type: 'embed-text', text }, true);
    return new Float32Array(res.vec);
  }

  async embedImage(url) {
    const res = await this._enqueue({ type: 'embed-image', url }, false);
    return new Float32Array(res.vec);
  }

  pendingCount() {
    return this.queue.length + (this.current ? 1 : 0);
  }
}
