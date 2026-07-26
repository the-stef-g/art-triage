// Cloud-noegleord. Appen gaetter ikke laengere selv paa hvad et billede
// forestiller; den spoerger Claude og skriver svaret ind som automatiske
// noegleord (manual=0), saa Stefs egne ord aldrig roeres.
//
// Reglen der baerer det hele: kun godkendte billeder sendes afsted.
// Kandidater, kasserede og ubedoemte forlader aldrig maskinen. En kandidat
// er ikke afgjort endnu, og der skal ikke betales for et billede der maaske
// ender som kasseret. Udvaelgelsen sker i katalogets forespoergsel, ikke her,
// saa der ikke findes en vej udenom.
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { extOf } from './util.mjs';

// Modellerne der kan vaelges i appen. Prisen er dollar pr. million tokens
// og bruges til det loebende estimat i statuslinjen, saa forbruget er til
// at se mens det sker og ikke foerst paa regningen.
export const KEYWORD_MODELS = [
  { id: 'claude-haiku-4-5', navn: 'Haiku 4.5', ind: 1, ud: 5, cache: 0.1 },
  { id: 'claude-sonnet-5', navn: 'Sonnet 5', ind: 3, ud: 15, cache: 0.3 },
  { id: 'claude-opus-5', navn: 'Opus 5', ind: 5, ud: 25, cache: 0.5 },
];

export const DEFAULT_KEYWORD_MODEL = 'claude-haiku-4-5';

export function modelInfo(id) {
  return KEYWORD_MODELS.find((m) => m.id === id) || KEYWORD_MODELS[0];
}

// Thumbnail-stoerrelsen der sendes med. 512 er samme stoerrelse som
// indekseringen allerede laver, saa filen som regel ligger i cachen i
// forvejen og et RAW-billede paa et eksternt drev ikke skal renderes igen.
export const THUMB_SIZE = 512;

// Den faste instruktion caches, saa den kun betales fuldt paa foerste
// billede. Derfor maa den ikke indeholde noget der skifter fra kald til
// kald: en dato eller et filnavn her ville aflyse cachen hver gang.
export const SYSTEM_PROMPT = [
  'You write keywords for an artist\'s own photographs and artworks so they can be found again later.',
  '',
  'Give 8 to 15 English keywords in lowercase, most important first. Cover, where they apply:',
  'the main subject, the setting, notable objects, the dominant colours, the light,',
  'the technique or medium if it is evident, and the mood.',
  '',
  'Rules:',
  '- Describe only what is actually visible. Never guess at a place, a person or a year.',
  '- Prefer the concrete over the abstract: "brick wall" beats "architecture".',
  '- Single words or short noun phrases of at most three words.',
  '- No punctuation, no camera settings, no file names, no artist names.',
  '- If the image is blurred, dark or empty, say so with the keywords you do have,',
  '  rather than inventing a subject.',
].join('\n');

// Ingen talbegraensninger i skemaet: strukturerede svar understoetter ikke
// minItems/maxItems, saa antallet staar i instruktionen og skaeres til her.
export const KEYWORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    keywords: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['keywords'],
};

const MEDIA_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function mediaTypeFor(path) {
  return MEDIA_TYPES[extOf(path)] || 'image/jpeg';
}

// Selve foresporgslen, holdt adskilt fra netvaerket saa den kan efterses i
// en test. Billedet ligger efter den faste instruktion, saa cache-praefixet
// er ens hver gang.
export function buildRequest({ model, base64, mediaType }) {
  return {
    model,
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: KEYWORD_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Keywords for this image.' },
        ],
      },
    ],
  };
}

export const MAX_KEYWORDS = 15;

