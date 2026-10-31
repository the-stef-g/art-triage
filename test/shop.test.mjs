// Send til shop (docs/plan-shop.md). Intet her rammer et rigtigt netvaerk:
// shoppen er en attrap. Testene holder oeje med det der koster noget hvis
// det gaar galt: dubletter i Woo, genupload af store filer, noegler der
// ender i en fejlbesked, og at en opdatering ikke roerer lager eller status.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { Works } from '../electron/lib/works.mjs';
import {
  ShopClient, ShopSync, MediaSync, ShopError, parseWooKey, parseWpLogin, vaerkSku, vaerkAftryk,
  buildProduct, acptMeta, cropMetaKey, ACPT_FIELDS, compareFormat, mergeAttributes,
} from '../electron/lib/shop.mjs';

let root;
let db;
let catalog;
let works;

// Produkt 20 som det staar i Woo, hentet fra shoppen.
const reference = JSON.parse(readFileSync(new URL('../docs/reference-product-20.json', import.meta.url), 'utf8'));

function skriv(rel, indhold = rel) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, indhold);
}

// Attrap for fetch. Svarer paa (metode, sti) og husker alle kald.
function attrapShop(opts = {}) {
  const kald = [];
  let nextMedia = opts.startMedia || 100;
  let nextProduct = 500;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const sti = u.pathname.replace('/wp-json', '') + u.search;
    const post = { url, sti, method: init.method, headers: init.headers, body: init.body };
    kald.push(post);
    const svar = (status, data) => ({
      ok: status < 400, status, text: async () => (data === undefined ? '' : JSON.stringify(data)),
    });
    if (opts.offline) throw new Error('ENOTFOUND');
    if (opts.afvis) return svar(opts.afvis, { message: 'Sorry, you are not allowed' });
    if (init.method === 'POST' && sti === '/wp/v2/media') {
      const id = nextMedia++;
      return svar(201, { id, source_url: `https://shop.stefg.art/m/${id}.jpg` });
    }
    if (init.method === 'POST' && sti.startsWith('/wp/v2/media/')) {
      const mid = Number(sti.split('/').pop());
      if (opts.mediaSlettet?.includes(mid)) return svar(404, { message: 'Invalid ID' });
      return svar(200, { id: mid });
    }
    if (init.method === 'GET' && sti.startsWith('/wc/v3/products/categories')) {
      return svar(200, [{ id: 7, name: 'Photography' }, { id: 8, name: 'Sculptures' }, { id: 9, name: 'Paintings' }]);
    }
    if (init.method === 'GET' && sti.startsWith('/wp/v2/series?')) {
      return svar(200, opts.serier || []);
    }
    if (init.method === 'POST' && sti === '/wp/v2/series') {
      return svar(201, { id: 900, name: JSON.parse(init.body).name });
    }
    if (init.method === 'POST' && sti.startsWith('/wp/v2/series/')) {
      return svar(200, { id: Number(sti.split('/').pop()) });
    }
    if (init.method === 'POST' && sti.startsWith('/wp/v2/product/')) {
      return svar(200, { id: Number(sti.split('/').pop()) });
    }
    if (init.method === 'GET' && sti.startsWith('/wc/v3/products/tags?')) {
      const q = new URLSearchParams(u.search).get('search').toLowerCase();
      return svar(200, (opts.tags || []).filter((t) => t.name.toLowerCase().includes(q)));
    }
    if (init.method === 'POST' && sti === '/wc/v3/products/tags') {
      return svar(201, { id: 700 + kald.filter((k) => k.method === 'POST' && k.sti === '/wc/v3/products/tags').length, name: JSON.parse(init.body).name });
    }
    if (init.method === 'GET' && sti.startsWith('/wc/v3/products?search=')) {
      const q = new URLSearchParams(u.search).get('search').toLowerCase();
      return svar(200, (opts.produkter || []).filter((p) => p.name.toLowerCase().includes(q)));
    }
    if (init.method === 'GET' && sti.startsWith('/wc/v3/products?include=')) {
      const ids = new URLSearchParams(u.search).get('include').split(',').map(Number);
      return svar(200, ids.filter((pid) => !opts.slettetProdukter?.includes(pid))
        .map((pid) => ({ id: pid, status: opts.status?.[pid] ?? 'draft' })));
    }
    if (init.method === 'GET' && /^\/wc\/v3\/products\/\d+\/variations\?/.test(sti)) {
      const pid = Number(sti.split('/')[4]);
      const side = Number(new URLSearchParams(u.search).get('page') || 1);
      return svar(200, side === 1 ? (opts.varianter?.[pid] || []) : []);
    }
    if (init.method === 'POST' && /^\/wc\/v3\/products\/\d+\/variations\/batch$/.test(sti)) {
      return svar(200, {});
    }
    if (init.method === 'GET' && /^\/wc\/v3\/products\/\d+$/.test(sti)) {
      const pid = Number(sti.split('/').pop());
      if (opts.slettetProdukter?.includes(pid)) return svar(404, { message: 'Invalid ID' });
      return svar(200, { id: pid, attributes: opts.attributter || [] });
    }
    if (init.method === 'POST' && sti === '/wc/v3/products') {
      const sku = JSON.parse(init.body).sku;
      if (sku && opts.optagneSku?.includes(sku)) {
        return svar(400, { code: 'product_invalid_sku', message: 'Invalid or duplicated SKU.' });
      }
      return svar(201, { id: nextProduct++, status: 'draft', permalink: 'https://shop.stefg.art/p' });
    }
    if (init.method === 'PUT' && sti.startsWith('/wc/v3/products/')) {
      return svar(200, { id: Number(sti.split('/').pop()), status: JSON.parse(init.body).status || 'draft' });
    }
    if (init.method === 'GET' && sti.startsWith('/wp/v2/pages?')) {
      const slug = new URLSearchParams(u.search).get('slug');
      return svar(200, (opts.sider || []).filter((x) => x.slug === slug));
    }
    if (init.method === 'POST' && /^\/wp\/v2\/pages(\/\d+)?$/.test(sti)) {
      const krop = JSON.parse(init.body);
      const pid = Number(sti.split('/').pop()) || 3000 + kald.length;
      return svar(201, { id: pid, link: `https://shop.stefg.art/${krop.slug}/`, status: krop.status });
    }
    if (init.method === 'PUT' && sti.startsWith('/wc/v3/settings/')) {
      if (opts.ukendteIndstillinger?.some((x) => sti.endsWith(x))) return svar(400, { code: 'rest_setting_setting_invalid', message: 'Invalid setting.' });
      return svar(200, { id: sti.split('/').pop(), value: JSON.parse(init.body).value });
    }
    return svar(404, { message: 'no route' });
  };
  return { kald, fetchImpl };
}

