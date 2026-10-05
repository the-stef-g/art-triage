// Maaler brugerfladens del af en aendring: hvor laenge griddet er optaget,
// naar kataloget melder 'changed', naar man skifter filter, og naar man
// markerer et billede. Starter den byggede brugerflade i Chromium med en
// attrap af Electron-broen, saa hovedprocessen ikke tager tid med i tallet.
//
//   npm run build && node scripts/bench-ui.mjs [antal]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const antal = Number(process.argv.find((a) => /^\d+$/.test(a))) || 15000;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPER = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };

const server = createServer((req, res) => {
  const sti = join(dist, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(sti)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPER[extname(sti)] || 'application/octet-stream' });
  res.end(readFileSync(sti));
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

await page.addInitScript((n) => {
  const rows = Array.from({ length: n }, (_, i) => ({
    version_id: i + 1, image_id: i + 1, version_name: 'Original', is_master: 1,
    rating: i % 3 === 0 ? 'godkendt' : 'ubedomt', edited: 0, finished: 0,
    file_id: i + 1, rel_path: `mappe-${i % 150}/Billede ${i + 1}.jpg`, mtime: 1000 + i, size: 1000,
    series_id: null, series_name: null, version_count: 1,
  }));
  const tree = { name: 'bib', rel: '', counts: { godkendt: 1, kandidat: 0, kasseret: 0, ubedomt: 1 }, count: n,
    children: Array.from({ length: 150 }, (_, i) => ({ name: `mappe-${i}`, rel: `mappe-${i}`, children: [],
      counts: { godkendt: 1, kandidat: 0, kasseret: 0, ubedomt: 1 }, count: 100 })) };
  const kw = Array.from({ length: 500 }, (_, i) => ({ word: `ord${i}`, antal: 500 - i }));
  const svar = {
    'app:info': { version: 'bench' }, 'lib:current': { root: '/b' }, 'lib:recent': [],
    'ed:list': [], 'ser:list': [], 'fold:tree': tree, 'kw:top': kw,
    'kw:status': { harKey: false, koe: 0, modeller: [], model: 'm' }, 'shop:status': {},
    'search:status': { ai: null, index: null }, 'img:imageVersions': [], 'kw:forFile': [],
    'work:get': null,
  };
  const lyttere = [];
  window.__kald = {};
  window.artTriage = {
    invoke(kanal) {
      window.__kald[kanal] = (window.__kald[kanal] || 0) + 1;
      if (kanal === 'img:list') {
        return Promise.resolve({ rows: rows.slice(), counts: { total: n, byRating: {}, indexed: 0 }, searchInfo: null });
      }
      return Promise.resolve(svar[kanal] ?? null);
    },
    onEvent(cb) { lyttere.push(cb); return () => {}; },
  };
  window.__send = (evt) => lyttere.forEach((cb) => cb(evt));
  window.__langeOpgaver = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__langeOpgaver.push(e.duration)))
    .observe({ entryTypes: ['longtask'] });
}, antal);

const venteTilRo = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 50)))));
async function maal(navn, handling, gange = 5) {
  const tider = [];
  const opgaver = [];
  for (let i = 0; i < gange; i++) {
    await page.evaluate(() => { window.__langeOpgaver = []; });
    const t = await page.evaluate(async (h) => {
      const s = performance.now();
      // eslint-disable-next-line no-eval
      await eval(h);
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      return performance.now() - s;
    }, handling);
    tider.push(t);
    opgaver.push(await page.evaluate(() => window.__langeOpgaver.reduce((a, b) => a + b, 0)));
    await venteTilRo();
  }
  tider.sort((a, b) => a - b);
  console.log(`${navn.padEnd(56)} ${tider[Math.floor(tider.length / 2)].toFixed(0).padStart(6)} ms`);
}

const t0 = Date.now();
await page.goto(`http://localhost:${port}/`);
await page.waitForSelector('.tile', { timeout: 60000 });
console.log(`${antal} billeder\n`);
console.log(`${'foerste visning af griddet'.padEnd(56)} ${String(Date.now() - t0).padStart(6)} ms`);
await venteTilRo();

await maal("katalogets 'changed' (refresh + sidepanel)", "window.__send({type:'changed'})");
await maal("katalogets 'changed' x5 i traek", "[1,2,3,4,5].forEach(()=>window.__send({type:'changed'}))");
await maal('skift filter (klik paa Approved)', "document.querySelector('.chip-filter, .filterchip, [data-filter]')?.click() ?? 0");
await maal('markér et billede (klik paa en flise)', "document.querySelectorAll('.tile')[3].click()");
await maal('naeste billede (pil hoejre)', "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");

const kald = await page.evaluate(() => window.__kald);
console.log('\nIPC-kald i alt under maalingen:');
console.log(Object.entries(kald).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
await browser.close();
server.close();
