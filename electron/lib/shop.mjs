// Send til shop (docs/plan-shop.md): opretter og opdaterer produktet i
// WooCommerce paa shop.stefg.art. Teksterne rettes kun i Art Triage; Woo er
// en kopi, og det der staar der bliver overskrevet naar vaerket sendes.
//
// To noegler, begge gemt som Claude-noeglen: aldrig vist igen, aldrig i
// loggen, aldrig sendt til brugerfladen. Fejlbeskeder herfra indeholder
// aldrig en noegle; de siger hvad der skete, ikke hvad der blev sendt.
import { readFileSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extOf, RASTER_EXTS } from './util.mjs';
import { CROP_FORMATS } from './works.mjs';

const run = promisify(execFile);

export const DEFAULT_SHOP_URL = 'https://shop.stefg.art';
export const SHOP_IMAGE_SIZE = 3000;
export const SHOP_JPEG_QUALITY = 92;
// Det produkt ACPT-felternes format kopieres fra (Desert Canyon 04).
export const REFERENCE_PRODUCT_ID = 20;

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
  constructor(message, { status = null } = {}) {
    super(message);
    this.status = status;
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
      throw new ShopError(`The shop answered ${res.status}${grund}`, { status: res.status });
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

// En JPEG i hoej kvalitet paa ca. 3000 px, aldrig printmasteren. Samme
// to veje som thumbnails: sips paa macOS, sharp ellers.
export async function exportJpeg(absPath, size = SHOP_IMAGE_SIZE, quality = SHOP_JPEG_QUALITY) {
  const dir = mkdtempSync(join(tmpdir(), 'at-shop-'));
  const out = join(dir, 'export.jpg');
  try {
    if (process.platform === 'darwin') {
      await run('sips', [
        '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality),
        '--resampleHeightWidthMax', String(size), absPath, '--out', out,
      ]);
    } else {
      if (!RASTER_EXTS.has(extOf(absPath))) throw new Error('unsupported');
      const sharp = (await import('sharp')).default;
      await sharp(absPath, { failOn: 'truncated' })
        .rotate()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality })
        .toFile(out);
    }
    return readFileSync(out);
  } catch {
    throw new ShopError(`The image ${basename(absPath)} could not be exported as a JPEG`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VIDEO_TYPES = { mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm' };

// Hvilken udgave af en fil der er uploadet. Aendres noget af det, er det en
// ny fil.
function sourceKey(file) {
  return `${file.id}:${file.size}:${file.mtime}:${file.hash ?? ''}`;
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
    const buffer = await this.exporter(abs);
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

// ACPT-felterne i meta_data. Noeglerne er dem planen angiver; formatet paa
// vaerdierne og de skjulte hjaelpefelter (som _attachment_id) skal matches
// mod produkt 20, Desert Canyon 04, foer noget sendes. Det er derfor samlet
// her paa ét sted.
export function acptMeta(work, media) {
  const meta = [
    { key: 'work_template', value: work.template },
    { key: 'work_section_colour', value: work.sectionColour || '' },
    { key: 'work_catalogue_number', value: work.effective.catalogueNumber || '' },
    { key: 'work_video', value: media.video ? String(media.video.id) : '' },
    { key: 'work_prints', value: work.prints ? '1' : '0' },
  ];
  for (const format of CROP_FORMATS) {
    const m = media.crops[format];
    meta.push({ key: cropMetaKey(format), value: m ? String(m.id) : '' });
  }
  return meta;
}

// Produktet som Art Triage ejer det. Lager, ordrer og printvarianter
// roeres ikke: ved en opdatering sendes kun felter herfra, og ved en
// oprettelse kun det der skal til for at et unikt vaerk kan koebes.
export function buildProduct(work, media, { categoryId = null, create = true } = {}) {
  const attributter = [];
  if (work.effective.year) {
    attributter.push({ name: 'Year', visible: true, options: [String(work.effective.year)] });
  }
  if (work.technique) {
    attributter.push({ name: 'Technique', visible: true, options: [work.technique] });
  }
  if (work.unique && work.dimensions) {
    attributter.push({ name: 'Dimensions', visible: true, options: [work.dimensions] });
  }
  const produkt = {
    name: work.effective.title,
    description: work.description || '',
    short_description: work.shortText || '',
    images: [{ id: media.main.id }],
    attributes: attributter,
    meta_data: acptMeta(work, media),
  };
  if (categoryId) produkt.categories = [{ id: categoryId }];
  if (work.unique) {
    // Paa et unikt vaerk er prisen Art Triages; lageret er det kun naar
    // produktet oprettes (1 stk.), bagefter er det Woos.
    if (work.price) produkt.regular_price = work.price;
    if (create) {
      produkt.type = 'simple';
      produkt.manage_stock = true;
      produkt.stock_quantity = 1;
    }
    if (work.category === 'Sculptures') produkt.tax_class = 'reduced-rate';
  }
  // Nye produkter er altid kladder. En opdatering rorer ikke status.
  if (create) produkt.status = 'draft';
  return produkt;
}

export class ShopSync {
  constructor({ catalog, works, client, exporter }) {
    this.catalog = catalog;
    this.works = works;
    this.client = client;
    this.media = new MediaSync({ catalog, client, exporter });
    this.categoryIds = new Map();
  }

  async categoryId(name) {
    if (!name) return null;
    if (this.categoryIds.has(name)) return this.categoryIds.get(name);
    const svar = await this.client.wc('GET', `/products/categories?search=${encodeURIComponent(name)}&per_page=100`);
    const fund = (svar || []).find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!fund) throw new ShopError(`The shop has no product category called "${name}"`);
    this.categoryIds.set(name, fund.id);
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
    for (const c of work.crops) {
      if (!CROP_FORMATS.includes(c.format)) mangler.push(`Unknown crop format ${c.format}`);
    }
    return mangler;
  }

  async _mediaFor(work) {
    const imageId = work.imageId;
    const mainFile = this.works.imageFile(imageId);
    if (!mainFile) throw new ShopError('The image file is not available right now');
    const alt = work.altText || '';
    const media = { main: await this.media.ensure(imageId, 'main', mainFile, alt), crops: {}, video: null };
    for (const crop of work.crops) {
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

  // Opretter produktet foerste gang og opdaterer det bagefter. Woo-id'et
  // gemmes straks, saa et afbrudt kald aldrig giver en dublet.
  async send(imageId) {
    const work = this.works.get(imageId);
    const mangler = this.problems(work);
    if (mangler.length) throw new ShopError(`Not ready to send: ${mangler.join('; ')}`);
    const media = await this._mediaFor(work);
    await this._videoFor(work, media);
    const categoryId = await this.categoryId(work.category);
    const create = !work.wooProductId;
    const body = buildProduct(work, media, { categoryId, create });
    const produkt = create
      ? await this.client.wc('POST', '/products', body)
      : await this.client.wc('PUT', `/products/${work.wooProductId}`, body);
    if (create) this.works.setWooProductId(imageId, produkt.id);
    return { productId: produkt.id, status: produkt.status, link: produkt.permalink ?? null, created: create };
  }

  async publish(imageId) {
    const work = this.works.get(imageId);
    if (!work.wooProductId) throw new ShopError('Send the work to the shop first');
    const produkt = await this.client.wc('PUT', `/products/${work.wooProductId}`, { status: 'publish' });
    return { productId: produkt.id, status: produkt.status, link: produkt.permalink ?? null };
  }

  // Det rene produkt fra Woo, til at kopiere ACPT-formatet fra.
  async reference(id = REFERENCE_PRODUCT_ID) {
    return this.client.wc('GET', `/products/${id}`);
  }
}