const exporter = async () => Buffer.from('jpeg');

function klient(fetchImpl) {
  const c = new ShopClient({
    baseUrl: 'https://shop.stefg.art/',
    wooKey: 'ck_hemmelig', wooSecret: 'cs_hemmelig', wpUser: 'stef', wpPassword: 'abcd efgh',
    fetchImpl,
  });
  c.vent = async () => {};
  return c;
}

function imageIdFor(rel) {
  return catalog.listVersions({ visKasserede: true }).find((r) => r.rel_path === rel).image_id;
}

// Et faerdigt vaerk der kan sendes.
function klartVaerk(rel, extra = {}) {
  skriv(rel);
  catalog.sync();
  const id = imageIdFor(rel);
  const vid = catalog.listVersions({}).find((r) => r.image_id === id).version_id;
  catalog.setRating([vid], 'godkendt');
  catalog.setStage([vid], 'finished');
  works.save(id, {
    category: 'Photography', technique: 'Digital art', year: 2021,
    description: 'D', short_text: 'S', alt_text: 'A', ...extra,
  });
  return { id, vid };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'art-triage-shop-'));
  db = await openDatabase(join(root, '.art-triage', 'katalog.sqlite'));
  catalog = new Catalog(db, root);
  works = new Works(catalog);
});

afterEach(() => {
  try { db.close(); } catch { /* allerede lukket */ }
  rmSync(root, { recursive: true, force: true });
});

describe('noegler', () => {
  it('laeser consumer key og secret', () => {
    expect(parseWooKey('ck_a cs_b')).toEqual({ key: 'ck_a', secret: 'cs_b' });
    expect(parseWooKey('ck_a:cs_b')).toEqual({ key: 'ck_a', secret: 'cs_b' });
    expect(() => parseWooKey('ck_a')).toThrow();
    expect(() => parseWooKey('hej med dig')).toThrow();
  });

  it('laeser brugernavn og application password med mellemrum', () => {
    expect(parseWpLogin('stef:abcd efgh ijkl')).toEqual({ user: 'stef', password: 'abcd efgh ijkl' });
    expect(() => parseWpLogin('stef')).toThrow();
    expect(() => parseWpLogin(':kode')).toThrow();
  });

  it('nævner aldrig noeglen i en fejlbesked', async () => {
    for (const opts of [{ afvis: 401 }, { afvis: 403 }, { offline: true }]) {
      const { fetchImpl } = attrapShop(opts);
      const err = await klient(fetchImpl).wc('GET', '/products/1').catch((e) => e);
      expect(err).toBeInstanceOf(ShopError);
      expect(err.message).not.toMatch(/ck_|cs_|hemmelig|abcd/);
    }
  });

  it('proever igen ved en ustabil forbindelse og siger den rigtige aarsag', async () => {
    const svar = { ok: true, status: 201, text: async () => JSON.stringify({ id: 9 }) };
    const nulstillet = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    let n = 0;
    const ustabil = async () => { n += 1; if (n < 3) throw nulstillet(); return svar; };
    expect((await klient(ustabil).uploadMedia(Buffer.from('x'), 'a.jpg', 'image/jpeg')).id).toBe(9);
    expect(n).toBe(3);
    // Giver op efter 3 forsoeg, med aarsagen og hvad der var i gang.
    const doed = async () => { throw nulstillet(); };
    const err = await klient(doed).uploadMedia(Buffer.from('x'), 'a.jpg', 'image/jpeg').catch((e) => e);
    expect(err.message).toMatch(/while uploading a picture \(the connection was reset, ECONNRESET, tried 3 times\)/);
    // Et nyt produkt proeves kun én gang, saa der aldrig kommer en dublet.
    let p = 0;
    const tael = async () => { p += 1; throw nulstillet(); };
    await klient(tael).wc('POST', '/products', {}).catch(() => {});
    expect(p).toBe(1);
  });

  it('beder om noegleren der mangler, uden at kalde nettet', async () => {
    const { kald, fetchImpl } = attrapShop();
    const c = new ShopClient({ fetchImpl });
    await expect(c.wc('GET', '/products/1')).rejects.toThrow(/WooCommerce key/);
    await expect(c.uploadMedia(Buffer.from('x'), 'a.jpg', 'image/jpeg')).rejects.toThrow(/application password/);
    expect(kald).toHaveLength(0);
  });

  it('bruger Woo-noeglen til produkter og WordPress-koden til medier', async () => {
    const { kald, fetchImpl } = attrapShop();
    const c = klient(fetchImpl);
    await c.wc('GET', '/products/categories');
    await c.uploadMedia(Buffer.from('x'), 'a.jpg', 'image/jpeg');
    expect(kald[0].headers.Authorization).toBe(`Basic ${Buffer.from('ck_hemmelig:cs_hemmelig').toString('base64')}`);
    expect(kald[1].headers.Authorization).toBe(`Basic ${Buffer.from('stef:abcd efgh').toString('base64')}`);
    expect(kald[1].url).toBe('https://shop.stefg.art/wp-json/wp/v2/media');
  });
});

