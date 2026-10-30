// Send til shop (docs/plan-shop.md): opretter og opdaterer produktet i
// WooCommerce paa shop.stefg.art. Teksterne rettes kun i Stef G Art; Woo er
// en kopi, og det der staar der bliver overskrevet naar vaerket sendes.
//
// To noegler, begge gemt som Claude-noeglen: aldrig vist igen, aldrig i
// loggen, aldrig sendt til brugerfladen. Fejlbeskeder herfra indeholder
// aldrig en noegle; de siger hvad der skete, ikke hvad der blev sendt.
import { readFileSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extOf, RASTER_EXTS } from './util.mjs';
import { CROP_FORMATS } from './works.mjs';
import { PRISLISTE, printVarianter, variantAttributter } from './prisliste.mjs';
import { betingelser, privatlivspolitik, KASSE_TEKST, MAIL_TEKST, TEKST_DATO } from './shoptekster.mjs';

const run = promisify(execFile);

export const DEFAULT_SHOP_URL = 'https://shop.stefg.art';
export const SHOP_IMAGE_SIZE = 3000;
export const SHOP_JPEG_QUALITY = 92;
// Det produkt ACPT-formatet er hentet fra (Desert Canyon 04). Se
// docs/reference-product-20.json.
export const REFERENCE_PRODUCT_ID = 20;
// Hoejst saa mange soegeord sendes som tags til et produkt.
export const MAX_TAGS = 12;

// ---------- Noegler ----------

// WooCommerce giver to dele, consumer key og consumer secret. De indtastes
// i ét felt, adskilt af mellemrum, komma eller kolon.
export function parseWooKey(text) {
  const dele = String(text || '').trim().split(/[\s,:;]+/).filter(Boolean);
  if (dele.length !== 2 || !dele[0].startsWith('ck_') || !dele[1].startsWith('cs_')) {
    throw new Error('Enter the consumer key (ck_…) and the consumer secret (cs_…), separated by a space');
  }
  return { key: dele[0], secret: dele[1] };
}

// WordPress' application password: brugernavn og kode. Koden staar med
// mellemrum, saa adskillelsen er foerste kolon.
export function parseWpLogin(text) {
  const t = String(text || '').trim();
  const i = t.indexOf(':');
  if (i < 1 || !t.slice(i + 1).trim()) {
    throw new Error('Enter your WordPress username and the application password as username:password');
  }
  return { user: t.slice(0, i).trim(), password: t.slice(i + 1).trim() };
}

// ---------- Klienten ----------

export class ShopError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function basic(user, secret) {
  return `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
}

export class ShopClient {
  constructor({ baseUrl = DEFAULT_SHOP_URL, wooKey, wooSecret, wpUser, wpPassword, fetchImpl = null }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.woo = wooKey && wooSecret ? basic(wooKey, wooSecret) : null;
    this.wp = wpUser && wpPassword ? basic(wpUser, wpPassword) : null;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  async _request(auth, kind, method, path, { json, body, headers = {} } = {}) {
    if (!auth) {
      throw new ShopError(kind === 'woo'
        ? 'No WooCommerce key yet. Add it under Help.'
        : 'No WordPress application password yet. Add it under Help.');
    }
    const h = { Authorization: auth, Accept: 'application/json', ...headers };
    let payload = body;
    if (json !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(json);
    }
    const prefix = kind === 'woo' ? '/wp-json/wc/v3' : '/wp-json/wp/v2';
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}${prefix}${path}`, { method, headers: h, body: payload });
    } catch {
      throw new ShopError('Could not reach the shop. Check the connection and try again.');
    }
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { /* svar uden JSON */ }
    if (!res.ok) {
      const grund = data?.message ? `: ${String(data.message).replace(/<[^>]+>/g, '')}` : '';
      if (res.status === 401 || res.status === 403) {
        throw new ShopError(`The shop rejected the ${kind === 'woo' ? 'WooCommerce key' : 'WordPress application password'}${grund}`, { status: res.status });
      }
      throw new ShopError(`The shop answered ${res.status}${grund}`, { status: res.status, code: data?.code ?? null });
    }
    return data;
  }

  wc(method, path, json) {
    return this._request(this.woo, 'woo', method, path, { json });
  }

  wpApi(method, path, json) {
    return this._request(this.wp, 'wp', method, path, { json });
  }

  uploadMedia(buffer, filename, mime) {
    return this._request(this.wp, 'wp', 'POST', '/media', {
      body: buffer,
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      },
    });
  }
}

// ---------- Billeder ----------

// En JPEG i hoej kvalitet paa ca. 3000 px, aldrig printmasteren. Paa macOS
// er det sips, og kan det ikke, falder det tilbage paa sharp; andre steder
// er det sharp. Fejler begge, staar begge aarsager i fejlbeskeden.
async function viaSips(absPath, size, quality, out, runner) {
  await runner('sips', [
    '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality),
    '--resampleHeightWidthMax', String(size), absPath, '--out', out,
  ]);
}

