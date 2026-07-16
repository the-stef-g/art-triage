// AI-arbejderen: koerer i et skjult vindue og laver CLIP-embeddings af
// billeder (via thumb://-previews) og dansk soegetekst. Modellerne hentes
// fra Hugging Face foerste gang og caches lokalt af browserens Cache API.
// Inferens koerer paa WASM (CPU): forudsigeligt og hurtigt nok, og WebGPU
// har vist sig at kunne haenge paa Intel-Mac'ens GPU.
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
// Ingen aktivitet i saa lang tid under opstart = haenger; afbryd og proev igen.
const STALL_MS = 4 * 60 * 1000;

env.allowLocalModels = false;
// ORT's WASM-filer er bundtet med appen, saa inferens virker offline.
env.backends.onnx.wasm.wasmPaths = new URL('ort/', document.baseURI).href;
// En traad: ort-webs worker-opstart kan gaa i baglaas under appens egen
// app://-protokol i den pakkede app. Enkelttraadet er langsommere, men
// starter altid.
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

// Afviser hvis loadet gaar i staa (ingen progress-aktivitet i STALL_MS).
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

async function loadModels() {
  const dtypes = ['q8', 'fp32'];
  let lastErr = null;
  for (const dtype of dtypes) {
    try {
      puls();
      send({ type: 'status', state: 'model', progress: 0, detail: 'Henter billedmodel' });
      processor = await medStallVagt(
        AutoProcessor.from_pretrained(IMG_MODEL, { progress_callback: progressReporter('Henter billedmodel') })
      );
      puls();
      visionModel = await medStallVagt(
        CLIPVisionModelWithProjection.from_pretrained(IMG_MODEL, {
          device: 'wasm', dtype, progress_callback: progressReporter('Henter billedmodel'),
        })
      );
      puls();
      send({ type: 'status', state: 'model', progress: 50, detail: 'Henter sprogmodel' });
      tokenizer = await medStallVagt(
        AutoTokenizer.from_pretrained(TXT_MODEL, { progress_callback: progressReporter('Henter sprogmodel') })
      );
      puls();
      textModel = await medStallVagt(
        CLIPTextModelWithProjection.from_pretrained(TXT_MODEL, {
          device: 'wasm', dtype, progress_callback: progressReporter('Henter sprogmodel'),
        })
      );
      puls();
      send({ type: 'status', state: 'model', progress: 99, detail: 'Starter modellen' });
      // Lille proevekoersel saa "klar" betyder klar.
      await medStallVagt(embedText('test'));
      return;
    } catch (err) {
      lastErr = err;
      console.error('Modelstart fejlede', dtype, err);
    }
  }
  throw lastErr;
}

async function init() {
  for (;;) {
    try {
      await loadModels();
      send({ type: 'ready', device: 'wasm' });
      return;
    } catch (err) {
      send({
        type: 'status',
        state: 'offline',
        progress: 0,
        detail: `Kunne ikke starte modellen (${err?.message || 'ukendt fejl'}). Prøver igen om 30 sekunder.`,
      });
      await new Promise((r) => setTimeout(r, 30000));
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
