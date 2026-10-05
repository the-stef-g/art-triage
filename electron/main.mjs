// art-triage: hovedproces. Ejer vinduerne, de to custom-protokoller
// (app:// til bundtede filer, thumb:// til previews) og AI-vinduet.
import {
  app, BrowserWindow, Menu, protocol, ipcMain, net, nativeTheme, screen, shell,
  session as electronSession,
} from 'electron';
import {
  appendFileSync, statSync, renameSync, existsSync, readFileSync,
  writeFileSync, mkdirSync,
} from 'node:fs';
import { debounce } from './lib/util.mjs';
import { join, dirname, extname, normalize as pathNormalize } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Settings } from './lib/settings.mjs';
import { AiBridge } from './lib/aiBridge.mjs';
import { AppSession } from './lib/ipc.mjs';
import { parseWooKey, parseWpLogin } from './lib/shop.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');
const DEV_URL = process.env.VITE_DEV_SERVER_URL || null;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'thumb', privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'hfmodel', privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

let mainWin = null;
// To skjulte AI-vinduer, hvert i sin proces: billedmodellen og tekstmodellen
// indlaeses samtidig.
const aiWins = { image: null, text: null };
let session = null;
let ai = null;
let settings = null;
let aiLogPath = null;

// AI-fejl er svaere at se i en pakket app; alt fra AI-vinduet logges til
// en fil, som kan aabnes via Hjaelp-menuen.
function aiLog(line) {
  if (!aiLogPath) return;
  try {
    try {
      if (statSync(aiLogPath).size > 1024 * 1024) {
        renameSync(aiLogPath, `${aiLogPath}.old`);
      }
    } catch {
      // foerste skrivning
    }
    appendFileSync(aiLogPath, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // logning maa aldrig vaelte appen
  }
}

// Modellerne serveres for AI-vinduet paa en aegte https-adresse, fordi
// transformers.js afviser alle andre schemes i sine eksistenstjek.
const MODEL_HOST = 'billedflow-models.local';

function modelHeaders(relPath) {
  const headers = new Headers();
  headers.set('Content-Type', relPath.endsWith('.json') ? 'application/json' : 'application/octet-stream');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return headers;
}

// Modeldownload gennem hovedprocessen: ingen CORS, token ét sted,
// disk-cache og fuld logning af HTTP-status pr. kilde.
async function serveModelFile(pathname) {
  const relPath = String(pathname || '').replace(/^\/+/, '');
  if (!relPath || relPath.includes('..')) return new Response('', { status: 400 });
  const modelCacheDir = join(app.getPath('userData'), 'model-cache');
  const cacheFile = join(modelCacheDir, relPath.split('/').join('__'));
  if (existsSync(cacheFile)) {
    return new Response(readFileSync(cacheFile), { status: 200, headers: modelHeaders(relPath) });
  }
  const upstreams = [
    { base: 'https://huggingface.co/', navn: 'huggingface.co', token: settings.data.hfToken || null },
    { base: 'https://hf-mirror.com/', navn: 'hf-mirror.com', token: null },
  ];
  for (const up of upstreams) {
    try {
      const res = await net.fetch(up.base + relPath, {
        bypassCustomProtocolHandlers: true,
        headers: up.token ? { Authorization: `Bearer ${up.token}` } : {},
      });
      aiLog(`hfmodel GET ${relPath} -> ${res.status} (${up.navn})`);
      if (res.ok) {
        let buf = Buffer.from(await res.arrayBuffer());
        // transformers.js kender ikke modeltypen "siglip2", men
        // FixRes-arkitekturen er identisk med SigLIP v1. Omskriv
        // konfigurationsfilerne, saa biblioteket indlaeser modellen
        // som den v1-arkitektur den reelt er.
        if (relPath.endsWith('.json')) {
          const tekst = buf.toString('utf8');
          const rettet = tekst
            .replaceAll('"siglip2"', '"siglip"')
            .replaceAll('Siglip2', 'Siglip');
          if (rettet !== tekst) {
            aiLog(`hfmodel: tilpassede siglip2->siglip i ${relPath}`);
            buf = Buffer.from(rettet, 'utf8');
          }
        }
        mkdirSync(modelCacheDir, { recursive: true });
        const tmp = `${cacheFile}.tmp-${process.pid}`;
        writeFileSync(tmp, buf);
        renameSync(tmp, cacheFile);
        return new Response(buf, { status: 200, headers: modelHeaders(relPath) });
      }
    } catch (err) {
      aiLog(`hfmodel GET ${relPath} -> netværksfejl (${up.navn}): ${err?.message || err}`);
    }
  }
  return new Response('', { status: 404, headers: modelHeaders(relPath) });
}

function registerProtocols(proto) {
  proto.handle('app', async (req) => {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = pathNormalize(join(distDir, p));
    if (!file.startsWith(distDir)) return new Response('Ikke tilladt', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers();
      headers.set('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
      // CORP saa AI-vinduet (som er cross-origin-isoleret) maa hente assets.
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      if (p === '/ai.html') {
        // Cross-origin isolation giver SharedArrayBuffer og dermed
        // multitraadet WASM-inferens.
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      }
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('Ikke fundet', { status: 404 });
    }
  });

  proto.handle('hfmodel', (req) => {
    const url = new URL(req.url);
    return serveModelFile(decodeURIComponent(url.pathname));
  });

  proto.handle('thumb', async (req) => {
    const url = new URL(req.url);
    const fileId = Number(url.pathname.replace(/^\/+/, ''));
    const sizeParam = Number(url.searchParams.get('s'));
    const size = [512, 2048].includes(sizeParam) ? sizeParam : 512;
    const cat = session?.catalog;
    if (!cat || !Number.isFinite(fileId)) return new Response('', { status: 404 });
    const f = cat.getFile(fileId);
    if (!f || !f.present) return new Response('', { status: 404 });
    const thumbPath = await session.thumbs.ensure(f.id, f.mtime, cat.abs(f.rel_path), size);
    if (!thumbPath) return new Response('', { status: 404 });
    try {
      const res = await net.fetch(pathToFileURL(thumbPath).href);
      const headers = new Headers();
      headers.set('Content-Type', thumbPath.endsWith('.png') ? 'image/png' : 'image/jpeg');
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      // AI-vinduet henter previews med fetch fra en anden origin.
      headers.set('Access-Control-Allow-Origin', '*');
      // URL'en indeholder mtime (v=), saa svaret kan caches haardt.
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('', { status: 404 });
    }
  });
}

function pageUrl(page) {
  if (DEV_URL) return `${DEV_URL.replace(/\/$/, '')}/${page}`;
  return `app://bundle/${page}`;
}

// Gemte vinduesrammer bruges kun hvis de stadig rammer en skaerm.
function validBounds(b) {
  if (!b || typeof b.width !== 'number' || typeof b.x !== 'number') return null;
  const area = screen.getDisplayMatching(b).workArea;
  const overlapper = b.x < area.x + area.width && b.x + b.width > area.x
    && b.y < area.y + area.height && b.y + b.height > area.y;
  return overlapper ? b : null;
}

function createMainWindow() {
  const husket = validBounds(settings.data.windowBounds);
  mainWin = new BrowserWindow({
    width: husket?.width ?? 1440,
    height: husket?.height ?? 920,
    x: husket?.x,
    y: husket?.y,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#161618',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const gemBounds = debounce(() => {
    if (mainWin && !mainWin.isDestroyed() && !mainWin.isFullScreen() && !mainWin.isMinimized()) {
      settings.data.windowBounds = mainWin.getNormalBounds();
      settings.save();
    }
  }, 600);
  mainWin.on('resize', gemBounds);
  mainWin.on('move', gemBounds);
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.loadURL(pageUrl('index.html'));
  mainWin.on('closed', () => {
    mainWin = null;
    // AI-vinduet er usynligt, saa appen skal lukkes naar hovedvinduet gaar.
    if (!app.isQuitting) app.quit();
  });
  session.setWindow(mainWin);
}

function createAiWindow(role) {
  if (aiWins[role] && !aiWins[role].isDestroyed()) return;
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(here, 'ai-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // Egen session, saa https-kald til modelvaerten kan opfanges her
      // uden at roere hovedvinduets session.
      partition: 'persist:ai',
    },
  });
  aiWins[role] = win;
  win.loadURL(`${pageUrl('ai.html')}?role=${role}`);
  win.webContents.on('console-message', (event, level, message) => {
    const tekst = typeof message === 'string' ? message : event?.message ?? '';
    aiLog(`console[${role}]: ${tekst}`);
  });
  win.webContents.on('render-process-gone', () => {
    aiLog(`AI-processen (${role}) doede; genstarter`);
    ai.windowGone(role);
    const dead = aiWins[role];
    aiWins[role] = null;
    if (dead && !dead.isDestroyed()) dead.destroy();
    if (!app.isQuitting) setTimeout(() => createAiWindow(role), 1500);
  });
  ai.sendToWindow = (r, msg) => {
    const w = aiWins[r];
    if (w && !w.isDestroyed()) w.webContents.send('ai:job', msg);
  };
}