async function viaSharp(absPath, size, quality, out) {
  if (!RASTER_EXTS.has(extOf(absPath))) throw new Error(`sharp cannot read .${extOf(absPath)} files`);
  const sharp = (await import('sharp')).default;
  await sharp(absPath, { failOn: 'truncated' })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality })
    .toFile(out);
}

function kortAarsag(err) {
  return String(err?.stderr || err?.message || err).trim().replace(/\s+/g, ' ').slice(0, 200);
}

export async function exportJpeg(
  absPath,
  size = SHOP_IMAGE_SIZE,
  quality = SHOP_JPEG_QUALITY,
  { platform = process.platform, runner = run, rotation = 0 } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'at-shop-'));
  const out = join(dir, 'export.jpg');
  const veje = platform === 'darwin'
    ? [['sips', viaSips], ['sharp', viaSharp]]
    : [['sharp', viaSharp]];
  const aarsager = [];
  try {
    for (const [navn, fn] of veje) {
      try {
        await fn(absPath, size, quality, out, runner);
        if (rotation) {
          // Brugerens egen drejning, lagt oven paa den automatiske.
          const sharp = (await import('sharp')).default;
          return await sharp(out).rotate(rotation).jpeg({ quality }).toBuffer();
        }
        return readFileSync(out);
      } catch (err) {
        aarsager.push(`${navn}: ${kortAarsag(err)}`);
        rmSync(out, { force: true });
      }
    }
    throw new ShopError(`The image ${basename(absPath)} could not be exported as a JPEG (${aarsager.join('; ')})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VIDEO_TYPES = { mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm' };

// Fingeraftrykket af alt det, appen sender til shoppen om et vaerk: felter,
// tekster, serie, soegeord og hvilke udgaver af billederne. Er det et andet
// end ved sidste afsendelse, er vaerket aendret i appen og shoppen bagud.
// Rettelser lavet direkte i WooCommerce kan det ikke se.
export function vaerkAftryk(work, { works, catalog, ord = [] }) {
  const fil = (f) => (f ? sourceKey(f) : null);
  const crops = (work.crops || []).map((c) => {
    const v = catalog.getVersion(c.versionId);
    return [c.format, fil(v ? catalog.getFile(v.effective_file_id) : null)];
  });
  const data = {
    titel: work.effective?.title, aar: work.effective?.year, nr: work.effective?.catalogueNumber,
    kategori: work.category, teknik: work.technique, skabelon: work.template, farve: work.sectionColour,
    video: work.video, prints: work.prints, maal: work.dimensions, pris: work.price,
    beskrivelse: work.description, kort: work.shortText, alt: work.altText,
    serie: work.series ? [work.series.id, work.series.name, work.series.intro, work.series.template, work.series.colour] : null,
    hoved: fil(works.imageFile(work.imageId)), crops, ord, priser: PRISLISTE.version,
  };
  return createHash('sha1').update(JSON.stringify(data)).digest('hex');
}

// Hvilken udgave af en fil der er uploadet. Aendres noget af det, er det en
// ny fil.
function sourceKey(file) {
  return `${file.id}:${file.size}:${file.mtime}:${file.hash ?? ''}${file.rotation ? `:r${file.rotation}` : ''}`;
}

export class MediaSync {
  constructor({ catalog, client, exporter = exportJpeg }) {
    this.catalog = catalog;
    this.db = catalog.db;
    this.client = client;
    this.exporter = exporter;
  }

  // Returnerer { id, url, uploaded }. Uploader kun hvis filen er aendret
  // siden sidst; er det kun alt-teksten der er aendret, opdateres den paa
  // mediet uden en ny upload.
  async ensure(imageId, role, file, alt) {
    const key = sourceKey(file);
    const rec = this.db.get('SELECT * FROM work_media WHERE image_id=? AND role=?', imageId, role);
    if (rec && rec.source_key === key) {
      if ((rec.alt || '') === (alt || '')) return { id: rec.media_id, url: rec.source_url, uploaded: false };
      try {
        await this.client.wpApi('POST', `/media/${rec.media_id}`, { alt_text: alt || '' });
        this.db.run('UPDATE work_media SET alt=? WHERE image_id=? AND role=?', alt || null, imageId, role);
        return { id: rec.media_id, url: rec.source_url, uploaded: false };
      } catch (err) {
        // Mediet er slettet i WordPress: saa er der intet at opdatere.
        if (err.status !== 404) throw err;
      }
    }
    const abs = this.catalog.abs(file.rel_path);
    const buffer = await this.exporter(abs, undefined, undefined, { rotation: file.rotation || 0 });
    const stem = basename(file.rel_path).replace(/\.[^.]+$/, '');
    const media = await this.client.uploadMedia(buffer, `${stem}-${role.replace(':', 'x')}.jpg`, 'image/jpeg');
    await this.client.wpApi('POST', `/media/${media.id}`, { alt_text: alt || '', title: stem });
    this._remember(imageId, role, key, media, alt);
    return { id: media.id, url: media.source_url ?? null, uploaded: true };
  }

  // Videoen er en fil der vaelges i appen, ikke en version, saa den noegles
  // paa stien og stoerrelsen i stedet.
  async ensureVideo(imageId, absPath, size, mtime) {
    const key = `video:${absPath}:${size}:${mtime}`;
    const rec = this.db.get("SELECT * FROM work_media WHERE image_id=? AND role='video'", imageId);
    if (rec && rec.source_key === key) return { id: rec.media_id, url: rec.source_url, uploaded: false };
    const mime = VIDEO_TYPES[extOf(absPath)];
    if (!mime) throw new ShopError('The video must be an mp4, m4v, mov or webm file');
    const media = await this.client.uploadMedia(readFileSync(absPath), basename(absPath), mime);
    this._remember(imageId, 'video', key, media, null);
    return { id: media.id, url: media.source_url ?? null, uploaded: true };
  }

  _remember(imageId, role, key, media, alt) {
    this.db.run(
      `INSERT INTO work_media(image_id, role, source_key, media_id, source_url, alt) VALUES(?,?,?,?,?,?)
       ON CONFLICT(image_id, role) DO UPDATE SET source_key=excluded.source_key,
         media_id=excluded.media_id, source_url=excluded.source_url, alt=excluded.alt`,
      imageId, role, key, media.id, media.source_url ?? null, alt || null
    );
  }
}

// ---------- Produktet ----------

export function cropMetaKey(format) {
  return `work_crop_${format.replace(':', 'x')}`;
}

// ACPT-felterne paa produktet, som de staar paa produkt 20
// (docs/reference-product-20.json). Hvert felt gemmes som fire raekker:
// vaerdien, evt. *_attachment_id (billeder og video), *_id (feltets
// definitions-UUID, ens for alle produkter) og *_type. Mangler UUID'et
// eller typen, kender ACPT ikke vaerdien igen i editoren.
const IMAGE = { type: 'Image', attachment: true };
export const ACPT_FIELDS = [
  { key: 'work_template', id: '3692521e-3717-4beb-8d71-48a2ab9d96b9', type: 'Select' },
  { key: 'work_section_colour', id: '466b6a47-09d1-4d87-976e-f92f28fafc8c', type: 'Color' },
  { key: 'work_catalogue_number', id: 'ca4bd49f-2a9b-4eab-b2c2-3a052d364534', type: 'Text' },
  { key: 'work_video', id: '7c6f9df0-0c40-4a52-bac0-b081270142bf', type: 'Video', attachment: true },
  { key: 'work_prints', id: '2ef88b67-6284-4af0-a721-357d8ab655f6', type: 'Toggle' },
  { key: 'work_crop_1x1', id: 'c1bf7238-d533-4184-b5d9-4cc7f34dc98f', ...IMAGE },
  { key: 'work_crop_2x3', id: 'cf2ee705-aed9-499b-b3bf-275e54b10222', ...IMAGE },
  { key: 'work_crop_3x2', id: 'ba11dc54-a9a1-4446-b2d5-a9584936d6d5', ...IMAGE },
  { key: 'work_crop_1x2', id: 'a177734f-603a-4aec-b1e1-c041b583389f', ...IMAGE },
  { key: 'work_crop_2x1', id: '55d0781f-0ca7-4365-8238-245b2d0c0cba', ...IMAGE },
];

// Rene vaerdier foer de pakkes ind som ACPT-raekker. Sektionsfarve og
// katalognummer sendes kun naar Stef selv har udfyldt dem: tomt betyder
// "seriens farve" og "tallet sidst i titlen", og det er Astro der regner
// det ud (datamodel.md).
function acptValue(field, work, media) {
  switch (field.key) {
    case 'work_template': return { value: work.template };
    case 'work_section_colour': return { value: work.sectionColour || '' };
    case 'work_catalogue_number': return { value: work.catalogueNumber || '' };
    // Til/fra: tom naar fra, saa en streng som "0" aldrig kan laeses som sand.
    case 'work_prints': return { value: work.prints ? '1' : '' };
    case 'work_video': return mediaValue(media.video);
    default: {
      const format = CROP_FORMATS.find((f) => cropMetaKey(f) === field.key);
      return mediaValue(media.crops[format]);
    }
  }
}

function mediaValue(m) {
  return m ? { value: m.url || '', attachment: String(m.id) } : { value: '', attachment: '' };
}

export function acptMeta(work, media) {
  const meta = [];
  for (const field of ACPT_FIELDS) {
    const { value, attachment } = acptValue(field, work, media);
    meta.push({ key: field.key, value });
    if (field.attachment) meta.push({ key: `${field.key}_attachment_id`, value: attachment });
    meta.push({ key: `${field.key}_id`, value: field.id });
    meta.push({ key: `${field.key}_type`, value: field.type });
  }
  return meta;
}

// Sammenligner et produkt fra Woo med det format vi skriver. Bruges af
// "Check shop format": passer det, kan der sendes; passer det ikke, er
// ACPT-felterne aendret paa shoppen, og det der skrives ville ikke blive
// genkendt.
export function compareFormat(product) {
  const meta = new Map((product?.meta_data || []).map((m) => [m.key, m.value]));
  const problems = [];
  for (const field of ACPT_FIELDS) {
    const noegler = [`${field.key}`, `${field.key}_id`, `${field.key}_type`];
    if (field.attachment) noegler.push(`${field.key}_attachment_id`);
    for (const k of noegler) {
      if (!meta.has(k)) problems.push(`The product has no field ${k}`);
    }
    if (meta.has(`${field.key}_id`) && meta.get(`${field.key}_id`) !== field.id) {
      problems.push(`${field.key} has a different field id in the shop`);
    }
    if (meta.has(`${field.key}_type`) && meta.get(`${field.key}_type`) !== field.type) {
      problems.push(`${field.key} is ${meta.get(`${field.key}_type`)} in the shop, not ${field.type}`);
    }
  }
  return problems;
}

// Det Stef G Art ejer af attributterne. Format, Material, Frame og Size er
// printvarianternes. Alt andet kender appen ikke, og det fjernes: appen
// overruler shoppen.
const EJEDE_ATTRIBUTTER = ['Year', 'Technique', 'Dimensions'];

function ejedeVaerdier(work) {
  return {
    Year: work.effective.year ? String(work.effective.year) : null,
    Technique: work.technique || null,
    Dimensions: work.unique && work.dimensions ? work.dimensions : null,
  };
}

// Variationsattributterne ejer appen ogsaa, naar den laver varianterne.
const VARIANT_ATTRIBUTTER = ['Format', 'Material', 'Frame', 'Size'];

// Flette de ejede attributter ind i dem produktet har. Woo erstatter hele
// listen ved en opdatering. Gives varianterne med, erstatter de Format,
// Material, Frame og Size; ellers bliver de staaende som de er. En
// attribut appen ikke kender, kommer ikke med og forsvinder fra produktet.
export function mergeAttributes(existing, work, varianter = null) {
  const ejede = ejedeVaerdier(work);
  const ud = [];
  const set = new Set();
  for (const attr of existing || []) {
    if (varianter && VARIANT_ATTRIBUTTER.includes(attr.name)) continue;
    if (VARIANT_ATTRIBUTTER.includes(attr.name)) {
      ud.push(attr);
      continue;
    }
    if (!EJEDE_ATTRIBUTTER.includes(attr.name)) continue;
    set.add(attr.name);
    if (ejede[attr.name]) ud.push({ ...attr, options: [ejede[attr.name]] });
  }
  // Nye ejede attributter foerst, i fast raekkefoelge, saa Year og
  // Technique staar over variantattributterne som paa produkt 20.
  const nye = EJEDE_ATTRIBUTTER
    .filter((n) => ejede[n] && !set.has(n))
    .map((n) => ({ name: n, visible: true, variation: false, options: [ejede[n]] }));
  const variant = varianter?.length
    ? variantAttributter(varianter).map((a) => ({ ...a, visible: true, variation: true }))
    : [];
  return [...nye, ...ud, ...variant].map((a, i) => ({ ...a, position: i }));
}

// Vaerkets SKU, som i variant-SKU'erne: forbogstaverne i titlen og
// nummeret ("Desert Canyon 04" -> DC04). En titel paa ét ord giver de
// tre foerste bogstaver ("Roofs 2" -> ROO2).
export function vaerkSku(work) {
  const nummer = work.effective?.catalogueNumber || '';
  const ord = String(work.effective?.title || '')
    .replace(/\d+\s*$/, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/æ/gi, 'ae').replace(/ø/gi, 'oe').replace(/å/gi, 'aa')
    .split(/[^A-Za-z]+/).filter(Boolean);
  const bogstaver = ord.length === 1
    ? ord[0].slice(0, 3)
    : ord.map((w) => w[0]).join('');
  return `${bogstaver.toUpperCase() || 'W'}${nummer}`;
}

// Produktet som Stef G Art ejer det. Lager og ordrer roeres ikke. Et unikt
// vaerk er et simpelt produkt med 1 paa lager; alle andre er variable, som
// produkt 20, med varianterne fra prislisten (varianter).
export function buildProduct(work, media, {
  categoryId = null, create = true, existingAttributes = [], tagIds = null, varianter = null,
} = {}) {
  const produkt = {
    name: work.effective.title,
    description: work.description || '',
    short_description: work.shortText || '',
    images: [{ id: media.main.id }],
    attributes: mergeAttributes(existingAttributes, work, work.unique ? null : varianter),
    meta_data: acptMeta(work, media),
    // Skulpturer: Reduced rate. Alt andet: Standard (tom).
    tax_class: work.category === 'Sculptures' ? 'reduced-rate' : '',
  };
  if (categoryId) produkt.categories = [{ id: categoryId }];
  // Soegeordene som tags. Uden ord har produktet ingen tags: appen
  // overruler shoppen.
  if (Array.isArray(tagIds)) produkt.tags = tagIds.map((id) => ({ id }));
  if (work.unique && work.price) produkt.regular_price = work.price;
  if (create) {
    produkt.type = work.unique ? 'simple' : 'variable';
    if (work.unique) {
      // Lageret er kun vores naar produktet oprettes; bagefter er det Woos.
      produkt.manage_stock = true;
      produkt.stock_quantity = 1;
    }
    // Nye produkter er altid kladder. En opdatering rorer ikke status.
    produkt.status = 'draft';
  }
  return produkt;
}

// WordPress svarer med HTML-entiteter i termnavne ("Funky &amp; Fire").
function afkod(tekst) {
  return String(tekst ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

// Seriens tre termfelter, som WP REST kalder dem under meta.
function serieMeta(serie) {
  const meta = {};
  if (serie.intro) meta.series_data_intro = serie.intro;
  if (serie.template) meta.series_data_series_template = serie.template;
  if (serie.colour) meta.series_data_series_colour = serie.colour;
  return meta;
}

export class ShopSync {
  // status faar en kort tekst for hvert skridt i en afsendelse, saa Stef kan
  // se hvad der sker, og hvornaar det er faerdigt.
  constructor({ catalog, works, client, exporter, status = () => {} }) {
    this.catalog = catalog;
    this.works = works;
    this.client = client;
    this.status = status;
    this.media = new MediaSync({ catalog, client, exporter });
    this.categoryIds = new Map();
  }

  async categoryId(name) {
    if (!name) return null;
    if (this.categoryIds.has(name)) return this.categoryIds.get(name);
    const svar = await this.client.wc('GET', `/products/categories?search=${encodeURIComponent(name)}&per_page=100`);
    const fund = (svar || []).find((c) => afkod(c.name).toLowerCase() === name.toLowerCase());
    if (!fund) throw new ShopError(`The shop has no product category called "${name}"`);
    this.categoryIds.set(name, fund.id);
    return fund.id;
  }

  // Finder seriens term paa navn, og opretter den med sine tre felter hvis
  // den ikke findes. En term der findes, faar kun de felter Stef har
  // udfyldt i appen; tomme felter staar uroert i Woo.
  aftryk(imageId) {
    return vaerkAftryk(this.works.get(imageId), { works: this.works, catalog: this.catalog, ord: this.ordFor(imageId) });
  }

  // Vaerkets soegeord, som de staar paa hovedbilledet (masteren): Stefs
  // egne foerst.
  ordFor(imageId) {
    const fil = this.works.imageFile(imageId);
    if (!fil) return [];
    return this.catalog.keywordsForFile(fil.id).map((k) => k.word).slice(0, MAX_TAGS);
  }

  // Tag-id'erne i shoppen for ordene. Et tag der ikke findes, oprettes.
  async tagIds(ord) {
    this.tagCache ??= new Map();
    const ids = [];
    for (const ordet of ord) {
      const noegle = ordet.toLowerCase();
      if (!this.tagCache.has(noegle)) {
        const svar = await this.client.wc('GET', `/products/tags?search=${encodeURIComponent(ordet)}&per_page=100`);
        const fund = (Array.isArray(svar) ? svar : []).find((t) => afkod(t.name).toLowerCase() === noegle);
        const id = fund ? fund.id : (await this.client.wc('POST', '/products/tags', { name: ordet })).id;
        this.tagCache.set(noegle, id);
      }
      ids.push(this.tagCache.get(noegle));
    }
    return ids;
  }

  async seriesTermId(serie) {
    const svar = await this.client.wpApi('GET', `/series?search=${encodeURIComponent(serie.name)}&per_page=100`);
    const fund = (svar || []).find((t) => afkod(t.name).toLowerCase() === serie.name.toLowerCase());
    const meta = serieMeta(serie);
    if (!fund) {
      // En ny term faar altid en skabelon; datamodel.md kraever den.
      const ny = await this.client.wpApi('POST', '/series', {
        name: serie.name,
        meta: { series_data_series_template: 'walkthrough', ...meta },
      });
      return ny.id;
    }
    const aendret = Object.entries(meta).filter(([k, v]) => (fund.meta?.[k] ?? '') !== v);
    if (aendret.length) {
      await this.client.wpApi('POST', `/series/${fund.id}`, { meta: Object.fromEntries(aendret) });
    }
    return fund.id;
  }

  // Det der mangler foer et vaerk kan sendes, som en liste Stef kan laese.
  problems(work) {
    const mangler = [];
    if (!work.eligible) mangler.push('The image must be Approved and Finished');
    if (!work.category) mangler.push('Choose a category');
    if (!work.description) mangler.push('The description is empty');
    if (!work.altText) mangler.push('The alt text is empty');
    if (!work.effective.year) mangler.push('Set the year');
    if (work.unique && !work.price) mangler.push('Set the price');
    return mangler;
  }

  async _mediaFor(work) {
    const imageId = work.imageId;
    const mainFile = this.works.imageFile(imageId);
    if (!mainFile) throw new ShopError('The image file is not available right now');
    const alt = work.altText || '';
    this.status('Uploading the main picture');
    const media = { main: await this.media.ensure(imageId, 'main', mainFile, alt), crops: {}, video: null };
    for (const [i, crop] of work.crops.entries()) {
      this.status(`Uploading the ${crop.format} crop (${i + 1} of ${work.crops.length})`);
      const file = this.catalog.getFile(this.catalog.getVersion(crop.versionId).effective_file_id);
      if (!file?.present) throw new ShopError(`The ${crop.format} crop file is not available right now`);
      media.crops[crop.format] = await this.media.ensure(imageId, crop.format, file, alt);
    }
    return media;
  }

  async _videoFor(work, media) {
    if (!work.video) return;
    let st;
    try { st = statSync(work.video); } catch { throw new ShopError('The video file is not available right now'); }
    media.video = await this.media.ensureVideo(work.imageId, work.video, st.size, Math.floor(st.mtimeMs));
  }

  // Produktet som det staar i Woo nu, eller null hvis det er slettet der.
  // Woo erstatter hele attributlisten ved en opdatering, saa den skal hentes
  // for at printvarianternes attributter kan sendes med uroert.
  async _existing(id) {
    try {
      return await this.client.wc('GET', `/products/${id}`);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  // Opretter produktet foerste gang og opdaterer det bagefter. Woo-id'et
  // gemmes straks, saa et afbrudt kald aldrig giver en dublet. Er produktet
  // slettet i Woo, oprettes det paa ny.
  //
  // Kender appen ikke et produkt til vaerket, men har shoppen ét med samme
  // navn (fx et der er lavet i haanden), spoerges der foerst: svaret er
  // { needsConfirm: true, existing: { id, name, status } }, og intet er
  // sendt. kobl er det produkt-id brugeren har sagt ja til at opdatere.
  async send(imageId, { kobl = null } = {}) {
    let work = this.works.get(imageId);
    const mangler = this.problems(work);
    if (mangler.length) throw new ShopError(`Not ready to send: ${mangler.join('; ')}`);
    if (!work.wooProductId && kobl) {
      this.works.setWooProductId(imageId, kobl);
      work = this.works.get(imageId);
    } else if (!work.wooProductId) {
      const navn = work.effective.title.trim().toLowerCase();
      const fundne = await this.client.wc('GET', `/products?search=${encodeURIComponent(work.effective.title)}&per_page=100&status=any`);
      const samme = (Array.isArray(fundne) ? fundne : []).filter((p) => String(p.name || '').trim().toLowerCase() === navn);
      if (samme.length) {
        const p = samme[0];
        return { needsConfirm: true, existing: { id: p.id, name: p.name, status: p.status }, flere: samme.length };
      }
    }
    const media = await this._mediaFor(work);
    if (work.video) this.status('Uploading the video');
    await this._videoFor(work, media);
    this.status('Finding the category and the series');
    const categoryId = await this.categoryId(work.category);
    const termId = work.series ? await this.seriesTermId(work.series) : null;

    const eksisterende = work.wooProductId ? await this._existing(work.wooProductId) : null;
    if (work.wooProductId && !eksisterende) this.works.setWooProductId(imageId, null);
    const create = !eksisterende;
    this.status('Finding the tags');
    const tagIds = await this.tagIds(this.ordFor(imageId));
    // Printvarianterne for de formater vaerket har beskaeringer i. Uden
    // beskaeringer roeres varianterne ikke.
    const formater = (work.crops || []).map((c) => c.format);
    const medVarianter = !work.unique && formater.length > 0;
    const varianter = medVarianter ? printVarianter(formater, 'X') : null;
    const body = buildProduct(work, media, {
      categoryId, create, existingAttributes: eksisterende?.attributes || [], tagIds, varianter,
    });
    // SKU'en saettes kun, naar produktet ikke har én: en Stef har givet det
    // i Woo, eller som varianterne bygger paa, roeres ikke.
    if (!eksisterende?.sku) body.sku = vaerkSku(work);
    // Seriens andre vaerker som upsells ("You may also like"). Uden en
    // serie ingen upsells, heller ikke nogen der er sat i Woo.
    body.upsell_ids = work.seriesId
      ? this.works.serieProdukter(work.seriesId)
        .filter((p) => p.imageId !== imageId).map((p) => p.productId)
      : [];
    const gem = () => (create
      ? this.client.wc('POST', '/products', body)
      : this.client.wc('PUT', `/products/${work.wooProductId}`, body));
    this.status(create ? 'Creating the product' : 'Saving the product');
    let produkt;
    try {
      produkt = await gem();
    } catch (err) {
      // SKU'en findes i forvejen paa et andet produkt: saa med vaerkets
      // nummer i appen bagpaa.
      if (err.code !== 'product_invalid_sku' || !body.sku) throw err;
      body.sku = `${body.sku}-${imageId}`;
      produkt = await gem();
    }
    if (create) this.works.setWooProductId(imageId, produkt.id);
    this.works.setWooStatus(imageId, produkt.status);
    if (medVarianter) {
      const sku = produkt.sku || body.sku || eksisterende?.sku || vaerkSku(work);
      await this._synkVarianter(produkt.id, printVarianter(formater, sku));
    }
    this.works.setWooAftryk(imageId, this.aftryk(imageId));
    // De andre vaerker i serien faar det nye med som upsell.
    if (work.seriesId) {
      this.status('Linking the works in the series');
      await this._serieUpsells(work.seriesId, imageId);
    }
    // Serien saettes ikke via wc/v3 men via WP REST paa selve produktet.
    // Uden en serie i appen roeres den i Woo ikke.
    if (termId) {
      this.status('Setting the series');
      await this.client.wpApi('POST', `/product/${produkt.id}`, { series: [termId] });
    }
    return { productId: produkt.id, status: produkt.status, link: produkt.permalink ?? null, created: create };
  }

  // Varianterne i shoppen, saa de svarer til prislisten: de manglende
  // oprettes, de der findes (samme SKU) faar pris og felter, og resten
  // slettes (fx Framed paper fra den gamle CSV). Alt i hold paa 100.
  async _synkVarianter(productId, varianter) {
    const findes = [];
    for (let side = 1; ; side += 1) {
      const svar = await this.client.wc('GET', `/products/${productId}/variations?per_page=100&page=${side}`);
      const liste = Array.isArray(svar) ? svar : [];
      findes.push(...liste);
      if (liste.length < 100) break;
    }
    const efterSku = new Map(findes.map((v) => [v.sku, v]));
    const felter = (v) => ({
      sku: v.sku,
      regular_price: String(v.pris),
      manage_stock: false,
      stock_status: 'instock',
      attributes: [
        { name: 'Format', option: v.format },
        { name: 'Material', option: v.materiale },
        { name: 'Frame', option: v.ramme },
        { name: 'Size', option: v.stoerrelse },
      ],
      meta_data: [
        { key: 'prodigi_sku', value: v.prodigi },
        { key: 'prodigi_options', value: JSON.stringify(v.prodigiValg) },
        // Tom liste: kan saelges overalt. hide_in_countries fra prisliste 3.0
        // toemmes, saa sitet og shoppen kun skal kende ship_only_to.
        { key: 'ship_only_to', value: v.kunTilLande.join(',') },
        { key: 'hide_in_countries', value: '' },
      ],
    });
    const create = [];
    const update = [];
    const beholdt = new Set();
    for (const v of varianter) {
      const gammel = efterSku.get(v.sku);
      if (gammel) {
        beholdt.add(gammel.id);
        update.push({ id: gammel.id, ...felter(v) });
      } else {
        create.push(felter(v));
      }
    }
    const del = findes.filter((v) => !beholdt.has(v.id)).map((v) => v.id);
    this.status(`Updating the print variants (${varianter.length})`);
    const ops = [
      ...del.map((id) => ['delete', id]),
      ...update.map((x) => ['update', x]),
      ...create.map((x) => ['create', x]),
    ];
    for (let i = 0; i < ops.length; i += 100) {
      const hold = { create: [], update: [], delete: [] };
      for (const [art, x] of ops.slice(i, i + 100)) hold[art].push(x);
      await this.client.wc('POST', `/products/${productId}/variations/batch`, hold);
    }
    return { oprettet: create.length, opdateret: update.length, slettet: del.length };
  }

  // Update shop texts: handelsbetingelserne og privatlivspolitikken som sider
  // i WordPress, teksten over koebsknappen og teksten i ordremailen, fra
  // shoptekster.mjs. Siderne findes paa deres adresse (WordPress' egen kladde
  // til privacy-policy genbruges) og udgives. Koeb som gaest slaas til og
  // oprettelse af konto i kassen fra. En indstilling shoppen ikke kender,
  // stopper ikke resten; den kommer med som en advarsel.
  async opdaterTekster() {
    const advarsler = [];
    const side = async (slug, title, content) => {
      const fundne = await this.client.wpApi('GET', `/pages?slug=${slug}&status=any&context=edit`);
      const findes = Array.isArray(fundne) ? fundne[0] : null;
      const body = { title, content, status: 'publish', slug };
      return findes
        ? this.client.wpApi('POST', `/pages/${findes.id}`, body)
        : this.client.wpApi('POST', '/pages', body);
    };
    const indstilling = async (gruppe, id, value) => {
      try {
        await this.client.wc('PUT', `/settings/${gruppe}/${id}`, { value });
      } catch (err) {
        advarsler.push(`${id}: ${err.message}`);
      }
    };
    this.status('Saving the privacy policy');
    const privatliv = await side('privacy-policy', 'Privacy policy', privatlivspolitik());
    this.status('Saving the terms and conditions');
    const vilkaar = await side('terms-and-conditions', 'Terms and conditions', betingelser(privatliv.link));
    this.status('Saving the checkout and the order email');
    await indstilling('advanced', 'woocommerce_terms_page_id', String(vilkaar.id));
    await indstilling('account', 'woocommerce_checkout_privacy_policy_text', KASSE_TEKST);
    await indstilling('account', 'woocommerce_enable_guest_checkout', 'yes');
    await indstilling('account', 'woocommerce_enable_signup_and_login_from_checkout', 'no');
    await indstilling('email_customer_processing_order', 'additional_content', MAIL_TEKST);
    return { betingelser: vilkaar.link, privatliv: privatliv.link, dato: TEKST_DATO, advarsler };
  }

  // Update all prints: varianter og priser paa alle printprodukter i
  // shoppen, efter prislisten. Tekster og billeder roeres ikke.
  async opdaterAlleVarianter() {
    let antal = 0;
    for (const { imageId, productId } of this.works.medProdukt()) {
      const work = this.works.get(imageId);
      const formater = (work.crops || []).map((c) => c.format);
      if (work.unique || !formater.length) continue;
      const produkt = await this._existing(productId);
      if (!produkt) continue;
      this.status(`Updating ${work.effective.title}`);
      await this.client.wc('PUT', `/products/${productId}`, {
        attributes: mergeAttributes(produkt.attributes || [], work, printVarianter(formater, 'X')),
      });
      await this._synkVarianter(productId, printVarianter(formater, produkt.sku || vaerkSku(work)));
      antal += 1;
    }
    return { antal, version: PRISLISTE.version };
  }

  // Seriens andre produkter linker til hele serien, undtagen sig selv.
  async _serieUpsells(seriesId, sendt) {
    const alle = this.works.serieProdukter(seriesId);
    for (const p of alle) {
      if (p.imageId === sendt) continue;
      const upsells = alle.filter((x) => x.imageId !== p.imageId).map((x) => x.productId);
      try {
        await this.client.wc('PUT', `/products/${p.productId}`, { upsell_ids: upsells });
      } catch (err) {
        // Et produkt der er slettet i Woo, springes over; det rydder
        // statusopdateringen op i.
        if (err.status !== 404) throw err;
      }
    }
  }

  // Tager produktet af sitet: det bliver en kladde igen og ikke slettet,
  // for gamle ordrer peger paa det. Vaerket gaar tilbage til 5 Product.
  async fjern(imageId) {
    const work = this.works.get(imageId);
    if (!work.wooProductId) throw new ShopError('The work is not in the shop');
    const produkt = await this.client.wc('PUT', `/products/${work.wooProductId}`, { status: 'draft' });
    this.works.setWooStatus(imageId, produkt.status);
    return { productId: produkt.id, status: produkt.status };
  }

  async publish(imageId) {
    const work = this.works.get(imageId);
    if (!work.wooProductId) throw new ShopError('Send the work to the shop first');
    const produkt = await this.client.wc('PUT', `/products/${work.wooProductId}`, { status: 'publish' });
    this.works.setWooStatus(imageId, produkt.status);
    return { productId: produkt.id, status: produkt.status, link: produkt.permalink ?? null };
  }

  // Henter status paa alle vaerkernes produkter fra shoppen, 100 ad gangen,
  // saa et produkt der er publiceret eller taget af paa siden, ogsaa staar
  // rigtigt i appen. Et produkt der ikke findes mere, glemmes.
  async opdaterStatus() {
    const vaerker = this.works.medProdukt();
    let aendret = 0;
    for (let i = 0; i < vaerker.length; i += 100) {
      const bid = vaerker.slice(i, i + 100);
      const svar = await this.client.wc('GET', `/products?include=${bid.map((v) => v.productId).join(',')}&per_page=100&status=any`);
      // Et uventet svar maa aldrig faa appen til at glemme produkterne.
      if (!Array.isArray(svar)) throw new ShopError('The shop did not return the products');
      const status = new Map(svar.map((p) => [p.id, p.status]));
      for (const v of bid) {
        if (!status.has(v.productId)) {
          this.works.setWooProductId(v.imageId, null);
          aendret += 1;
        } else if (status.get(v.productId) !== v.status) {
          this.works.setWooStatus(v.imageId, status.get(v.productId));
          aendret += 1;
        }
      }
    }
    return { aendret };
  }

  // Henter produkt 20 og tjekker at ACPT-felterne stadig ser ud, som vi
  // skriver dem.
  async checkFormat(id = REFERENCE_PRODUCT_ID) {
    const produkt = await this.client.wc('GET', `/products/${id}`);
    return { name: produkt.name, problems: compareFormat(produkt) };
  }
}
