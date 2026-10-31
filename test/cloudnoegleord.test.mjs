// Cloud-noegleord: punkt 3 i docs/plan-cloud-noegleord.md.
//
// Den vigtigste regel er hvem der bliver sendt afsted. Kun godkendte
// billeder maa forlade maskinen. En kandidat er ikke afgjort endnu, og
// der skal ikke betales for et billede der maaske ender som kasseret.
// Testene her holder oeje med netop den graense, og med at et billede
// ikke bliver betalt for to gange.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import {
  buildRequest, parseKeywords, costOf, mediaTypeFor, KeywordRunner, vocabularyBlock,
  SYSTEM_PROMPT, KEYWORD_MODELS, DEFAULT_KEYWORD_MODEL, MAX_KEYWORDS,
} from '../electron/lib/keywords.mjs';

let root;
let db;
let catalog;

function skriv(rel) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, rel);
}

function versionFor(relPath) {
  return catalog.listVersions({ visKasserede: true }).find((r) => r.rel_path === relPath);
}

function bedoem(relPath, rating) {
  catalog.setRating([versionFor(relPath).version_id], rating);
}

function svar(ord, usage = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ keywords: ord }) }],
    usage: { input_tokens: 0, output_tokens: 0, ...usage },
  };
}

// Attrap for Claude: tæller kaldene og svarer med faste ord, saa koeren
// kan testes uden netvaerk og uden at der bliver brugt penge.
function attrap(opts = {}) {
  return {
    model: opts.model || DEFAULT_KEYWORD_MODEL,
    kald: [],
    vocabulary: null,
    setVocabulary(words) { this.vocabulary = words; },
    async analyse(thumbPath) {
      this.kald.push(thumbPath);
      if (opts.kaster) throw opts.kaster;
      return { entries: parseKeywords(svar(opts.ord || ['flower', 'meadow'])), usage: {}, cost: 0.0001 };
    },
  };
}

// Thumbnailer-attrap: giver en sti uden at rendere noget.
const thumbs = {
  async ensure(fileId) {
    return `/tmp/attrap-${fileId}.jpg`;
  },
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'art-triage-kw-'));
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
  skriv('godkendt.png');
  skriv('kandidat.png');
  skriv('kasseret.png');
  skriv('ubedomt.png');
  catalog.sync();
  bedoem('godkendt.png', 'godkendt');
  bedoem('kandidat.png', 'kandidat');
  bedoem('kasseret.png', 'kasseret');
});

afterEach(() => {
  try { db.close(); } catch { /* allerede lukket */ }
  rmSync(root, { recursive: true, force: true });
});