describe('billeder', () => {
  it('uploader ét billede og saetter alt-teksten', async () => {
    const { id } = klartVaerk('a.png');
    const { kald, fetchImpl } = attrapShop();
    const m = new MediaSync({ catalog, client: klient(fetchImpl), exporter });
    const res = await m.ensure(id, 'main', works.imageFile(id), 'En alt-tekst');
    expect(res).toMatchObject({ id: 100, uploaded: true });
    expect(kald.map((k) => `${k.method} ${k.sti}`)).toEqual(['POST /wp/v2/media', 'POST /wp/v2/media/100']);
    expect(JSON.parse(kald[1].body).alt_text).toBe('En alt-tekst');
    expect(kald[0].headers['Content-Disposition']).toContain('filename="a-main.jpg"');
  });

  it('uploader ikke igen naar filen er uaendret', async () => {
    const { id } = klartVaerk('a.png');
    const { kald, fetchImpl } = attrapShop();
    const m = new MediaSync({ catalog, client: klient(fetchImpl), exporter });
    await m.ensure(id, 'main', works.imageFile(id), 'alt');
    kald.length = 0;
    const igen = await m.ensure(id, 'main', works.imageFile(id), 'alt');
    expect(igen).toMatchObject({ id: 100, uploaded: false });
    expect(kald).toHaveLength(0);
  });

  it('opdaterer kun alt-teksten naar den er aendret', async () => {
    const { id } = klartVaerk('a.png');
    const { kald, fetchImpl } = attrapShop();
    const m = new MediaSync({ catalog, client: klient(fetchImpl), exporter });
    await m.ensure(id, 'main', works.imageFile(id), 'gammel');
    kald.length = 0;
    const res = await m.ensure(id, 'main', works.imageFile(id), 'ny');
    expect(res.uploaded).toBe(false);
    expect(kald.map((k) => `${k.method} ${k.sti}`)).toEqual(['POST /wp/v2/media/100']);
  });

  it('uploader igen naar filen er aendret siden sidst', async () => {
    const { id } = klartVaerk('a.png');
    const { fetchImpl } = attrapShop();
    const m = new MediaSync({ catalog, client: klient(fetchImpl), exporter });
    await m.ensure(id, 'main', works.imageFile(id), 'alt');
    const nyTid = new Date(Date.now() + 60_000);
    writeFileSync(join(root, 'a.png'), 'redigeret og laengere');
    utimesSync(join(root, 'a.png'), nyTid, nyTid);
    catalog.sync();
    // En aendret fil er ikke laengere faerdig; Stef goer den faerdig igen.
    const vid = catalog.listVersions({}).find((r) => r.image_id === id).version_id;
    catalog.setStage([vid], 'finished');
    const res = await m.ensure(id, 'main', works.imageFile(id), 'alt');
    expect(res).toMatchObject({ id: 101, uploaded: true });
  });

  it('uploader igen hvis mediet er slettet i WordPress', async () => {
    const { id } = klartVaerk('a.png');
    const forste = attrapShop();
    await new MediaSync({ catalog, client: klient(forste.fetchImpl), exporter })
      .ensure(id, 'main', works.imageFile(id), 'gammel');
    // Medie 100 findes ikke laengere. Aendret alt-tekst skal ikke fejle
    // paa det, men give en ny upload.
    const anden = attrapShop({ mediaSlettet: [100], startMedia: 200 });
    const m = new MediaSync({ catalog, client: klient(anden.fetchImpl), exporter });
    const res = await m.ensure(id, 'main', works.imageFile(id), 'ny');
    expect(res.uploaded).toBe(true);
    expect(anden.kald.some((k) => k.sti === '/wp/v2/media' && k.method === 'POST')).toBe(true);
  });
});

describe('formatet fra produkt 20', () => {
  // Alle ti felter, som referencefilen har dem. Vaerdierne her er dem
  // produkt 20 har, saa en forskel i raekkefoelge, UUID eller type fanges.
  const media = {
    main: { id: 21, url: 'https://shop.stefg.art/wp-content/uploads/Desert-Canyon-04.png' },
    crops: Object.fromEntries(['1:1', '2:3', '3:2', '1:2', '2:1'].map((f, i) => {
      const meta = reference.meta_data;
      const k = cropMetaKey(f);
      return [f, {
        id: Number(meta.find((m) => m.key === `${k}_attachment_id`).value),
        url: meta.find((m) => m.key === k).value,
        i,
      }];
    })),
    video: null,
  };
  const work = { template: 'spread', sectionColour: null, catalogueNumber: null, prints: true };

  it('skriver praecis de raekker produkt 20 har', () => {
    expect(acptMeta(work, media)).toEqual(reference.meta_data);
  });

  it('har UUID og type for alle felter som i referencen', () => {
    for (const f of ACPT_FIELDS) {
      const id = reference.meta_data.find((m) => m.key === `${f.key}_id`).value;
      const type = reference.meta_data.find((m) => m.key === `${f.key}_type`).value;
      expect([f.key, f.id, f.type]).toEqual([f.key, id, type]);
    }
  });

  it('tjekket passer paa produkt 20 og finder en aendret UUID, type eller manglende felt', () => {
    expect(compareFormat(reference)).toEqual([]);
    const aendret = JSON.parse(JSON.stringify(reference));
    aendret.meta_data.find((m) => m.key === 'work_template_id').value = 'andet';
    aendret.meta_data.find((m) => m.key === 'work_prints_type').value = 'Text';
    aendret.meta_data = aendret.meta_data.filter((m) => m.key !== 'work_crop_2x1_attachment_id');
    const fejl = compareFormat(aendret).join(' | ');
    expect(fejl).toMatch(/work_template has a different field id/);
    expect(fejl).toMatch(/work_prints is Text in the shop, not Toggle/);
    expect(fejl).toMatch(/no field work_crop_2x1_attachment_id/);
  });

  it('sender tomme felter naar vaerdien ikke er sat', () => {
    const m = acptMeta({ ...work, prints: false }, { main: { id: 1 }, crops: {}, video: null });
    const v = (k) => m.find((x) => x.key === k).value;
    expect(v('work_prints')).toBe('');
    expect(v('work_crop_2x3')).toBe('');
    expect(v('work_crop_2x3_attachment_id')).toBe('');
    expect(v('work_video_attachment_id')).toBe('');
    expect(v('work_crop_2x3_id')).toBe('cf2ee705-aed9-499b-b3bf-275e54b10222');
  });

  it('sender kun sektionsfarve og katalognummer naar Stef har skrevet dem', () => {
    const m = acptMeta({ ...work, sectionColour: '#aabbcc', catalogueNumber: '7' }, media);
    expect(m.find((x) => x.key === 'work_section_colour').value).toBe('#aabbcc');
    expect(m.find((x) => x.key === 'work_catalogue_number').value).toBe('7');
  });
});

