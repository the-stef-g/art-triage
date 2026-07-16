// AI-arbejderen: koerer i et skjult vindue og laver CLIP-embeddings af
// billeder (via thumb://-previews) og dansk soegetekst. Modellerne hentes
// foerste gang fra Hugging Face (eller det offentlige spejl hf-mirror.com,
// hvis HF's anonyme kvote afviser os) og caches derefter lokalt af
// browserens Cache API. Inferens koerer enkelttraadet paa WASM: langsommere
// end traade, men starter altid, ogsaa under appens egen app://-protokol.
import {
  env,
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';

const IMG_MODEL = 'Xenova/clip-vit-base-patch32';
const TXT_MODEL = 'Xenova/clip-ViT-B-32-multilingual-v1';
const HOSTS = ['https://huggingface.co/', 'https://hf-mirror.com/'];
const HOST_KEY = 'billedflow-hf-host';
// Stigende ventetid mellem forsoeg, saa HF's anonyme kvote ikke braendes af.
const RETRY_DELAYS_S = [30, 60, 120, 300, 600];
// Ingen aktivitet i saa lang tid under opstart = haenger; afbryd og proev igen.
const STALL_MS = 4 * 60 * 1000;

env.allowLocalModels = false;
// ORT's WASM-filer er bundtet med appen, saa inferens virker offline.
env.backends.onnx.wasm.wasmPaths = new URL('ort/', document.baseURI).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const bridge = window.aiBridge;
const send = (msg) => bridge.send(msg);

let hfToken = null;

// En valgfri Hugging Face-token haever download-graenserne markant.
// Tokenet saettes KUN paa kald til huggingface.co, aldrig til spejlet.
const origFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  try {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (hfToken && url.startsWith('https://huggingface.co/')) {
      const headers = { ...((init && init.headers) || {}), Authorization: `Bearer ${hfToken}` };
      init = { ...(init || {}), headers };
    }
  } catch {
    // wrapping maa aldrig blokere et kald
  }
  return origFetch(input, init);
};

let processor = null;
let visionModel = null;
let tokenizer = null;
let textModel = null;

let lastActivity = Date.now();
const puls = () => {
  lastActivity = Date.now();
};

function progressReporter(fase) {
  const files = new Map();
  return (p) => {
    puls();
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    const pct = total ? Math.round((loaded / total) * 100) : 0;
    send({ type: 'status', state: 'model', progress: pct, detail: fase });
  };
}

// Afviser hvis loadet gaar i staa (ingen aktivitet i STALL_MS).
function medStallVagt(promise) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() - lastActivity > STALL_MS) {
        clearInterval(timer);
        reject(new Error('Modellen svarede ikke under start'));
      }
    }, 10000);
    promise.then(
      (v) => { clearInterval(timer); resolve(v); },
      (e) => { clearInterval(timer); reject(e); }
    );
  });
}

function pickHost(attempt) {
  let start = 0;
  try {
    const husket = localStorage.getItem(HOST_KEY);
    if (husket && HOSTS.includes(husket)) start = HOSTS.indexOf(husket);
  } catch {
    // localStorage kan mangle
  }
  return HOSTS[(start + attempt) % HOSTS.length];
}

function hostNavn(host) {
  return host.includes('hf-mirror') ? ' (spejl)' : '';
}

// Vision og tekst indlaeses uafhaengigt, saa en fejl paa den ene ikke
// koster en ny download af den anden. Kun q8: fp32 kan ikke allokeres i
// 32-bit WASM og koster 600 MB spildt download pr. forsoeg.
async function loadVision(host) {
  if (visionModel) return;
  const progress_callback = progressReporter(`Henter billedmodel${hostNavn(host)}`);
  puls();
  processor = processor || await medStallVagt(
    AutoProcessor.from_pretrained(IMG_MODEL, { progress_callback })
  );
  puls();
  visionModel = await medStallVagt(
    CLIPVisionModelWithProjection.from_pretrained(IMG_MODEL, {
      device: 'wasm', dtype: 'q8', progress_callback,
    })
  );
}

async function loadText(host) {
  if (textModel) return;
  const progress_callback = progressReporter(`Henter sprogmodel${hostNavn(host)}`);
  puls();
  tokenizer = tokenizer || await medStallVagt(
    AutoTokenizer.from_pretrained(TXT_MODEL, { progress_callback })
  );
  puls();
  textModel = await medStallVagt(
    CLIPTextModelWithProjection.from_pretrained(TXT_MODEL, {
      device: 'wasm', dtype: 'q8', progress_callback,
    })
  );
}

async function init() {
  try {
    const cfg = await bridge.getInit();
    hfToken = cfg?.hfToken || null;
  } catch {
    hfToken = null;
  }
  for (let attempt = 0; ; attempt++) {
    const host = pickHost(attempt);
    env.remoteHost = host;
    send({ type: 'status', state: 'model', progress: 0, detail: `Henter billedmodel${hostNavn(host)}` });
    try {
      await loadVision(host);
      send({ type: 'status', state: 'model', progress: 50, detail: `Henter sprogmodel${hostNavn(host)}` });
      await loadText(host);
      send({ type: 'status', state: 'model', progress: 99, detail: 'Starter modellen' });
      await medStallVagt(embedText('test'));
      try {
        localStorage.setItem(HOST_KEY, host);
      } catch {
        // hukommelsen om host er kun en optimering
      }
      send({ type: 'ready', device: 'wasm' });
      return;
    } catch (err) {
      console.error('Modelstart fejlede', host, err);
      const besked = err?.message || String(err);
      const unauthorized = /unauthorized/i.test(besked);
      const tip = unauthorized && !hfToken
        ? ' Tip: En gratis Hugging Face-token (Hjælp-menuen) løser download-grænsen.'
        : '';
      const delay = RETRY_DELAYS_S[Math.min(attempt, RETRY_DELAYS_S.length - 1)];
      send({
        type: 'status',
        state: 'offline',
        progress: 0,
        detail: `Kunne ikke hente modellen${hostNavn(host)}: ${besked} Prøver igen om ${delay} sekunder.${tip}`,
      });
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
}

async function embedText(text) {
  const inputs = tokenizer([text], { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs);
  return Array.from(text_embeds.data);
}

async function embedImage(url) {
  const image = await RawImage.read(url);
  const inputs = await processor(image);
  const { image_embeds } = await visionModel(inputs);
  return Array.from(image_embeds.data);
}

bridge.onJob(async (job) => {
  try {
    let vec;
    if (job.type === 'embed-text') vec = await embedText(job.text);
    else if (job.type === 'embed-image') vec = await embedImage(job.url);
    else throw new Error(`Ukendt jobtype: ${job.type}`);
    send({ id: job.id, type: 'result', vec });
  } catch (err) {
    send({ id: job.id, type: 'error', message: err?.message || String(err) });
  }
});

init();
