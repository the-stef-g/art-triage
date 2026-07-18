// Billedflow: hovedproces. Ejer vinduerne, de to custom-protokoller
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
let aiWin = null;
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

function createAiWindow() {
  if (aiWin && !aiWin.isDestroyed()) return;
  aiWin = new BrowserWindow({
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
  aiWin.loadURL(pageUrl('ai.html'));
  aiWin.webContents.on('console-message', (event, level, message) => {
    const tekst = typeof message === 'string' ? message : event?.message ?? '';
    aiLog(`console: ${tekst}`);
  });
  aiWin.webContents.on('render-process-gone', () => {
    aiLog('AI-processen doede; genstarter');
    ai.windowGone();
    const dead = aiWin;
    aiWin = null;
    if (dead && !dead.isDestroyed()) dead.destroy();
    if (!app.isQuitting) setTimeout(() => createAiWindow(), 1500);
  });
  ai.sendToWindow = (msg) => {
    if (aiWin && !aiWin.isDestroyed()) aiWin.webContents.send('ai:job', msg);
  };
}

// Genstarter AI-vinduet, fx efter at en Hugging Face-token er sat.
function restartAiWindow() {
  aiLog('AI-vinduet genstartes (ny konfiguration)');
  if (aiWin && !aiWin.isDestroyed()) {
    const dead = aiWin;
    aiWin = null;
    dead.destroy();
  }
  ai.windowGone();
  if (!process.env.BILLEDFLOW_DISABLE_AI) createAiWindow();
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
          label: 'Billedflow',
          submenu: [
            { role: 'about', label: 'Om Billedflow' },
            { type: 'separator' },
            { role: 'hide', label: 'Skjul Billedflow' },
            { role: 'quit', label: 'Slut Billedflow' },
          ],
        }]
      : []),
    {
      label: 'Rediger',
      submenu: [
        // Egne handlers: i tekstfelter laves tekst-fortryd, ellers
        // fortrydes seneste katalog-handling. Renderer afgoer.
        {
          label: 'Fortryd',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'undo' }),
        },
        {
          label: 'Gentag',
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'redo' }),
        },
        { type: 'separator' },
        { role: 'cut', label: 'Klip' },
        { role: 'copy', label: 'Kopier' },
        { role: 'paste', label: 'Sæt ind' },
        { role: 'selectAll', label: 'Vælg alt' },
      ],
    },

    {
      label: 'Vis',
      submenu: [
        { role: 'reload', label: 'Genindlæs' },
        { role: 'toggleDevTools', label: 'Udviklerværktøjer' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Fuld skærm' },
      ],
    },
    {
      label: 'Vindue',
      submenu: [
        { role: 'minimize', label: 'Minimer' },
        { role: 'close', label: 'Luk vindue' },
      ],
    },
    {
      label: 'Hjælp',
      role: 'help',
      submenu: [
        {
          label: 'Vis AI-log',
          click: () => {
            if (aiLogPath) shell.showItemInFolder(aiLogPath);
          },
        },
        {
          label: 'Hugging Face-token …',
          click: () => mainWin?.webContents.send('evt', { type: 'genvej', cmd: 'hf-token' }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  settings = new Settings(app.getPath('userData'));
  aiLogPath = join(app.getPath('userData'), 'billedflow-ai.log');
  ai = new AiBridge(null);
  ai.on('status', (s) => aiLog(`status: ${s.state} ${s.progress ?? 0}% ${s.detail || ''}`));
  aiLog(`--- Billedflow ${app.getVersion()} startet (${process.platform}, Electron ${process.versions.electron}) ---`);
  session = new AppSession({ settings, ai, rasterizeSvg });

  ipcMain.on('ai:msg', (event, msg) => {
    if (aiWin && event.sender === aiWin.webContents) ai.handleMessage(msg);
  });
  ipcMain.handle('ai:init', () => ({ hfToken: settings.data.hfToken || null }));
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    hfToken: settings.data.hfToken || null,
  }));
  ipcMain.handle('app:setHfToken', (_event, payload) => {
    settings.data.hfToken = String(payload?.token || '').trim() || null;
    settings.save();
    aiLog(`Hugging Face-token ${settings.data.hfToken ? 'sat' : 'fjernet'}`);
    restartAiWindow();
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
  // BILLEDFLOW_DISABLE_AI=1 bruges i CI, hvor modeldownload ikke giver mening.
  if (!process.env.BILLEDFLOW_DISABLE_AI) createAiWindow();
  // BILLEDFLOW_OPEN aabner et bibliotek direkte uden dialog (tests).
  if (process.env.BILLEDFLOW_OPEN) {
    session.openLibrary(process.env.BILLEDFLOW_OPEN).catch(() => {});
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