describe('attributter', () => {
  const eksisterende = reference.attributes;
  const work = (over = {}) => ({
    technique: 'Digital art', unique: false, dimensions: null,
    effective: { year: 2025 }, ...over,
  });

  it('beholder printvarianternes attributter uroert', () => {
    const ud = mergeAttributes(eksisterende, work({ effective: { year: 2026 } }));
    expect(ud.map((a) => a.name)).toEqual(['Year', 'Technique', 'Format', 'Material', 'Frame', 'Size']);
    expect(ud.find((a) => a.name === 'Year').options).toEqual(['2026']);
    const format = ud.find((a) => a.name === 'Format');
    expect(format.variation).toBe(true);
    expect(format.options).toEqual(reference.attributes[2].options);
  });

  it('tilfoejer Year og Technique foerst paa et produkt der ingen har', () => {
    const ud = mergeAttributes([reference.attributes[2]], work());
    expect(ud.map((a) => a.name)).toEqual(['Year', 'Technique', 'Format']);
    expect(ud.map((a) => a.position)).toEqual([0, 1, 2]);
  });

  it('fjerner attributter appen ikke kender', () => {
    const fremmed = { id: 9, name: 'Colour', visible: true, variation: false, options: ['Red'] };
    const ud = mergeAttributes([...eksisterende, fremmed], work());
    expect(ud.map((a) => a.name)).toEqual(['Year', 'Technique', 'Format', 'Material', 'Frame', 'Size']);
  });

  it('fjerner en ejet attribut der er blevet tom, og kun den', () => {
    const ud = mergeAttributes(eksisterende, work({ technique: null }));
    expect(ud.map((a) => a.name)).not.toContain('Technique');
    expect(ud.map((a) => a.name)).toContain('Size');
  });

  it('tager maal med for et unikt vaerk og ellers ikke', () => {
    expect(mergeAttributes([], work({ unique: true, dimensions: '60 x 80 cm' })).map((a) => a.name))
      .toEqual(['Year', 'Technique', 'Dimensions']);
    expect(mergeAttributes([], work({ unique: false, dimensions: '60 x 80 cm' })).map((a) => a.name))
      .not.toContain('Dimensions');
  });
});

describe('produktet', () => {
  const baseWork = (over = {}) => ({
    imageId: 1, template: 'spread', sectionColour: null, catalogueNumber: null, prints: true,
    technique: 'Digital art', description: 'D', shortText: 'S', altText: 'A', category: 'Photography',
    unique: false, dimensions: null, price: null, effective: { title: 'Desert Canyon 04', year: 2021 },
    ...over,
  });
  const media = { main: { id: 100 }, crops: {}, video: null };

  it('opretter som kladde med de felter planen nævner', () => {
    const p = buildProduct(baseWork(), media, { categoryId: 7 });
    expect(p).toMatchObject({
      name: 'Desert Canyon 04', description: 'D', short_description: 'S',
      images: [{ id: 100 }], categories: [{ id: 7 }], status: 'draft', tax_class: '',
    });
    expect(p.attributes.map((a) => a.name)).toEqual(['Year', 'Technique']);
  });

  it('opretter et print-vaerk som variabelt produkt, som produkt 20', () => {
    expect(buildProduct(baseWork(), media).type).toBe('variable');
    expect(buildProduct(baseWork(), media).manage_stock).toBeUndefined();
  });

  it('roerer hverken status, type eller lager ved en opdatering', () => {
    const p = buildProduct(baseWork({ unique: true, category: 'Paintings', price: '1200', dimensions: '60 x 80 cm' }),
      media, { create: false });
    expect(p.status).toBeUndefined();
    expect(p.type).toBeUndefined();
    expect(p.manage_stock).toBeUndefined();
    expect(p.stock_quantity).toBeUndefined();
    expect(p.regular_price).toBe('1200');
  });

  it('goer et unikt vaerk til et simpelt produkt med 1 paa lager', () => {
    const p = buildProduct(baseWork({ unique: true, category: 'Paintings', price: '1200', dimensions: '60 x 80 cm' }), media);
    expect(p).toMatchObject({ type: 'simple', manage_stock: true, stock_quantity: 1, regular_price: '1200', tax_class: '' });
    expect(p.attributes.map((a) => a.name)).toContain('Dimensions');
  });

  it('giver skulpturer momsklassen Reduced rate', () => {
    const p = buildProduct(baseWork({ unique: true, category: 'Sculptures', price: '9000' }), media);
    expect(p.tax_class).toBe('reduced-rate');
  });

  it('sender ikke mål eller pris for et print-vaerk', () => {
    const p = buildProduct(baseWork({ dimensions: '10 x 10', price: '5' }), media);
    expect(p.regular_price).toBeUndefined();
    expect(p.attributes.map((a) => a.name)).not.toContain('Dimensions');
  });
});