// Ordene kommer i faldende relevans. Scoren foelger raekkefoelgen og
// holdes under 1000, som er manuelle ords score, saa Stefs egne ord altid
// staar foerst i inspektoeren.
export function parseKeywords(message, { max = MAX_KEYWORDS } = {}) {
  const tekst = (message?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let raa;
  try {
    raa = JSON.parse(tekst)?.keywords;
  } catch {
    return [];
  }
  if (!Array.isArray(raa)) return [];
  const set = new Set();
  const ud = [];
  for (const post of raa) {
    const ord = String(post ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!ord || set.has(ord)) continue;
    set.add(ord);
    ud.push({ word: ord, score: 900 - ud.length });
    if (ud.length >= max) break;
  }
  return ud;
}

// Dollarbeloeb for et enkelt svar. Cache-laesninger er ti gange billigere
// end almindeligt input, og det er hele pointen med den faste instruktion.
export function costOf(usage, model) {
  const p = modelInfo(model);
  const ind = (usage?.input_tokens || 0) * p.ind;
  const cacheRead = (usage?.cache_read_input_tokens || 0) * p.cache;
  const cacheWrite = (usage?.cache_creation_input_tokens || 0) * p.ind * 1.25;
  const ud = (usage?.output_tokens || 0) * p.ud;
  return (ind + cacheRead + cacheWrite + ud) / 1_000_000;
}

// Tynd indpakning om SDK'et, saa runneren nedenfor kan testes med en
// attrap i stedet for et netvaerkskald.
export class ClaudeKeywords {
  constructor({ apiKey, model = DEFAULT_KEYWORD_MODEL, client = null }) {
    this.apiKey = apiKey;
    this.model = model;
    this.client = client;
  }

  async _ensureClient() {
    if (this.client) return this.client;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    this.client = new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }

  // Returnerer { entries, usage, cost } for én billedfil.
  async analyse(thumbPath) {
    const client = await this._ensureClient();
    const base64 = readFileSync(thumbPath).toString('base64');
    const svar = await client.messages.create(
      buildRequest({ model: this.model, base64, mediaType: mediaTypeFor(thumbPath) })
    );
    return {
      entries: parseKeywords(svar),
      usage: svar.usage || {},
      cost: costOf(svar.usage, this.model),
    };
  }
}

// Fejl der ikke bliver bedre af at proeve igen. Ved dem stopper koeren og
// beskeden gaar til brugeren i stedet for at 1200 billeder fejler i traek.
function fatalFejl(err) {
  const status = err?.status;
  if (status === 401 || status === 403) return 'The API key was rejected. Check it under Help.';
  if (status === 400) return `Claude refused the request: ${err?.message || 'bad request'}`;
  if (status === 402) return 'The Anthropic account is out of credit. Top it up in the console.';
  return null;
}

// Koeren. Tager et billede ad gangen: nettet er flaskehalsen, ikke
// maskinen, og en enkel raekkefoelge er til at afbryde og til at forstaa
// naar noget gaar galt.
export class KeywordRunner extends EventEmitter {
  constructor({ catalog, thumbs, service }) {
    super();
    this.catalog = catalog;
    this.thumbs = thumbs;
    this.service = service;
    this.running = false;
    this.stopped = false;
    this.progress = this._tomFremdrift();
  }

  _tomFremdrift() {
    return { phase: 'venter', done: 0, total: 0, cost: 0, fejl: null };
  }

  setProgress(patch) {
    this.progress = { ...this.progress, ...patch };
    this.emit('progress', this.progress);
  }

  stop() {
    this.stopped = true;
  }

  start() {
    if (this.running) return this.progress;
    this.stopped = false;
    this.running = true;
    this.setProgress({ ...this._tomFremdrift(), phase: 'koerer' });
    this._loop()
      .catch((err) => this.setProgress({ phase: 'fejl', fejl: err?.message || String(err) }))
      .finally(() => {
        this.running = false;
      });
    return this.progress;
  }

  async _loop() {
    const koe = this.catalog.filesNeedingKeywords();
    if (!koe.length) {
      this.setProgress({ phase: 'faerdig', done: 0, total: 0 });
      return;
    }
    this.setProgress({ total: koe.length });
    for (const file of koe) {
      if (this.stopped) {
        this.setProgress({ phase: 'stoppet' });
        return;
      }
      const fortsaet = await this._analyseFile(file);
      if (!fortsaet) return;
      this.setProgress({ done: this.progress.done + 1 });
    }
    this.setProgress({ phase: 'faerdig' });
  }

  // Returnerer false hvis hele koeren skal stoppe.
  async _analyseFile(file) {
    const absPath = this.catalog.abs(file.rel_path);
    const thumbPath = await this.thumbs.ensure(file.id, file.mtime, absPath, THUMB_SIZE);
    if (!thumbPath) {
      // Ingen preview kan laves (drevet er vaek, eller formatet kan ikke
      // vises her). Filen markeres som koert med nul ord, saa koeren ikke
      // sidder fast paa den samme fil for evigt.
      this.catalog.markKeywordRun(file.id, this.service.model, 0);
      return true;
    }
    let res;
    try {
      res = await this.service.analyse(thumbPath);
    } catch (err) {
      const besked = fatalFejl(err);
      if (besked) {
        this.setProgress({ phase: 'fejl', fejl: besked });
        return false;
      }
      // Midlertidigt (netvaerk, rate limit efter SDK'ets egne forsoeg).
      // Filen markeres ikke, saa den kommer med naeste gang der koeres.
      this.setProgress({ phase: 'fejl', fejl: err?.message || 'The connection to Claude failed' });
      return false;
    }
    if (res.entries.length) this.catalog.saveKeywords(file.id, res.entries);
    this.catalog.markKeywordRun(file.id, this.service.model, res.entries.length);
    this.setProgress({ cost: this.progress.cost + res.cost });
    return true;
  }
}