// Venter til koeren er faerdig, i stedet for en fast pause: sharp (til
// retningen) indlaeses foerste gang undervejs og tager sin tid.
async function faerdig(runner) {
  for (let i = 0; i < 300 && runner.running; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('koeen rummer kun godkendte', () => {
  it('tager kun det godkendte billede med', () => {
    const koe = catalog.filesNeedingKeywords();
    expect(koe.map((f) => f.rel_path)).toEqual(['godkendt.png']);
  });

  it('taeller det samme som koeen indeholder', () => {
    expect(catalog.keywordQueueSize()).toBe(1);
  });

  it('lukker en kandidat ind foerst naar den bliver godkendt', () => {
    expect(catalog.keywordQueueSize()).toBe(1);
    bedoem('kandidat.png', 'godkendt');
    expect(catalog.filesNeedingKeywords().map((f) => f.rel_path).sort())
      .toEqual(['godkendt.png', 'kandidat.png']);
  });

  it('holder en kandidat ude selv efter den er redigeret', () => {
    catalog.setStage([versionFor('kandidat.png').version_id], 'edited');
    expect(catalog.filesNeedingKeywords().map((f) => f.rel_path)).toEqual(['godkendt.png']);
  });

  it('slipper et billede ud af koeen naar det er koert', () => {
    const [fil] = catalog.filesNeedingKeywords();
    catalog.markKeywordRun(fil.id, 'claude-haiku-4-5', 9);
    expect(catalog.keywordQueueSize()).toBe(0);
  });

  it('holder et billede ude selv naar det ikke gav nogen ord', () => {
    // Uden kvitteringen kunne en fil uden ord ikke skelnes fra en der
    // aldrig er sendt, og den ville blive betalt for igen hver gang.
    const [fil] = catalog.filesNeedingKeywords();
    catalog.markKeywordRun(fil.id, 'claude-haiku-4-5', 0);
    expect(catalog.keywordQueueSize()).toBe(0);
  });

  it('lader alt godkendt komme med igen efter en nulstilling', () => {
    const [fil] = catalog.filesNeedingKeywords();
    catalog.markKeywordRun(fil.id, 'claude-haiku-4-5', 9);
    expect(catalog.clearKeywordRuns()).toBe(1);
    expect(catalog.keywordQueueSize()).toBe(1);
  });
});

describe('foresporgslen', () => {
  it('laegger billedet efter den faste instruktion', () => {
    const req = buildRequest({ model: 'claude-haiku-4-5', base64: 'AAA', mediaType: 'image/jpeg' });
    expect(req.system[0].text).toBe(SYSTEM_PROMPT);
    expect(req.messages[0].content[0].type).toBe('image');
    expect(req.messages[0].content[0].source.data).toBe('AAA');
  });

  it('cacher instruktionen', () => {
    // Uden cache betales den faste instruktion fuldt paa hvert eneste
    // billede i stedet for kun paa det foerste.
    const req = buildRequest({ model: 'claude-haiku-4-5', base64: 'AAA', mediaType: 'image/jpeg' });
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('er ens fra kald til kald', () => {
    // Cachen er et praefiks-match: en dato eller et filnavn i
    // instruktionen ville aflyse den ved hvert billede.
    const a = buildRequest({ model: 'claude-haiku-4-5', base64: 'A', mediaType: 'image/jpeg' });
    const b = buildRequest({ model: 'claude-haiku-4-5', base64: 'B', mediaType: 'image/png' });
    expect(a.system).toEqual(b.system);
  });

  it('sender katalogets egne ord med', () => {
    const req = buildRequest({
      model: 'claude-haiku-4-5', base64: 'A', mediaType: 'image/jpeg',
      vocabulary: ['wall', 'brick', 'blue'],
    });
    expect(req.system).toHaveLength(2);
    expect(req.system[1].text).toContain('wall, brick, blue');
    // Ordlisten skal ligge inde i cachen, ellers betales den paa hvert
    // eneste billede i stedet for kun paa det foerste.
    expect(req.system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.system[0].cache_control).toBeUndefined();
  });

  it('er stadig ens fra kald til kald med ordliste', () => {
    const ordliste = ['wall', 'brick'];
    const a = buildRequest({ model: 'claude-haiku-4-5', base64: 'A', mediaType: 'image/jpeg', vocabulary: ordliste });
    const b = buildRequest({ model: 'claude-haiku-4-5', base64: 'B', mediaType: 'image/png', vocabulary: ordliste });
    expect(a.system).toEqual(b.system);
  });

  it('springer ordlisten over naar kataloget er tomt', () => {
    const req = buildRequest({ model: 'claude-haiku-4-5', base64: 'A', mediaType: 'image/jpeg', vocabulary: [] });
    expect(req.system).toHaveLength(1);
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(vocabularyBlock([])).toBe(null);
  });

  it('beder om et struktureret svar', () => {
    const req = buildRequest({ model: 'claude-haiku-4-5', base64: 'A', mediaType: 'image/jpeg' });
    expect(req.output_config.format.type).toBe('json_schema');
  });

  it('kender medietypen paa de thumbnails der laves', () => {
    expect(mediaTypeFor('/x/y.jpg')).toBe('image/jpeg');
    expect(mediaTypeFor('/x/y.png')).toBe('image/png');
  });
});

describe('svaret', () => {
  it('laeser ordene ud i raekkefoelge', () => {
    const ord = parseKeywords(svar(['harbour', 'boat', 'blue']));
    expect(ord.map((k) => k.word)).toEqual(['harbour', 'boat', 'blue']);
    expect(ord[0].score).toBeGreaterThan(ord[1].score);
  });

  it('deler et flerordssvar op i enkeltord', () => {
    // Instruktionen beder om enkeltord, men beder er ikke det samme som
    // faar. Uden opdelingen ender kataloget med blue paint, white paint,
    // black paint, hvor hvert ord kun peger paa nogle faa billeder.
    const ord = parseKeywords(svar(['blue paint', 'brick wall']));
    expect(ord.map((k) => k.word)).toEqual(['blue', 'paint', 'brick', 'wall']);
  });

  it('smider smaaord vaek naar et svar deles op', () => {
    const ord = parseKeywords(svar(['wall of brick', 'a door']));
    expect(ord.map((k) => k.word)).toEqual(['wall', 'brick', 'door']);
  });

  it('genbruger det samme ord fra to forskellige svar', () => {
    const ord = parseKeywords(svar(['brick wall', 'brick']));
    expect(ord.map((k) => k.word)).toEqual(['brick', 'wall']);
  });

  it('holder sig under manuelle ords score', () => {
    // Inspektoeren sorterer manuelt foerst, saa Stefs egne ord skal blive
    // staaende oeverst uanset hvad Claude sender.
    const ord = parseKeywords(svar(['harbour']));
    expect(ord[0].score).toBeLessThan(1000);
  });

  it('normaliserer og fjerner dubletter', () => {
    const ord = parseKeywords(svar(['  Harbour ', 'HARBOUR', 'blue   boat']));
    expect(ord.map((k) => k.word)).toEqual(['harbour', 'blue', 'boat']);
  });

  it('skaerer ved det aftalte maksimum', () => {
    const mange = Array.from({ length: 40 }, (_, i) => `ord${i}`);
    expect(parseKeywords(svar(mange))).toHaveLength(MAX_KEYWORDS);
  });

  it('holder maksimum ogsaa naar svaret bliver delt op', () => {
    const mange = Array.from({ length: 20 }, (_, i) => `ord${i} andet${i}`);
    expect(parseKeywords(svar(mange))).toHaveLength(MAX_KEYWORDS);
  });

  it('giver ingen ord tilbage naar svaret ikke er gyldigt', () => {
    expect(parseKeywords({ content: [{ type: 'text', text: 'ikke json' }] })).toEqual([]);
    expect(parseKeywords({ content: [] })).toEqual([]);
    expect(parseKeywords(null)).toEqual([]);
  });
});

describe('prisen', () => {
  it('regner cache-laesninger billigere end nyt input', () => {
    const model = 'claude-haiku-4-5';
    const nyt = costOf({ input_tokens: 1000 }, model);
    const cachet = costOf({ cache_read_input_tokens: 1000 }, model);
    expect(cachet).toBeLessThan(nyt);
  });

  it('kender alle modeller der kan vaelges', () => {
    for (const m of KEYWORD_MODELS) {
      expect(costOf({ input_tokens: 1_000_000 }, m.id)).toBeCloseTo(m.ind, 5);
    }
  });
});

describe('koeren', () => {
  it('sender kun det godkendte billede', async () => {
    const service = attrap();
    const runner = new KeywordRunner({ catalog, thumbs, service });
    runner.start();
    await faerdig(runner);
    expect(service.kald).toHaveLength(1);
    expect(runner.progress.phase).toBe('faerdig');
  });

  it('giver koeren katalogets egne ord med', async () => {
    // Uden det bliver det wall paa ét billede og walls paa det naeste, og
    // saa samler et klik paa ordet dem ikke laengere.
    const fil = versionFor('godkendt.png');
    catalog.addKeyword(fil.file_id, 'brick');
    const service = attrap();
    const runner = new KeywordRunner({ catalog, thumbs, service });
    runner.start();
    await faerdig(runner);
    expect(service.vocabulary).toContain('brick');
  });

  it('skriver ordene ind som automatiske', async () => {
    const service = attrap({ ord: ['flower', 'meadow'] });
    const runner = new KeywordRunner({ catalog, thumbs, service });
    runner.start();
    await faerdig(runner);
    const fil = versionFor('godkendt.png');
    const ord = catalog.keywordsForFile(fil.file_id);
    expect(ord.map((k) => k.word)).toEqual(['flower', 'meadow']);
    expect(ord.every((k) => k.manual === 0)).toBe(true);
  });

  it('lader Stefs egne ord staa', async () => {
    const fil = versionFor('godkendt.png');
    catalog.addKeyword(fil.file_id, 'mit eget ord');
    const runner = new KeywordRunner({ catalog, thumbs, service: attrap({ ord: ['meadow'] }) });
    runner.start();
    await faerdig(runner);
    const ord = catalog.keywordsForFile(fil.file_id);
    expect(ord.find((k) => k.word === 'mit eget ord').manual).toBe(1);
    expect(ord.map((k) => k.word)).toContain('meadow');
  });

  it('sender ikke det samme billede to gange', async () => {
    const service = attrap();
    const runner = new KeywordRunner({ catalog, thumbs, service });
    runner.start();
    await faerdig(runner);
    runner.start();
    await faerdig(runner);
    expect(service.kald).toHaveLength(1);
  });

  it('stopper koeren ved en afvist noegle', async () => {
    const service = attrap({ kaster: Object.assign(new Error('nej'), { status: 401 }) });
    const runner = new KeywordRunner({ catalog, thumbs, service });
    runner.start();
    await faerdig(runner);
    expect(runner.progress.phase).toBe('fejl');
    expect(runner.progress.fejl).toMatch(/API key was rejected/);
    // Ingen kvittering: billedet skal med naeste gang der koeres.
    expect(catalog.keywordQueueSize()).toBe(1);
  });

  it('kvitterer for et billede der ikke kan previewes', async () => {
    // Uden kvittering ville koeren sidde fast paa den samme fil for evigt.
    const service = attrap();
    const ingenThumb = { async ensure() { return null; } };
    const runner = new KeywordRunner({ catalog, thumbs: ingenThumb, service });
    runner.start();
    await faerdig(runner);
    expect(service.kald).toHaveLength(0);
    expect(catalog.keywordQueueSize()).toBe(0);
  });

  it('kan afbrydes undervejs', async () => {
    bedoem('kandidat.png', 'godkendt');
    bedoem('ubedomt.png', 'godkendt');
    const service = attrap();
    const runner = new KeywordRunner({ catalog, thumbs, service });
    runner.on('progress', (p) => { if (p.done === 1) runner.stop(); });
    runner.start();
    await new Promise((r) => setTimeout(r, 60));
    expect(runner.progress.phase).toBe('stoppet');
    expect(service.kald.length).toBeLessThan(3);
  });
});

describe('soegeord til kunderne', () => {
  it('beder om motiv, aarstid og farver, ikke detaljer, og aldrig retningen', () => {
    expect(SYSTEM_PROMPT).toMatch(/customer/);
    expect(SYSTEM_PROMPT).toMatch(/spring, summer, autumn or winter/);
    expect(SYSTEM_PROMPT).toMatch(/not roof, chimney/);
    expect(SYSTEM_PROMPT).toMatch(/Never horizontal, vertical, square/);
  });

  it('tager retningsord ud af svaret; kunden filtrerer paa Format', () => {
    const svar = { content: [{ type: 'text', text: JSON.stringify({ keywords: ['beach', 'vertical', 'blue'] }) }] };
    expect(parseKeywords(svar).map((k) => k.word)).toEqual(['beach', 'blue']);
  });

  it('koeren laegger ingen retning paa ordene', async () => {
    const sharp = (await import('sharp')).default;
    const thumb = join(root, 'thumb.png');
    await sharp({ create: { width: 60, height: 40, channels: 3, background: '#00f' } }).png().toFile(thumb);
    const service = attrap({ ord: ['beach'] });
    const runner = new KeywordRunner({ catalog, thumbs: { async ensure() { return thumb; } }, service });
    runner.start();
    await faerdig(runner);
    const fil = versionFor('godkendt.png');
    expect(catalog.keywordsForFile(fil.file_id).map((k) => k.word)).toEqual(['beach']);
  });

  it('de automatiske retningsord fjernes, naar kataloget aabnes; Stefs egne bliver', () => {
    const fil = versionFor('godkendt.png');
    catalog.saveKeywords(fil.file_id, [{ word: 'square', score: 100 }, { word: 'desert', score: 90 }]);
    catalog.db.run("INSERT OR REPLACE INTO keywords(file_id, word, score, manual) VALUES(?, 'vertical', 100, 1)", fil.file_id);
    catalog._migrate();
    expect(catalog.keywordsForFile(fil.file_id).map((k) => k.word).sort()).toEqual(['desert', 'vertical']);
  });
});
