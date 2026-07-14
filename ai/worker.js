// AI-arbejderen: koerer i et skjult vindue og laver CLIP-embeddings af
// billeder (via thumb://-previews) og dansk soegetekst. Modellerne hentes
// fra Hugging Face foerste gang og caches lokalt af browserens Cache API.
// WebGPU bruges hvis muligt, ellers multitraadet WASM.
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

env.allowLocalModels = false;
// ORT's WASM-filer er bundtet med appen, saa inferens virker offline.
env.backends.onnx.wasm.wasmPaths = new URL('ort/', document.baseURI).href;

const bridge = window.aiBridge;
const send = (msg) => bridge.send(msg);

let processor = null;
let visionModel = null;
let tokenizer = null;
let textModel = null;

async function pickDevice() {
  try {
    if (navigator.gpu && (await navigator.gpu.requestAdapter())) return 'webgpu';
  } catch {
    // WebGPU utilgaengelig
  }
  return 'wasm';
}

function progressReporter() {
  const files = new Map();
  return (p) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    const pct = total ? Math.round((loaded / total) * 100) : 0;
    send({ type: 'status', state: 'model', progress: pct, detail: p.file });
  };
}

async function loadModels(device) {
  const progress_callback = progressReporter();
  const dtypes = device === 'webgpu' ? ['fp32', 'q8'] : ['q8', 'fp32'];
  let lastErr = null;
  for (const dtype of dtypes) {
    try {
      processor = await AutoProcessor.from_pretrained(IMG_MODEL, { progress_callback });
      visionModel = await CLIPVisionModelWithProjection.from_pretrained(IMG_MODEL, {
        device, dtype, progress_callback,
      });
      tokenizer = await AutoTokenizer.from_pretrained(TXT_MODEL, { progress_callback });
      textModel = await CLIPTextModelWithProjection.from_pretrained(TXT_MODEL, {
        device, dtype, progress_callback,
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function init() {
  for (;;) {
    let device = await pickDevice();
    send({ type: 'status', state: 'model', progress: 0, detail: 'Henter AI-model' });
    try {
      await loadModels(device);
      send({ type: 'ready', device });
      return;
    } catch (err) {
      if (device === 'webgpu') {
        // Proev WASM foer vi giver op.
        try {
          device = 'wasm';
          await loadModels(device);
          send({ type: 'ready', device });
          return;
        } catch (err2) {
          err = err2;
        }
      }
      send({
        type: 'status',
        state: 'offline',
        progress: 0,
        detail: `Kunne ikke hente modellen (${err?.message || 'ukendt fejl'}). Prøver igen om 30 sekunder.`,
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
