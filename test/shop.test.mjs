// Send til shop (docs/plan-shop.md). Intet her rammer et rigtigt netvaerk:
// shoppen er en attrap. Testene holder oeje med det der koster noget hvis
// det gaar galt: dubletter i Woo, genupload af store filer, noegler der
// ender i en fejlbesked, og at en opdatering ikke roerer lager eller status.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../electron/lib/db.mjs';
import { Catalog } from '../electron/lib/catalog.mjs';
import { Works } from '../electron/lib/works.mjs';
import {
  ShopClient, ShopSync, MediaSync, ShopError, parseWooKey, parseWpLogin,
  buildProduct, acptMeta, cropMetaKey,
} from '../electron/lib/shop.mjs';

let root;
let db;
let catalog;
let works;

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
    if (init.method === 'POST' && sti === '/wc/v3/products') {
      return svar(201, { id: nextProduct++, status: 'draft', permalink: 'https://shop.stefg.art/p' });
    }
    if (init.method === 'PUT' && sti.startsWith('/wc/v3/products/')) {
      return svar(200, { id: Number(sti.split('/').pop()), status: JSON.parse(init.body).status || 'draft' });
    }
    return svar(404, { message: 'no route' });
  };
  return { kald, fetchImpl };
}

const exporter = async () => Buffer.from('jpeg');

function klient(fetchImpl) {
  return new ShopClient({
    baseUrl: 'https://shop.stefg.art/',
    wooKey: 'ck_hemmelig', wooSecret: 'cs_hemmelig', wpUser: 'stef', wpPassword: 'abcd efgh',
    fetchImpl,
  });
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

describe('produktet', () => {
  const baseWork = (over = {}) => ({
    imageId: 1, template: 'spread', sectionColour: null, prints: true, technique: 'Digital art',
    description: 'D', shortText: 'S', altText: 'A', category: 'Photography', unique: false,
    dimensions: null, price: null, effective: { title: 'Desert Canyon 04', year: 2021, catalogueNumber: '04' },
    ...over,
  });
  const media = { main: { id: 100 }, crops: { '2:3': { id: 101 } }, video: null };

  it('opretter som kladde med de felter planen nævner', () => {
    const p = buildProduct(baseWork(), media, { categoryId: 7 });
    expect(p).toMatchObject({
      name: 'Desert Canyon 04', description: 'D', short_description: 'S',
      images: [{ id: 100 }], categories: [{ id: 7 }], status: 'draft',
    });
    expect(p.attributes).toEqual([
      { name: 'Year', visible: true, options: ['2021'] },
      { name: 'Technique', visible: true, options: ['Digital art'] },
    ]);
  });

  it('roerer hverken status eller lager ved en opdatering', () => {
    const p = buildProduct(baseWork({ unique: true, category: 'Paintings', price: '1200', dimensions: '60 x 80 cm' }),
      media, { create: false });
    expect(p.status).toBeUndefined();
    expect(p.manage_stock).toBeUndefined();
    expect(p.stock_quantity).toBeUndefined();
    expect(p.type).toBeUndefined();
    expect(p.regular_price).toBe('1200');
  });

  it('goer et unikt vaerk til et simpelt produkt med 1 paa lager', () => {
    const p = buildProduct(baseWork({ unique: true, category: 'Paintings', price: '1200', dimensions: '60 x 80 cm' }), media);
    expect(p).toMatchObject({ type: 'simple', manage_stock: true, stock_quantity: 1, regular_price: '1200' });
    expect(p.attributes.map((a) => a.name)).toContain('Dimensions');
    expect(p.tax_class).toBeUndefined();
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

  it('bruger noeglerne fra planen i meta_data', () => {
    expect(cropMetaKey('1:1')).toBe('work_crop_1x1');
    expect(cropMetaKey('2:1')).toBe('work_crop_2x1');
    const keys = acptMeta(baseWork(), media).map((m) => m.key);
    expect(keys).toEqual([
      'work_template', 'work_section_colour', 'work_catalogue_number', 'work_video', 'work_prints',
      'work_crop_1x1', 'work_crop_2x3', 'work_crop_3x2', 'work_crop_1x2', 'work_crop_2x1',
    ]);
    const crop = acptMeta(baseWork(), media).find((m) => m.key === 'work_crop_2x3');
    expect(crop.value).toBe('101');
  });
});

describe('send til shop', () => {
  async function sync(fetchImpl) {
    return new ShopSync({ catalog, works, client: klient(fetchImpl), exporter });
  }

  it('opretter produktet foerste gang og gemmer Woo-id', async () => {
    const { id } = klartVaerk('Desert Canyon 04.png');
    const { kald, fetchImpl } = attrapShop();
    const res = await (await sync(fetchImpl)).send(id);
    expect(res).toMatchObject({ productId: 500, status: 'draft', created: true });
    expect(works.get(id).wooProductId).toBe(500);
    const post = kald.find((k) => k.method === 'POST' && k.sti === '/wc/v3/products');
    expect(JSON.parse(post.body)).toMatchObject({ name: 'Desert Canyon 04', status: 'draft', categories: [{ id: 7 }] });
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
    expect(kald.filter((k) => k.method === 'POST' && k.sti === '/wc/v3/products')).toHaveLength(0);
    const put = kald.find((k) => k.method === 'PUT');
    expect(put.sti).toBe('/wc/v3/products/500');
    expect(JSON.parse(put.body)).toMatchObject({ description: 'Rettet' });
    expect(JSON.parse(put.body).status).toBeUndefined();
    expect(kald.some((k) => k.sti === '/wp/v2/media' && k.method === 'POST')).toBe(false);
  });

  it('sender beskaeringerne med som medier og felter', async () => {
    const { id, vid } = klartVaerk('Desert Canyon 04.png');
    const kopi = catalog.createVirtualCopy(vid);
    works.setCrop(id, kopi, '2:3');
    const { kald, fetchImpl } = attrapShop();
    await (await sync(fetchImpl)).send(id);
    const uploads = kald.filter((k) => k.method === 'POST' && k.sti === '/wp/v2/media');
    expect(uploads).toHaveLength(2);
    const body = JSON.parse(kald.find((k) => k.sti === '/wc/v3/products' && k.method === 'POST').body);
    expect(body.meta_data.find((m) => m.key === 'work_crop_2x3').value).toBe('101');
  });

  it('nægter at sende et vaerk der ikke er klart, uden at kalde nettet', async () => {
    skriv('a.png');
    catalog.sync();
    const id = imageIdFor('a.png');
    const { kald, fetchImpl } = attrapShop();
    const shop = await sync(fetchImpl);
    await expect(shop.send(id)).rejects.toThrow(/Approved and Finished.*category.*description.*alt text/i);
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
    expect(await shop.publish(id)).toMatchObject({ productId: 500, status: 'publish' });
    expect(JSON.parse(kald[0].body)).toEqual({ status: 'publish' });
  });
});
