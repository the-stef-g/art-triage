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
//
// Instruktionen er skaerpet efter foerste runde paa Stefs billeder. En
// haerget murvaeg gav weathered wood, peeling paint, brown wood, rust
// stains, decay, patina, aged texture, distressed surface, worn finish og
// horizontal layers: flere af dem forkerte, resten det samme ord sagt paa
// fem maader, og hverken wall eller brick var med. Derfor: faa ord, kun
// enkeltord, motivet og materialet foerst, farve altid med, og ingen
// stemning.
export const SYSTEM_PROMPT = [
  'You write search keywords for an artist\'s own photographs so they can be found again later.',
  'These are working keywords for a catalogue, not a description of the picture.',
  '',
  'Give 5 to 8 keywords, in this order of priority:',
  '1. What the thing IS. The plainest noun for the main subject: wall, door, tree, hand, boat.',
  '2. What it is MADE OF, if you can see it beyond doubt: brick, concrete, wood, metal, glass, paper.',
  '3. The DOMINANT COLOURS. Always give at least one, at most two.',
  '4. The setting or a second clear object, only if it really is there.',
  '',
  'Hard rules:',
  '- Single words only. Never two words. "blue paint" is wrong; give "blue" and "paint".',
  '  "brick wall" is wrong; give "brick" and "wall". Single words can be reused across',
  '  thousands of images; phrases cannot, and the catalogue fills up with near-duplicates.',
  '- Lowercase. Nouns in the singular, except where the plural is the normal word (bricks, leaves).',
  '- No two words that mean the same thing. Pick one and drop the rest. decay, patina,',
  '  weathered, aged, distressed and worn are all the same word for this purpose.',
  '- No mood, no atmosphere, no light quality, no composition, no aesthetics. Leave out',
  '  dramatic, moody, stormy, serene, textured, minimal, layered, abstract and their kind.',
  '  Nobody searches for those.',
  '- Say nothing you are not sure of. A wrong material is worse than a missing one. If you',
  '  cannot tell wood from stone, leave the material out and keep the subject and colour.',
  '- Never guess a place, a person, a date or a technique.',
  '',
  'Fewer, right words beat more, nearly-right ones. Six good keywords is a good answer.',
].join('\n');

// Katalogets egne ord sendes med, saa den samme ting faar det samme ord
// hver gang. Uden det bliver det wall paa ét billede og walls paa det
// naeste, og saa samler et klik dem ikke laengere.
export function vocabularyBlock(words) {
  if (!words || !words.length) return null;
  return [
    'These keywords are already in this catalogue:',
    words.join(', '),
    '',
    'Use one of these whenever it fits the image, exactly as spelled here, instead of a',
    'new word for the same thing. Only invent a new word when nothing above fits.',
  ].join('\n');
}

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
// Ordlisten ligger i sin egen cache-blok efter instruktionen. Den holdes
// fast gennem en hel koersel, saa praefikset er ens fra billede til
// billede og cachen holder; foerst naeste koersel henter en frisk liste.
export function buildRequest({ model, base64, mediaType, vocabulary = null }) {
  const system = [{ type: 'text', text: SYSTEM_PROMPT }];
  const ordblok = vocabularyBlock(vocabulary);
  if (ordblok) system.push({ type: 'text', text: ordblok });
  system[system.length - 1].cache_control = { type: 'ephemeral' };
  return {
    model,
    max_tokens: 512,
    system,
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

export const MAX_KEYWORDS = 8;

// Ord der ikke er vaerd at soege paa, og som kun dukker op fordi et
// flerordssvar blev delt op.
const STOPORD = new Set([
  'a', 'an', 'and', 'of', 'the', 'with', 'in', 'on', 'at', 'to', 'or', 'is',
  'very', 'some', 'this', 'that', 'it', 'its',
]);

// Instruktionen beder om enkeltord, men beder er ikke det samme som
// faar. Kommer der alligevel "blue paint", deles det, saa baade blue og
// paint kan genbruges paa andre billeder. Uden det her ender kataloget
// med white paint, black paint, blue paint og saa videre, hvor hvert ord
// kun peger paa nogle faa billeder.
function splitOrd(raat) {
  return String(raat ?? '')
    .toLowerCase()
    .replace(/[^a-zæøå0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((o) => o.trim())
    .filter((o) => o.length > 1 && !STOPORD.has(o));
}

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
    for (const ord of splitOrd(post)) {
      if (set.has(ord)) continue;
      set.add(ord);
      ud.push({ word: ord, score: 900 - ud.length });
      if (ud.length >= max) return ud;
    }
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
    this.vocabulary = null;
  }

  // Saettes én gang pr. koersel. Skiftede listen undervejs, ville
  // cache-praefikset skifte med, og hvert billede ville koste fuld pris.
  setVocabulary(words) {
    this.vocabulary = words && words.length ? words : null;
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
      buildRequest({
        model: this.model,
        base64,
        mediaType: mediaTypeFor(thumbPath),
        vocabulary: this.vocabulary,
      })
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
    // Katalogets egne ord hentes én gang og staar fast koerslen igennem,
    // saa den samme ting faar det samme ord og cachen holder.
    this.service.setVocabulary?.(this.catalog.keywordVocabulary());
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