describe('send til shop', () => {
  async function sync(fetchImpl) {
    return new ShopSync({ catalog, works, client: klient(fetchImpl), exporter });
  }
  const sti = (k) => `${k.method} ${k.sti}`;

  it('opretter produktet foerste gang og gemmer Woo-id', async () => {
    const { id } = klartVaerk('Desert Canyon 04.png');
    const { kald, fetchImpl } = attrapShop();
    const res = await (await sync(fetchImpl)).send(id);
    expect(res).toMatchObject({ productId: 500, status: 'draft', created: true });
    expect(works.get(id).wooProductId).toBe(500);
    const post = kald.find((k) => sti(k) === 'POST /wc/v3/products');
    expect(JSON.parse(post.body)).toMatchObject({
      name: 'Desert Canyon 04', status: 'draft', type: 'variable', categories: [{ id: 7 }],
    });
  });

  it('opdaterer samme produkt bagefter og laver ingen dublet', async () => {
    const { id } = klartVaerk('Desert Canyon 04.png');
    const { kald, fetchImpl } = attrapShop();
    const shop = await sync(fetchImpl);
    await shop.send(id);
    works.save(id, { description: 'Rettet' });
    kald.length = 0;
    const res = await shop.send(id);
    expect(res).toMatchObject({ productId: 500, created: false });
    expect(kald.filter((k) => sti(k) === 'POST /wc/v3/products')).toHaveLength(0);
    const put = kald.find((k) => k.method === 'PUT');
    expect(put.sti).toBe('/wc/v3/products/500');
    const body = JSON.parse(put.body);
    expect(body).toMatchObject({ description: 'Rettet' });
    expect(body.status).toBeUndefined();
    expect(body.type).toBeUndefined();
    expect(kald.some((k) => sti(k) === 'POST /wp/v2/media')).toBe(false);
  });

  it('sender printvarianternes attributter med ved en opdatering', async () => {
    const { id } = klartVaerk('Desert Canyon 04.png');
    works.setWooProductId(id, 500);
    const { kald, fetchImpl } = attrapShop({ attributter: reference.attributes });
    const shop = await sync(fetchImpl);
    await shop.send(id);
    const put = kald.find((k) => k.method === 'PUT');
    const navne = JSON.parse(put.body).attributes.map((a) => a.name);
    expect(navne).toEqual(['Year', 'Technique', 'Format', 'Material', 'Frame', 'Size']);
  });

  it('opretter produktet paa ny hvis det er slettet i Woo', async () => {
    const { id } = klartVaerk('Desert Canyon 04.png');
    works.setWooProductId(id, 77);
    const { kald, fetchImpl } = attrapShop({ slettetProdukter: [77] });
    const res = await (await sync(fetchImpl)).send(id);
    expect(res).toMatchObject({ created: true, productId: 500 });
    expect(works.get(id).wooProductId).toBe(500);
    expect(kald.some((k) => k.method === 'PUT')).toBe(false);
  });

  it('sender beskaeringerne med som medier og felter', async () => {
    const { id, vid } = klartVaerk('Desert Canyon 04.png');
    const kopi = catalog.createVirtualCopy(vid);
    works.setCrop(id, kopi, '2:3');
    const { kald, fetchImpl } = attrapShop();
    await (await sync(fetchImpl)).send(id);
    expect(kald.filter((k) => sti(k) === 'POST /wp/v2/media')).toHaveLength(2);
    const body = JSON.parse(kald.find((k) => sti(k) === 'POST /wc/v3/products').body);
    const v = (k) => body.meta_data.find((m) => m.key === k).value;
    expect(v('work_crop_2x3_attachment_id')).toBe('101');
    expect(v('work_crop_2x3')).toBe('https://shop.stefg.art/m/101.jpg');
    expect(v('work_crop_2x3_type')).toBe('Image');
  });

  it('opretter printvarianterne fra prislisten, og retter og sletter de gamle', async () => {
    const { id, vid } = klartVaerk('Desert Canyon 04.png');
    works.setCrop(id, catalog.createVirtualCopy(vid), '2:3');
    // Produkt 500 findes med en gammel variant der er i listen, og én der ikke er.
    works.setWooProductId(id, 500);
    const gamle = [{ id: 9001, sku: 'DC04-2X3-CANVAS-NO-40X60' }, { id: 9002, sku: 'DC04-2X3-FRAMEDPAPER-BLACK-40X60' }];
    const { kald, fetchImpl } = attrapShop({ varianter: { 500: gamle } });
    // Fake-produktet har ingen SKU, saa appen bruger sin egen (DC04).
    await (await sync(fetchImpl)).send(id);
    const put = JSON.parse(kald.find((k) => sti(k) === 'PUT /wc/v3/products/500').body);
    const navne = put.attributes.filter((a) => a.variation).map((a) => a.name);
    expect(navne).toEqual(['Format', 'Material', 'Frame', 'Size']);
    expect(put.attributes.find((a) => a.name === 'Format').options).toEqual(['Portrait 2:3']);
    const batch = kald.filter((k) => sti(k) === 'POST /wc/v3/products/500/variations/batch').map((k) => JSON.parse(k.body));
    const alle = { create: batch.flatMap((b) => b.create), update: batch.flatMap((b) => b.update), delete: batch.flatMap((b) => b.delete) };
    // 2:3 har 6 stoerrelser: papir, canvas og canvas med sort og hvid ramme.
    expect(alle.create.length + alle.update.length).toBe(24);
    expect(alle.delete).toEqual([9002]);
    const opdateret = alle.update.find((v) => v.id === 9001);
    expect(opdateret.regular_price).toBe('1900');
    expect(opdateret.manage_stock).toBe(false);
    expect(opdateret.stock_status).toBe('instock');
    expect(opdateret.meta_data.find((m) => m.key === 'prodigi_sku').value).toBe('GLOBAL-CAN-16X24');
    const sort = alle.create.find((v) => v.sku === 'DC04-2X3-CANVAS-BLACK-100X150');
    expect(sort.regular_price).toBe('6600');
    expect(sort.attributes).toEqual([
      { name: 'Format', option: 'Portrait 2:3' }, { name: 'Material', option: 'Canvas' },
      { name: 'Frame', option: 'Black' }, { name: 'Size', option: '100 × 150 cm' },
    ]);
  });

  it('vendte formater, de store canvas kun til Europa, og Update all prints', async () => {
    const { id, vid } = klartVaerk('Sand 1.png');
    works.setCrop(id, catalog.createVirtualCopy(vid), '3:2');
    works.setCrop(id, catalog.createVirtualCopy(vid), '1:1');
    works.setWooProductId(id, 500);
    const { kald, fetchImpl } = attrapShop();
    const res = await (await sync(fetchImpl)).opdaterAlleVarianter();
    expect(res.antal).toBe(1);
    const batch = kald.filter((k) => sti(k) === 'POST /wc/v3/products/500/variations/batch').flatMap((k) => JSON.parse(k.body).create);
    expect(batch.some((v) => v.attributes[3].option === '45 × 30 cm' && v.attributes[0].option === 'Landscape 3:2')).toBe(true);
    const stor = batch.filter((v) => v.attributes[3].option === '120 × 120 cm');
    expect(stor).toHaveLength(3); // ikke paa papir
    const meta = (v, k) => v.meta_data.find((m) => m.key === k).value;
    for (const v of stor) {
      expect(meta(v, 'ship_only_to').split(',')).toEqual(expect.arrayContaining(['DK', 'DE', 'GB', 'CH', 'NO']));
      expect(meta(v, 'ship_only_to')).not.toMatch(/US|JP/);
      expect(meta(v, 'hide_in_countries')).toBe('');
    }
    // 75 x 75 kan sendes som almindelig pakke og saelges overalt; 45 x 30 ogsaa.
    const lille = batch.filter((v) => ['75 × 75 cm', '45 × 30 cm'].includes(v.attributes[3].option));
    expect(lille.length).toBeGreaterThan(0);
    for (const v of lille) expect(meta(v, 'ship_only_to')).toBe('');
    // 3:2 vendt: 120 x 80 og 150 x 100 er ogsaa kun Europa.
    const vendt = batch.filter((v) => ['120 × 80 cm', '150 × 100 cm'].includes(v.attributes[3].option) && v.attributes[1].option === 'Canvas');
    expect(vendt.length).toBeGreaterThan(0);
    for (const v of vendt) expect(meta(v, 'ship_only_to')).toContain('DK');
    // Update all prints roerer ikke tekster og billeder.
    expect(kald.some((k) => sti(k) === 'POST /wp/v2/media')).toBe(false);
    const put = JSON.parse(kald.find((k) => sti(k) === 'PUT /wc/v3/products/500').body);
    expect(Object.keys(put)).toEqual(['attributes']);
  });

  it('nægter at sende et vaerk der ikke er klart, uden at kalde nettet', async () => {
    skriv('a.png');
    catalog.sync();
    const id = imageIdFor('a.png');
    const { kald, fetchImpl } = attrapShop();
    await expect((await sync(fetchImpl)).send(id)).rejects.toThrow(/Approved and Finished.*category.*description.*alt text/i);
    expect(kald).toHaveLength(0);
  });

  it('kraever pris paa et unikt vaerk', async () => {
    const { id } = klartVaerk('a.png', { category: 'Paintings' });
    const { fetchImpl } = attrapShop();
    await expect((await sync(fetchImpl)).send(id)).rejects.toThrow(/price/i);
  });

  it('siger fra hvis shoppen ikke har kategorien', async () => {
    const { id } = klartVaerk('a.png', { category: 'Graphic Design' });
    const { fetchImpl } = attrapShop();
    await expect((await sync(fetchImpl)).send(id)).rejects.toThrow(/Graphic Design/);
    expect(works.get(id).wooProductId).toBeNull();
  });

  it('udgiver kun et produkt der er sendt', async () => {
    const { id } = klartVaerk('a.png');
    const { kald, fetchImpl } = attrapShop();
    const shop = await sync(fetchImpl);
    await expect(shop.publish(id)).rejects.toThrow(/first/);
    await shop.send(id);
    kald.length = 0;
    expect(works.get(id).wooStatus).toBe('draft');
    expect(await shop.publish(id)).toMatchObject({ productId: 500, status: 'publish' });
    expect(JSON.parse(kald[0].body)).toEqual({ status: 'publish' });
    expect(works.get(id).wooStatus).toBe('publish');
  });

  it('spoerger foer et produkt med samme navn i shoppen opdateres, og laver ingen dublet', async () => {
    const { id } = klartVaerk('Desert Canyon 04.png');
    const { kald, fetchImpl } = attrapShop({ produkter: [{ id: 20, name: 'Desert Canyon 04', status: 'publish' }] });
    const shop = await sync(fetchImpl);
    const svar = await shop.send(id);
    expect(svar).toMatchObject({ needsConfirm: true, existing: { id: 20, name: 'Desert Canyon 04', status: 'publish' } });
    expect(kald.some((k) => k.method === 'POST' && k.sti === '/wc/v3/products')).toBe(false);
    expect(works.get(id).wooProductId).toBe(null);

    const res = await shop.send(id, { kobl: 20 });
    expect(res).toMatchObject({ productId: 20, created: false });
    expect(works.get(id).wooProductId).toBe(20);
    expect(kald.some((k) => k.method === 'POST' && k.sti === '/wc/v3/products')).toBe(false);
    expect(kald.some((k) => k.method === 'PUT' && k.sti === '/wc/v3/products/20')).toBe(true);
  });

  it('sender soegeordene som tags, og genbruger tags der findes', async () => {
    const { id } = klartVaerk('a.png');
    const fil = works.imageFile(id);
    catalog.saveKeywords(fil.id, [{ word: 'beach', score: 900 }, { word: 'blue', score: 899 }]);
    const { kald, fetchImpl } = attrapShop({ tags: [{ id: 42, name: 'Blue' }] });
    await (await sync(fetchImpl)).send(id);
    const post = kald.find((k) => k.method === 'POST' && k.sti === '/wc/v3/products');
    expect(JSON.parse(post.body).tags).toEqual([{ id: 701 }, { id: 42 }]);
    const nye = kald.filter((k) => k.method === 'POST' && k.sti === '/wc/v3/products/tags');
    expect(nye.map((k) => JSON.parse(k.body).name)).toEqual(['beach']);
  });

  it('toemmer tags og upsells i shoppen, naar vaerket ingen soegeord eller serie har', async () => {
    const { id } = klartVaerk('a.png');
    const { kald, fetchImpl } = attrapShop();
    await (await sync(fetchImpl)).send(id);
    const post = kald.find((k) => k.method === 'POST' && k.sti === '/wc/v3/products');
    expect(JSON.parse(post.body).tags).toEqual([]);
    expect(JSON.parse(post.body).upsell_ids).toEqual([]);
  });

  it('giver produktet en SKU som variant-SKU erne, og en anden hvis den er taget', async () => {
    expect(vaerkSku({ effective: { title: 'Desert Canyon 04', catalogueNumber: '04' } })).toBe('DC04');
    expect(vaerkSku({ effective: { title: 'Roofs 2', catalogueNumber: '2' } })).toBe('ROO2');
    expect(vaerkSku({ effective: { title: 'Ærø Havn', catalogueNumber: null } })).toBe('AH');
    const { id } = klartVaerk('Desert Canyon 04.png');
    const { kald, fetchImpl } = attrapShop({ optagneSku: ['DC04'] });
    const res = await (await sync(fetchImpl)).send(id);
    expect(res.created).toBe(true);
    const poster = kald.filter((k) => k.method === 'POST' && k.sti === '/wc/v3/products');
    expect(poster.map((k) => JSON.parse(k.body).sku)).toEqual(['DC04', `DC04-${id}`]);
  });

  it('linker seriens vaerker til hinanden som upsells', async () => {
    const a = klartVaerk('Sand 1.png').id;
    const b = klartVaerk('Sand 2.png').id;
    const serie = catalog.createSeries('Sand');
    catalog.assignSeries([a, b], serie);
    const { kald, fetchImpl } = attrapShop();
    const shop = await sync(fetchImpl);
    await shop.send(a); // produkt 500
    kald.length = 0;
    await shop.send(b); // produkt 501
    const post = kald.find((k) => k.method === 'POST' && k.sti === '/wc/v3/products');
    expect(JSON.parse(post.body).upsell_ids).toEqual([500]);
    const tilbage = kald.find((k) => k.method === 'PUT' && k.sti === '/wc/v3/products/500');
    expect(JSON.parse(tilbage.body)).toEqual({ upsell_ids: [501] });
  });

  it('husker hvad der blev sendt, saa appen kan se om vaerket er aendret siden', async () => {
    const { id } = klartVaerk('a.png');
    const { fetchImpl } = attrapShop();
    const shop = await sync(fetchImpl);
    await shop.send(id);
    const aftryk = () => vaerkAftryk(works.get(id), { works, catalog, ord: shop.ordFor(id) });
    expect(works.get(id).wooAftryk).toBe(aftryk());
    works.save(id, { description: 'En ny beskrivelse' });
    expect(works.get(id).wooAftryk).not.toBe(aftryk());
    await shop.send(id);
    expect(works.get(id).wooAftryk).toBe(aftryk());
    // Et nyt soegeord er ogsaa en aendring.
    catalog.addKeyword(works.imageFile(id).id, 'winter');
    expect(works.get(id).wooAftryk).not.toBe(aftryk());
  });

  it('fortaeller hvert skridt i en afsendelse', async () => {
    const { id } = klartVaerk('a.png');
    const { fetchImpl } = attrapShop();
    const trin = [];
    const shop = new ShopSync({ catalog, works, client: klient(fetchImpl), exporter, status: (t) => trin.push(t) });
    await shop.send(id);
    expect(trin[0]).toBe('Uploading the main picture');
    expect(trin).toContain('Creating the product');
    await shop.send(id);
    expect(trin.at(-1)).toBe('Saving the product');
  });

  it('Remove from shop goer produktet til en kladde, uden at slette det', async () => {
    const { id } = klartVaerk('a.png');
    const { kald, fetchImpl } = attrapShop();
    const shop = await sync(fetchImpl);
    await expect(shop.fjern(id)).rejects.toThrow(/not in the shop/);
    await shop.send(id);
    await shop.publish(id);
    kald.length = 0;
    expect(await shop.fjern(id)).toMatchObject({ productId: 500, status: 'draft' });
    expect(JSON.parse(kald[0].body)).toEqual({ status: 'draft' });
    expect(kald.some((k) => k.method === 'DELETE')).toBe(false);
    expect(works.get(id).wooStatus).toBe('draft');
  });

  it('henter status fra shoppen, og glemmer et produkt der er slettet', async () => {
    const a = klartVaerk('a.png').id;
    const b = klartVaerk('b.png').id;
    works.setWooProductId(a, 500);
    works.setWooProductId(b, 501);
    const { fetchImpl } = attrapShop({ status: { 500: 'publish' }, slettetProdukter: [501] });
    expect(await (await sync(fetchImpl)).opdaterStatus()).toEqual({ aendret: 2 });
    expect(works.get(a).wooStatus).toBe('publish');
    expect(works.get(b).wooProductId).toBe(null);
  });

  it('tjekker formatet mod produkt 20', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ...reference, name: 'Desert Canyon 04' }) });
    const res = await (await sync(fetchImpl)).checkFormat();
    expect(res).toEqual({ name: 'Desert Canyon 04', problems: [] });
  });
});

