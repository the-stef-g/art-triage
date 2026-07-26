// AI-arbejderen: koerer i et skjult vindue og laver embeddings af
// billeder (via thumb://-previews) og dansk soegetekst med SigLIP 2,
// Googles flersprogede billed-og-tekst-encoder (109 sprog inkl. dansk).
// Den gamle flersprogede CLIP-sprogmodel findes ikke laengere paa
// Hugging Face i ONNX-form. Alle modelfiler hentes gennem
// hovedprocessens hfmodel://-protokol (spejl-fallback, token og
// disk-cache uden CORS-bindinger). Inferens koerer enkelttraadet paa
// WASM: langsommere end traade, men starter altid.
import * as hf from '@huggingface/transformers';

const { env, AutoTokenizer, AutoProcessor, RawImage } = hf;

// CI-verificeret: dette repo findes komplet paa Hugging Face med
// praecis de filer transformers.js skal bruge. Hovedprocessens
// hfmodel-protokol omskriver "siglip2" til "siglip" i config-filerne,
// da arkitekturen er identisk med SigLIP v1, som biblioteket kender.
const MODEL_CANDIDATES = [
  'onnx-community/siglip2-base-patch16-224-ONNX',
];
const MODEL_KEY = 'billedflow-model-repo';
// Tolerant klassevalg: Siglip2-klasser hvis biblioteket har dem,
// ellers Siglip-klasserne (samme arkitekturfamilie).
const TextModelClass = hf.Siglip2TextModel || hf.SiglipTextModel;
const VisionModelClass = hf.Siglip2VisionModel || hf.SiglipVisionModel;

// Kort id der identificerer modellen i kataloget (embeddings fra
// forskellige modeller maa aldrig blandes).
function modelId(repo) {
  return repo.split('/').pop().toLowerCase().replace(/-onnx$/, '');
}
// Stigende ventetid mellem forsoeg, saa HF's anonyme kvote ikke braendes af.
const RETRY_DELAYS_S = [30, 60, 120, 300, 600];
// Ingen aktivitet i saa lang tid under opstart = haenger; afbryd og proev igen.
const STALL_MS = 4 * 60 * 1000;

env.allowLocalModels = false;
// Aegte https-adresse, som hovedprocessen opfanger og besvarer med
// download-motoren (transformers.js afviser andre schemes).
env.remoteHost = 'https://billedflow-models.local/';
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

// Faserne efter selve downloaden melder ingen fremdrift af sig selv:
// modellen skal pakkes ud i WASM og koere en foerste inferens, og paa en
// aeldre Intel-iMac tager begge dele lang tid. Uden livstegn saetter
// statuslinjen sig fast, typisk paa "Henter billedmodel 100%", og ser
// frossen ud selv om der arbejdes. Pulsen sender fasen igen med forloebet
// tid, saa der altid er bevaegelse at se paa.
let pulsTimer = null;
let faseStart = 0;
let faseTekst = '';

function saetFase(detail, progress = null) {
  faseTekst = detail;
  faseStart = Date.now();
  stopPuls();
  send({ type: 'status', state: 'model', progress, detail });
  pulsTimer = setInterval(() => {
    const sek = Math.round((Date.now() - faseStart) / 1000);
    send({ type: 'status', state: 'model', progress, detail: `${faseTekst} (${sek} s)` });
  }, 2000);
}

function stopPuls() {
  if (pulsTimer) clearInterval(pulsTimer);
  pulsTimer = null;
}

function progressReporter(hentFase, klargoerFase) {
  const files = new Map();
  let klargoer = false;
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
    if (pct >= 100) {
      // Filerne er hentet. Herfra og til modellen er klar sker der intet
      // maalbart, saa der skiftes til puls i stedet for at staa paa 100%.
      if (!klargoer) {
        klargoer = true;
        saetFase(klargoerFase);
      }
      return;
    }
    klargoer = false;
    stopPuls();
    send({ type: 'status', state: 'model', progress: pct, detail: hentFase });
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

// Kun q8: fp32 kan ikke allokeres i 32-bit WASM. Alt tildeles foerst
// naar hele parret er indlaest, saa en halv fejl ikke efterlader rod.
async function loadModels(repo) {
  const pv = progressReporter('Henter billedmodel', 'Klargør billedmodel');
  puls();
  const proc = await medStallVagt(AutoProcessor.from_pretrained(repo, { progress_callback: pv }));
  puls();
  const vis = await medStallVagt(
    VisionModelClass.from_pretrained(repo, { device: 'wasm', dtype: 'q8', progress_callback: pv })
  );
  saetFase('Henter sprogmodel', 50);
  const pt = progressReporter('Henter sprogmodel', 'Klargør sprogmodel');
  puls();
  const tok = await medStallVagt(AutoTokenizer.from_pretrained(repo, { progress_callback: pt }));
  puls();
  const txt = await medStallVagt(
    TextModelClass.from_pretrained(repo, { device: 'wasm', dtype: 'q8', progress_callback: pt })
  );
  processor = proc;
  visionModel = vis;
  tokenizer = tok;
  textModel = txt;
}

// SigLIP-familien afleverer embeddingen i pooler_output; CLIP-familien
// i text_embeds/image_embeds. Tag det der findes.
function vecFraOutput(out) {
  const t = out.text_embeds || out.image_embeds || out.pooler_output;
  if (!t) throw new Error('Modellen returnerede ingen embedding');
  return Array.from(t.data);
}

function kandidatListe() {
  try {
    const husket = localStorage.getItem(MODEL_KEY);
    if (husket && MODEL_CANDIDATES.includes(husket)) {
      return [husket, ...MODEL_CANDIDATES.filter((c) => c !== husket)];
    }
  } catch {
    // localStorage kan mangle
  }
  return MODEL_CANDIDATES;
}

async function init() {
  for (let attempt = 0; ; attempt++) {
    let lastErr = null;
    for (const repo of kandidatListe()) {
      saetFase('Henter billedmodel', 0);
      try {
        await loadModels(repo);
        // Foerste inferens varmer WASM op og er den tungeste enkeltdel paa
        // en aeldre Mac. Pulsen koerer videre her, saa linjen ikke staar
        // stille netop hvor ventetiden er laengst.
        saetFase('Starter modellen');
        await medStallVagt(embedText('test'));
        stopPuls();
        try {
          localStorage.setItem(MODEL_KEY, repo);
        } catch {
          // kun en optimering
        }
        console.log(`Model indlaest fra ${repo}`);
        send({ type: 'ready', device: 'wasm', modelId: modelId(repo) });
        return;
      } catch (err) {
        stopPuls();
        lastErr = err;
        console.error('Model-kandidat fejlede', repo, err);
      }
    }
    const besked = lastErr?.message || String(lastErr);
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

async function embedText(text) {
  // SigLIP er traenet med max_length-padding til 64 tokens.
  const inputs = tokenizer([text], { padding: 'max_length', truncation: true, max_length: 64 });
  const out = await textModel(inputs);
  return vecFraOutput(out);
}

async function embedImage(url) {
  const image = await RawImage.read(url);
  const inputs = await processor(image);
  const out = await visionModel(inputs);
  return vecFraOutput(out);
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
