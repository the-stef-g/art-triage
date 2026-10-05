// Tekster fra Claude (docs/plan-shop.md). Reglerne skal staa i
// instruktionen, det der skifter fra vaerk til vaerk maa ikke staa i den
// (det ville aflyse cachen), og et svar der bryder en regel skal ikke
// gaa uset hen.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TEXT_SYSTEM_PROMPT, buildTextRequest, workBrief, parseTexts, cleanText, lintTexts,
  ClaudeWorkTexts, TEXT_IMAGE_SIZE,
} from '../electron/lib/workTexts.mjs';

const work = {
  effective: { title: 'Desert Canyon 04' },
  category: 'Photography',
  technique: 'Digital art',
  seriesName: 'Desert Canyon',
  notes: 'Shot at dawn, the canyon still cold',
};

function svar(obj, usage = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj) }],
    usage: { input_tokens: 1000, output_tokens: 200, ...usage },
  };
}

const gode = {
  description: Array.from({ length: 100 }, (_, i) => `word${i}`).join(' '),
  short_text: 'A canyon at first light.',
  alt_text: 'A red canyon wall under a pale sky.',
};

describe('instruktionen', () => {
  it('har reglerne fra planen', () => {
    for (const regel of [
      '80 to 150 words', 'never with "This', 'one sentence', '150 characters',
      'stunning', 'one-of-a-kind', 'perfect', 'em-dash', 'AI', 'Photoshop',
      'Describe only what can be seen', 'rust', 'never translated', 'British English',
    ]) {
      expect(TEXT_SYSTEM_PROMPT).toContain(regel);
    }
  });

  it('indeholder intet der skifter fra vaerk til vaerk', () => {
    const req = buildTextRequest({ model: 'm', base64: 'x', mediaType: 'image/jpeg', work });
    const system = req.system.map((b) => b.text).join('');
    expect(system).not.toContain('Desert Canyon');
    expect(system).not.toContain('dawn');
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('beskeden om vaerket', () => {
  it('sender titel, kategori, teknik, serie og noter', () => {
    const brief = workBrief(work);
    expect(brief).toContain('Title: Desert Canyon 04');
    expect(brief).toContain('Category: Photography');
    expect(brief).toContain('Technique: Digital art');
    expect(brief).toContain('Series: Desert Canyon');
    expect(brief).toContain('Shot at dawn');
  });

  it('udelader tomme felter helt', () => {
    const brief = workBrief({ effective: { title: 'X' }, category: null, technique: null, seriesName: null, notes: null });
    expect(brief).toBe('Title: X\n\nWrite the three texts for this work.');
  });

  it('lægger billedet foer teksten og beder om et skema', () => {
    const req = buildTextRequest({ model: 'm', base64: 'abc', mediaType: 'image/jpeg', work });
    expect(req.messages[0].content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(req.output_config.format.type).toBe('json_schema');
    expect(TEXT_IMAGE_SIZE).toBe(1024);
  });
});

describe('svaret', () => {
  it('tager alle tre tekster', () => {
    expect(parseTexts(svar(gode))).toEqual(gode);
  });

  it('afviser et svar der mangler en tekst eller er tomt', () => {
    expect(parseTexts(svar({ description: 'a', short_text: 'b' }))).toBeNull();
    expect(parseTexts(svar({ ...gode, alt_text: '  ' }))).toBeNull();
    expect(parseTexts({ content: [{ type: 'text', text: 'ikke json' }] })).toBeNull();
  });

  it('fjerner tankestreger', () => {
    expect(cleanText('Light — and stone')).toBe('Light, and stone');
    expect(cleanText('2019–2021')).toBe('2019-2021');
    expect(parseTexts(svar({ ...gode, short_text: 'Dawn — cold.' })).short_text).toBe('Dawn, cold.');
  });
});

describe('advarsler', () => {
  it('er stille naar alt overholdes', () => {
    expect(lintTexts(gode)).toEqual([]);
  });

  it('siger fra om laengde, klichéer og vaerktoejer', () => {
    const w = lintTexts({
      description: 'A stunning, unique piece made with AI.',
      short_text: 'Perfect gift.',
      alt_text: 'x'.repeat(200),
    }).join(' | ');
    expect(w).toMatch(/words; it should be 80 to 150/);
    expect(w).toMatch(/200 characters/);
    expect(w).toMatch(/"stunning"/);
    expect(w).toMatch(/"unique"/);
    expect(w).toMatch(/"AI"/);
    expect(w).toMatch(/"Perfect gift"/i);
  });
});

describe('kaldet', () => {
  it('sender en foresporgsel og regner prisen ud', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-'));
    const png = join(dir, 'a.png');
    writeFileSync(png, 'billede');
    const kald = [];
    const client = { messages: { create: async (req) => { kald.push(req); return svar(gode); } } };
    const tjeneste = new ClaudeWorkTexts({ apiKey: 'k', model: 'claude-haiku-4-5', client });
    const res = await tjeneste.write(png, work);
    rmSync(dir, { recursive: true, force: true });
    expect(kald).toHaveLength(1);
    expect(kald[0].model).toBe('claude-haiku-4-5');
    expect(res.texts).toEqual(gode);
    expect(res.cost).toBeCloseTo((1000 * 1 + 200 * 5) / 1e6, 8);
  });

  it('fejler tydeligt naar svaret er ufuldstaendigt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-'));
    const png = join(dir, 'a.png');
    writeFileSync(png, 'billede');
    const client = { messages: { create: async () => svar({ description: 'kun denne' }) } };
    const tjeneste = new ClaudeWorkTexts({ apiKey: 'k', client });
    await expect(tjeneste.write(png, work)).rejects.toThrow(/all three texts/);
    rmSync(dir, { recursive: true, force: true });
  });
});