describe('serier', () => {
  async function sync(fetchImpl) {
    return new ShopSync({ catalog, works, client: klient(fetchImpl), exporter });
  }
  const sti = (k) => `${k.method} ${k.sti}`;

  function medSerie(rel, felter = {}) {
    const v = klartVaerk(rel);
    const serieId = catalog.createSeries('Desert Canyon');
    catalog.assignSeries([v.id], serieId);
    if (Object.keys(felter).length) catalog.setSeriesShop(serieId, felter);
    return { ...v, serieId };
  }

  it('opretter en ny serie med sine tre felter og saetter den paa produktet', async () => {
    const { id } = medSerie('a.png', { intro: 'Two lines', template: 'wall', colour: '#DD9933' });
    const { kald, fetchImpl } = attrapShop();
    await (await sync(fetchImpl)).send(id);
    const ny = kald.find((k) => sti(k) === 'POST /wp/v2/series');
    expect(JSON.parse(ny.body)).toEqual({
      name: 'Desert Canyon',
      meta: { series_data_series_template: 'wall', series_data_intro: 'Two lines', series_data_series_colour: '#dd9933' },
    });
    const prod = kald.find((k) => sti(k) === 'POST /wp/v2/product/500');
    expect(JSON.parse(prod.body)).toEqual({ series: [900] });
  });

  it('giver en ny serie skabelonen walkthrough naar Stef ikke har valgt en', async () => {
    const { id } = medSerie('a.png');
    const { kald, fetchImpl } = attrapShop();
    await (await sync(fetchImpl)).send(id);
    const ny = kald.find((k) => sti(k) === 'POST /wp/v2/series');
    expect(JSON.parse(ny.body).meta).toEqual({ series_data_series_template: 'walkthrough' });
  });

  it('bruger en serie der findes, uden at oprette en ny', async () => {
    const { id } = medSerie('a.png');
    const { kald, fetchImpl } = attrapShop({ serier: [{ id: 20, name: 'Desert Canyon', meta: {} }] });
    await (await sync(fetchImpl)).send(id);
    expect(kald.some((k) => sti(k) === 'POST /wp/v2/series')).toBe(false);
    expect(JSON.parse(kald.find((k) => sti(k) === 'POST /wp/v2/product/500').body)).toEqual({ series: [20] });
  });

  it('finder en serie paa navnet trods HTML-entiteter og store bogstaver', async () => {
    const v = klartVaerk('a.png');
    catalog.assignSeries([v.id], catalog.createSeries('Funky & Fire'));
    const { kald, fetchImpl } = attrapShop({ serier: [{ id: 31, name: 'funky &amp; FIRE', meta: {} }] });
    await (await sync(fetchImpl)).send(v.id);
    expect(kald.some((k) => sti(k) === 'POST /wp/v2/series')).toBe(false);
  });

  it('opdaterer kun de termfelter Stef har udfyldt og som er aendret', async () => {
    const { id } = medSerie('a.png', { intro: 'Ny intro', colour: '#dd9933' });
    const { kald, fetchImpl } = attrapShop({
      serier: [{ id: 20, name: 'Desert Canyon', meta: { series_data_intro: 'Gammel', series_data_series_colour: '#dd9933', series_data_series_template: 'wall' } }],
    });
    await (await sync(fetchImpl)).send(id);
    const opd = kald.filter((k) => sti(k) === 'POST /wp/v2/series/20');
    expect(opd).toHaveLength(1);
    expect(JSON.parse(opd[0].body)).toEqual({ meta: { series_data_intro: 'Ny intro' } });
  });

  it('roerer ikke serien i Woo naar vaerket ingen serie har i appen', async () => {
    const { id } = klartVaerk('a.png');
    const { kald, fetchImpl } = attrapShop();
    await (await sync(fetchImpl)).send(id);
    expect(kald.some((k) => k.sti.startsWith('/wp/v2/series') || k.sti.startsWith('/wp/v2/product/'))).toBe(false);
  });

  it('Update shop texts: genbruger WordPress\' privatlivsside, laver betingelserne og saetter kassen og mailen', async () => {
    const { kald, fetchImpl } = attrapShop({
      sider: [{ id: 3, slug: 'privacy-policy', status: 'draft' }],
      ukendteIndstillinger: ['woocommerce_enable_signup_and_login_from_checkout'],
    });
    const res = await (await sync(fetchImpl)).opdaterTekster();
    const privat = kald.find((k) => sti(k) === 'POST /wp/v2/pages/3');
    expect(JSON.parse(privat.body)).toMatchObject({ status: 'publish', title: 'Privacy policy' });
    expect(JSON.parse(privat.body).content).toContain('Datatilsynet');
    const vilkaar = JSON.parse(kald.find((k) => sti(k) === 'POST /wp/v2/pages').body);
    expect(vilkaar.slug).toBe('terms-and-conditions');
    expect(vilkaar.content).toContain('DK21935891');
    expect(vilkaar.content).toContain('EUR 400');
    expect(vilkaar.content).toContain('href="https://shop.stefg.art/privacy-policy/"');
    const indstilling = (id) => JSON.parse(kald.find((k) => k.method === 'PUT' && k.sti.endsWith(`/${id}`)).body).value;
    expect(Number(indstilling('woocommerce_terms_page_id'))).toBeGreaterThan(0);
    expect(indstilling('woocommerce_checkout_privacy_policy_text')).toMatch(/reserved on your card/);
    expect(indstilling('additional_content')).toMatch(/Model withdrawal form/);
    expect(indstilling('woocommerce_enable_guest_checkout')).toBe('yes');
    // En indstilling shoppen ikke kender, stopper ikke resten.
    expect(res.advarsler).toHaveLength(1);
    expect(res.betingelser).toBe('https://shop.stefg.art/terms-and-conditions/');
  });
});
