// Tekster til vaerket fra Claude: beskrivelse, kort tekst og alt-tekst paa
// britisk engelsk (docs/plan-shop.md). Samme noegle og model-vaelger som
// noegleordene. Stef retter teksterne i appen; Claude skriver kun udkast.
import { readFileSync } from 'node:fs';
import { costOf, mediaTypeFor, DEFAULT_KEYWORD_MODEL } from './keywords.mjs';

// Billedet sendes paa ca. 1024 px, ikke 512 som noegleordene: en
// beskrivelse af farver og komposition skal kunne se mere end en etiket.
export const TEXT_IMAGE_SIZE = 1024;

// Den faste instruktion. Reglerne staar her ordret fra planen. Ingen
// titel, serie eller noter i den: de skifter fra vaerk til vaerk og
// ville aflyse cachen, saa de sendes i brugerbeskeden.
export const TEXT_SYSTEM_PROMPT = [
  'You write the texts for one artwork in an artist\'s own webshop. The artist will read and',
  'correct your drafts, so write plainly and do not decorate. Use British English.',
  '',
  'Return three texts:',
  '',
  'DESCRIPTION: 80 to 150 words. Open with the experience of the work, never with "This',
  'artwork" or similar. Cover subject, colours and composition, and weave in the artist\'s own',
  'notes where they are given. End with one calm sentence about where the work belongs.',
  '',
  'SHORT TEXT: one sentence, for a card or for sharing.',
  '',
  'SERIES: when a series is given, always name it, exactly as given, in the DESCRIPTION and in',
  'the SHORT TEXT, for instance "part of the series" followed by its name. Never in the ALT TEXT.',
  '',
  'ALT TEXT: one sentence, at most about 150 characters. What the picture shows, not what it',
  'means.',
  '',
  'Also return SECTION COLOUR: one colour as a hex code (#rrggbb) for the background of the',
  'section the work is shown in on the website. It must make the subject stand out. Do not',
  'simply repeat the strongest colour in the picture; choose a colour that sets the subject off.',
  '',
  'Rules for all three:',
  '- No superlatives and no clichés: never "stunning", "unique", "one-of-a-kind" or "perfect',
  '  gift". No sales tricks.',
  '- No dashes of the em-dash kind. Use a comma, a full stop or "and" instead.',
  '- Never mention AI, Photoshop or any other tool. The tools are only tools.',
  '- Describe only what can be seen. Do not write "drawn", "painted" or the like about a',
  '  technique the work does not have. Choose colour words that cannot be read as materials,',
  '  so not "rust" for a desert.',
  '- Titles and series names are never translated. Use them exactly as given.',
].join('\n');

export const TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: { type: 'string' },
    short_text: { type: 'string' },
    alt_text: { type: 'string' },
    section_colour: { type: 'string' },
  },
  required: ['description', 'short_text', 'alt_text', 'section_colour'],
};

// Det der skifter fra vaerk til vaerk. Tomme felter udelades helt i stedet
// for at stå som "Technique: -", saa Claude ikke tror der staar noget.
export function workBrief(work) {
  const linjer = [
    `Title: ${work.effective.title}`,
    work.category && `Category: ${work.category}`,
    work.technique && `Technique: ${work.technique}`,
    work.seriesName && `Series: ${work.seriesName}`,
    work.notes && `The artist's own notes:\n${work.notes}`,
  ].filter(Boolean);
  return `${linjer.join('\n')}\n\nWrite the three texts for this work.`;
}

export function buildTextRequest({ model, base64, mediaType, work }) {
  return {
    model,
    max_tokens: 1024,
    system: [{ type: 'text', text: TEXT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: TEXT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: workBrief(work) },
        ],
      },
    ],
  };
}

// Tankestreger er forbudt, og et svar er ikke altid lydigt. En tankestreg
// med mellemrum omkring bliver til komma, resten til bindestreg.
export function cleanText(text) {
  return String(text ?? '')
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTexts(message) {
  const raa = (message?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let json;
  try {
    json = JSON.parse(raa);
  } catch {
    return null;
  }
  const ud = {};
  for (const field of ['description', 'short_text', 'alt_text']) {
    if (typeof json?.[field] !== 'string' || !json[field].trim()) return null;
    ud[field] = cleanText(json[field]);
  }
  // Farven er en hjaelp, ikke et krav: et svar uden en brugbar farve er
  // stadig gode tekster.
  const farve = String(json?.section_colour ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(farve)) ud.section_colour = farve.toLowerCase();
  return ud;
}

const FORBUDTE = [
  /\bstunning\b/i, /\bunique\b/i, /\bone[- ]of[- ]a[- ]kind\b/i, /\bperfect gift\b/i,
  /\bAI\b/, /\bartificial intelligence\b/i, /\bphotoshop\b/i, /\bgenerated\b/i,
];

// Advarsler til Stef, ikke afvisninger: teksten gemmes alligevel, for den
// skal kunne rettes i hånden, men en regel der er brudt skal ikke vaere
// til at overse.
export function lintTexts(texts) {
  const advarsler = [];
  const ord = (texts.description || '').split(/\s+/).filter(Boolean).length;
  if (ord && (ord < 80 || ord > 150)) {
    advarsler.push(`The description is ${ord} words; it should be 80 to 150`);
  }
  if ((texts.alt_text || '').length > 160) {
    advarsler.push(`The alt text is ${texts.alt_text.length} characters; it should be about 150 at most`);
  }
  for (const [field, text] of Object.entries(texts)) {
    if (field === 'section_colour') continue;
    for (const re of FORBUDTE) {
      const m = re.exec(text || '');
      if (m) advarsler.push(`The ${field.replace('_', ' ')} says "${m[0]}"`);
    }
  }
  return advarsler;
}

// Tynd indpakning om SDK'et, saa et kald kan testes med en attrap.
export class ClaudeWorkTexts {
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

  // Returnerer { texts, warnings, usage, cost }.
  async write(imagePath, work) {
    const client = await this._ensureClient();
    const svar = await client.messages.create(
      buildTextRequest({
        model: this.model,
        base64: readFileSync(imagePath).toString('base64'),
        mediaType: mediaTypeFor(imagePath),
        work,
      })
    );
    const texts = parseTexts(svar);
    if (!texts) throw new Error('Claude did not return all three texts. Try again.');
    return {
      texts,
      warnings: lintTexts(texts),
      usage: svar.usage || {},
      cost: costOf(svar.usage, this.model),
    };
  }
}
