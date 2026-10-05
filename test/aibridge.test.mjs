// De to AI-vinduer: billedmodellen og tekstmodellen indlaeses hver for sig.
// Indekseringen skal kunne starte naar billedmodellen er klar, uden at vente
// paa tekstmodellen, som paa en aeldre Mac tager op til fem minutter.
import { describe, it, expect, beforeEach } from 'vitest';
import { AiBridge } from '../electron/lib/aiBridge.mjs';

let bridge;
let sendt;

beforeEach(() => {
  sendt = [];
  bridge = new AiBridge((role, msg) => sendt.push({ role, ...msg }));
});

const klar = (role, extra = {}) => bridge.handleMessage({ type: 'ready', role, device: 'wasm', modelId: 'siglip2-base', ...extra });
const svar = (role, id, vec = [1, 2]) => bridge.handleMessage({ type: 'result', role, id, vec });

describe('indlaesning', () => {
  it('er klar til billeder naar billedmodellen er klar, ogsaa mens teksten indlaeses', () => {
    const events = [];
    bridge.on('image-ready', (e) => events.push(e));
    klar('image');
    expect(bridge.ready).toBe(true);
    expect(bridge.textReady).toBe(false);
    expect(events).toEqual([{ modelId: 'siglip2-base', device: 'wasm' }]);
  });

  it('sender billedjobs til billedvinduet og tekstjobs til tekstvinduet', async () => {
    klar('image');
    klar('text');
    const b = bridge.embedImage('thumb://img/1');
    const t = bridge.embedText('gule blomster');
    expect(sendt.map((m) => [m.role, m.type])).toEqual([['image', 'embed-image'], ['text', 'embed-text']]);
    svar('image', sendt[0].id, [3]);
    svar('text', sendt[1].id, [4]);
    expect(Array.from(await b)).toEqual([3]);
    expect(Array.from(await t)).toEqual([4]);
  });

  it('laeger billedjobs i koe uden at vente paa teksten', async () => {
    const b = bridge.embedImage('thumb://img/1');
    expect(sendt).toEqual([]); // billedmodellen er ikke klar endnu
    klar('image'); // teksten er stadig ikke klar
    expect(sendt.map((m) => m.role)).toEqual(['image']);
    svar('image', sendt[0].id);
    await b;
  });

  it('holder et tekstjob tilbage til tekstmodellen er klar', async () => {
    klar('image');
    const t = bridge.embedText('soeg');
    expect(sendt).toEqual([]);
    klar('text');
    expect(sendt.map((m) => m.role)).toEqual(['text']);
    svar('text', sendt[0].id);
    await t;
  });

  it('lader en soegning springe foran i tekstkoeen, men ikke imellem billeder', () => {
    klar('image');
    klar('text');
    bridge.embedImage('a');
    bridge.embedImage('b');
    bridge.embedText('x');
    bridge.embedText('y');
    // ét job pr. vindue ad gangen: foerste billede og foerste tekst
    expect(sendt.map((m) => m.role).sort()).toEqual(['image', 'text']);
    expect(bridge.pendingCount()).toBe(4);
  });
});

describe('status', () => {
  const sidste = () => bridge.status;

  it('viser billedmodellen foerst og derefter tekstmodellens fremdrift', () => {
    bridge.handleMessage({ type: 'status', role: 'image', state: 'model', progress: 40, detail: 'Preparing image model (12 s)' });
    bridge.handleMessage({ type: 'status', role: 'text', state: 'model', progress: null, detail: 'Preparing search model (3 s)' });
    expect(sidste().detail).toBe('Preparing image model (12 s)');
    klar('image');
    expect(sidste()).toMatchObject({ state: 'model', detail: 'Preparing search model (3 s)' });
    klar('text');
    expect(sidste()).toMatchObject({ state: 'klar', progress: 100, device: 'wasm', modelId: 'siglip2-base' });
  });

  it('viser en fejl fra ét af vinduerne, ogsaa naar det andet er klar', () => {
    klar('image');
    bridge.handleMessage({ type: 'status', role: 'text', state: 'offline', progress: 0, detail: 'Could not download the model' });
    expect(sidste()).toMatchObject({ state: 'offline', detail: 'Could not download the model' });
  });

  it('udsender status ved hver aendring', () => {
    const set = [];
    bridge.on('status', (s) => set.push(s.state));
    bridge.handleMessage({ type: 'status', role: 'image', state: 'model', progress: 0, detail: 'x' });
    klar('image');
    expect(set).toEqual(['model', 'model']);
  });
});

describe('et vindue der doer', () => {
  it('afviser kun det vindues job og goer kun det vindue ukaldt', async () => {
    klar('image');
    klar('text');
    const b = bridge.embedImage('a');
    const t = bridge.embedText('x');
    const billedFejl = b.catch((e) => e.message);
    bridge.windowGone('text');
    await expect(t).rejects.toThrow(/restarted/);
    expect(bridge.textReady).toBe(false);
    expect(bridge.ready).toBe(true);
    // Billedjobbet er uberoert og kan stadig besvares.
    svar('image', sendt.find((m) => m.role === 'image').id);
    await b;
    void billedFejl;
  });

  it('goer begge ukaldte uden role, og tager jobs op igen naar de er klar', async () => {
    klar('image');
    klar('text');
    bridge.windowGone();
    expect(bridge.ready).toBe(false);
    expect(bridge.textReady).toBe(false);
    const b = bridge.embedImage('a');
    expect(sendt).toEqual([]);
    klar('image');
    svar('image', sendt[0].id);
    await b;
  });
});