function createAiWindows() {
  createAiWindow('image');
  createAiWindow('text');
}

function restartAiWindow() {
  aiLog('AI-vinduerne genstartes (ny konfiguration)');
  for (const role of Object.keys(aiWins)) {
    const dead = aiWins[role];
    aiWins[role] = null;
    if (dead && !dead.isDestroyed()) dead.destroy();
  }
  ai.windowGone();
  if (!process.env.ART_TRIAGE_DISABLE_AI) createAiWindows();
}

// SVG-previews rasteriseres af Chromium i et usynligt vindue.
async function rasterizeSvg(absPath, size, outPath) {
  const win = new BrowserWindow({
    show: false,
    width: size,
    height: size,
    webPreferences: { offscreen: true },
  });
  try {
    await win.loadURL(pathToFileURL(absPath).href);
    await new Promise((r) => setTimeout(r, 150));
    const image = await win.webContents.capturePage();
    const resized = image.resize({ width: size });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPath, resized.toPNG());
  } finally {
    win.destroy();
  }
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: 'Art Triage',
          submenu: [
            { role: 'about', label: 'About Art Triage' },
            { type: 'separator' },
            { role: 'hide', label: 'Hide Art Triage' },
            { role: 'quit', label: 'Quit Art Triage' },
          ],
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        // Egne handlers: i tekstfelter laves tekst-fortryd, ellers
        // fortrydes seneste katalog-handling. Renderer afgoer.
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'undo' }),
        },
        {
          label: 'Redo',
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'redo' }),
        },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' },
      ],
    },

    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'toggleDevTools', label: 'Developer Tools' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Full Screen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimise' },
        { role: 'close', label: 'Close Window' },
      ],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          label: 'Show AI log',
          click: () => {
            if (aiLogPath) shell.showItemInFolder(aiLogPath);
          },
        },
        {
          label: 'Faster AI start (experimental)',
          type: 'checkbox',
          checked: Boolean(settings?.data?.aiFastText),
          click: (item) => {
            settings.data.aiFastText = item.checked;
            settings.save();
            aiLog(`faster AI start ${item.checked ? 'on' : 'off'}`);
            restartAiWindow();
          },
        },
        {
          label: 'Retry failed previews',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'retry-previews' }),
        },
        {
          label: 'Hugging Face token …',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'hf-token' }),
        },
        {
          label: 'WooCommerce key …',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'woo-key' }),
        },
        {
          label: 'WordPress application password …',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'wp-key' }),
        },
        {
          label: 'Claude API key …',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'claude-key' }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  settings = new Settings(app.getPath('userData'));
  aiLogPath = join(app.getPath('userData'), 'art-triage-ai.log');
  ai = new AiBridge(null);
  ai.on('status', (s) => aiLog(`status: ${s.state} ${s.progress ?? 0}% ${s.detail || ''}`));
  aiLog(`--- Art Triage ${app.getVersion()} startet (${process.platform}, Electron ${process.versions.electron}) ---`);
  session = new AppSession({ settings, ai, rasterizeSvg, log: aiLog });
  // Er sharp med i den pakkede app? Det er den foerste ting at se efter
  // naar en forhaandsvisning ikke kan laves.
  import('sharp')
    .then(() => aiLog(`sharp loaded (${process.platform}-${process.arch})`))
    .catch((err) => aiLog(`sharp could NOT be loaded (${process.platform}-${process.arch}): ${String(err?.message || err).slice(0, 300)}`));

  ipcMain.on('ai:msg', (event, msg) => {
    // Hvilket vindue beskeden kom fra afgoer rollen, ikke hvad beskeden siger.
    const role = Object.keys(aiWins).find((r) => aiWins[r] && event.sender === aiWins[r].webContents);
    if (role) ai.handleMessage({ ...msg, role });
  });
  ipcMain.handle('ai:init', () => ({
    hfToken: settings.data.hfToken || null,
    // Proeve af tekstmodellens start uden grafoptimering, se menuen.
    textGraphOptimization: settings.data.aiFastText ? 'disabled' : null,
  }));
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    hfToken: settings.data.hfToken || null,
    // Noeglen selv sendes aldrig til UI'et. Der er kun brug for at vide,
    // om der staar en, saa knappen kan sige det rigtige.
    harClaudeKey: Boolean(settings.data.claudeKey),
    harWooKey: Boolean(settings.data.wooKey),
    harWpKey: Boolean(settings.data.wpUser),
  }));
  ipcMain.handle('app:setHfToken', (_event, payload) => {
    settings.data.hfToken = String(payload?.token || '').trim() || null;
    settings.save();
    aiLog(`Hugging Face-token ${settings.data.hfToken ? 'sat' : 'fjernet'}`);
    restartAiWindow();
  });
  ipcMain.handle('app:setClaudeKey', (_event, payload) => {
    settings.data.claudeKey = String(payload?.key || '').trim() || null;
    settings.save();
    // Noeglen skrives aldrig i loggen, kun om der nu er en.
    aiLog(`Claude-API-noegle ${settings.data.claudeKey ? 'sat' : 'fjernet'}`);
    session.resetKeywordService();
    return { harClaudeKey: Boolean(settings.data.claudeKey) };
  });

  // De to shop-noegler behandles som Claude-noeglen: de gemmes, og kun
  // om de findes meldes tilbage. En tom indtastning fjerner dem.
  ipcMain.handle('app:setWooKey', (_event, payload) => {
    const tekst = String(payload?.key || '').trim();
    const { key, secret } = tekst ? parseWooKey(tekst) : { key: null, secret: null };
    settings.data.wooKey = key;
    settings.data.wooSecret = secret;
    settings.save();
    aiLog(`WooCommerce-noegle ${key ? 'sat' : 'fjernet'}`);
    return { harWooKey: Boolean(key) };
  });
  ipcMain.handle('app:setWpKey', (_event, payload) => {
    const tekst = String(payload?.key || '').trim();
    const { user, password } = tekst ? parseWpLogin(tekst) : { user: null, password: null };
    settings.data.wpUser = user;
    settings.data.wpPassword = password;
    settings.save();
    aiLog(`WordPress-adgangskode ${user ? 'sat' : 'fjernet'}`);
    return { harWpKey: Boolean(user) };
  });

  registerProtocols(protocol);
  // AI-vinduets egen session: samme protokoller plus https-opfangning
  // af modelvaerten; alt andet https passerer uroert igennem.
  const aiSession = electronSession.fromPartition('persist:ai');
  registerProtocols(aiSession.protocol);
  aiSession.protocol.handle('https', (req) => {
    const url = new URL(req.url);
    if (url.hostname === MODEL_HOST) {
      return serveModelFile(decodeURIComponent(url.pathname));
    }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
  session.registerIpc();
  buildMenu();
  createMainWindow();
  // ART_TRIAGE_DISABLE_AI=1 bruges i CI, hvor modeldownload ikke giver mening.
  if (!process.env.ART_TRIAGE_DISABLE_AI) createAiWindows();
  // ART_TRIAGE_OPEN aabner et bibliotek direkte uden dialog (tests).
  if (process.env.ART_TRIAGE_OPEN) {
    session.openLibrary(process.env.ART_TRIAGE_OPEN).catch(() => {});
  }

  app.on('activate', () => {
    if (!mainWin) createMainWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  // Synkron oprydning: databasen er committet loebende, og at vente paa
  // watcher-lukning kan haenge paa macOS og blokere Cmd+Q.
  if (session) {
    const s = session;
    session = null;
    s.closeQuick();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
