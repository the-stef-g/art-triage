// AI-arbejderen: koerer i et skjult vindue og laver CLIP-embeddings af
// billeder (via thumb://-previews) og dansk soegetekst. Alle modelfiler
// hentes gennem hovedprocessens hfmodel://-protokol, som haandterer
// Hugging Face, spejl-fallback, token og disk-cache uden CORS-bindinger.
// Inferens koerer enkelttraadet paa WASM: langsommere end traade, men
// starter altid, ogsaa under appens egen app://-protokol.
import {
  env,
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';

const IMG_MODEL = 'Xenova/clip-vit-base-patch32';
// Sprogmodellens gamle repo er forsvundet fra Hugging Face; proev
// kandidaterne i raekkefoelge og husk den der virker.
const TXT_CANDIDATES = [
  'Xenova/clip-ViT-B-32-multilingual-v1',
  'onnx-community/clip-ViT-B-32-multilingual-v1-ONNX',
  'onnx-community/clip-ViT-B-32-multilingual-v1',
];
const TXT_KEY = 'billedflow-txt-model';
// Stigende ventetid mellem forsoeg, saa HF's anonyme kvote ikke braendes af.
const RETRY_DELAYS_S = [30, 60, 120, 300, 600];
// Ingen aktivitet i saa lang tid under opstart = haenger; afbryd og proev igen.
const STALL_MS = 4 * 60 * 1000;

env.allowLocalModels = false;
env.remoteHost = 'hfmodel://models/';
// Cache API kan ikke gemme svar fra custom schemes; hovedprocessens
// disk-cache overtager cachingen.
env.useBrowserCache = false;
// ORT's WASM-filer er bundtet med appen, saa inferens virker offline.
env.backends.onnx.wasm.wasmPaths = new URL('ort/', document.baseURI).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const bridge = window.aiBridge;
const send = (msg) => bridge.send(msg);

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

// Kun q8: fp32 kan ikke allokeres i 32-bit WASM. Vision og tekst
// indlaeses uafhaengigt, saa en fejl paa den ene ikke koster en ny
// download af den anden.
async function loadVision() {
  if (visionModel) return;
  const progress_callback = progressReporter('Henter billedmodel');
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

async function loadText() {
  if (textModel) return;
  let kandidater = TXT_CANDIDATES;
  try {
    const husket = localStorage.getItem(TXT_KEY);
    if (husket && TXT_CANDIDATES.includes(husket)) {
      kandidater = [husket, ...TXT_CANDIDATES.filter((c) => c !== husket)];
    }
  } catch {
    // localStorage kan mangle
  }
  let lastErr = null;
  for (const repo of kandidater) {
    try {
      const progress_callback = progressReporter('Henter sprogmodel');
      puls();
      const tok = await medStallVagt(AutoTokenizer.from_pretrained(repo, { progress_callback }));
      puls();
      const model = await medStallVagt(
        CLIPTextModelWithProjection.from_pretrained(repo, {
          device: 'wasm', dtype: 'q8', progress_callback,
        })
      );
      tokenizer = tok;
      textModel = model;
      try {
        localStorage.setItem(TXT_KEY, repo);
      } catch {
        // kun en optimering
      }
      console.log(`Sprogmodel indlaest fra ${repo}`);
      return;
    } catch (err) {
      lastErr = err;
      console.error('Sprogmodel-kandidat fejlede', repo, err);
    }
  }
  throw lastErr;
}

async function init() {
  for (let attempt = 0; ; attempt++) {
    send({ type: 'status', state: 'model', progress: 0, detail: 'Henter billedmodel' });
    try {
      await loadVision();
      send({ type: 'status', state: 'model', progress: 50, detail: 'Henter sprogmodel' });
      await loadText();
      send({ type: 'status', state: 'model', progress: 99, detail: 'Starter modellen' });
      await medStallVagt(embedText('test'));
      send({ type: 'ready', device: 'wasm' });
      return;
    } catch (err) {
      console.error('Modelstart fejlede', err);
      const besked = err?.message || String(err);
      const tip = /unauthorized/i.test(besked)
        ? ' Tip: En gratis Hugging Face-token (Hjælp-menuen) løser download-grænsen.'
        : '';
      const delay = RETRY_DELAYS_S[Math.min(attempt, RETRY_DELAYS_S.length - 1)];
      send({
        type: 'status',
        state: 'offline',
        progress: 0,
        detail: `Kunne ikke hente modellen: ${besked} Prøver igen om ${delay} sekunder.${tip}`,
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
