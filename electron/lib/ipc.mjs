// Session-laget: ejer det aabne bibliotek (database, katalog, thumbnails,
// watcher, indeksering) og registrerer alle IPC-handlers som UI'et kalder.
import { ipcMain, dialog, shell } from 'electron';
import { join } from 'node:path';
import { openDatabase } from './db.mjs';
import { Catalog } from './catalog.mjs';
import { Thumbnailer } from './thumbs.mjs';
import { watchLibrary } from './watcher.mjs';
import { detectEditors, openInApp } from './editors.mjs';
import { SearchIndex, normalize } from './searchIndex.mjs';
import { Indexer, MODEL_ID } from './indexer.mjs';
import { UndoManager } from './undo.mjs';
import { debounce } from './util.mjs';

// Mappe-overvaageren (chokidar) faar sjaeldent fil-system-haendelser fra
// eksterne drev paa macOS, og Stefs billeder ligger netop eksternt. Den
// periodiske genskanning er derfor ikke et sikkerhedsnet men den baerende
// mekanisme: uden den dukker nye filer foerst op efter en genstart.
const RESCAN_MIN_MS = 90_000;
// Et langsomt drev maa ikke ende med at skanne i et vaek. Naeste skanning
// planlaegges tidligst naar der er gaaet ti gange saa lang tid som den
// forrige tog, saa skanningen hoejst fylder en tiendedel af tiden.
const RESCAN_DUTY = 10;

export class AppSession {
  constructor({ settings, ai, rasterizeSvg }) {
    this.settings = settings;
    this.ai = ai;
    this.rasterizeSvg = rasterizeSvg;
    this.win = null;
    this.db = null;
    this.catalog = null;
    this.thumbs = null;
    this.watcher = null;
    this.searchIndex = null;
    this.indexer = null;
    this.scanTimer = null;
    this.scanning = false;
    this.driveMissing = false;
    this.lastScanMs = 0;

    this.ai.on('status', (status) => {
      this.broadcast('ai', { status });
      if (status.state === 'klar' && this.indexer) {
        // AI-vinduet melder hvilken model den faktisk fik indlaest;
        // katalog og soegeindeks skal foelge med.
        if (status.modelId) {
          this.searchIndex.setModel(status.modelId);
          this.indexer.setModel(status.modelId);
        }
        this.indexer.kick();
      }
    });
  }

  setWindow(win) {
    this.win = win;
  }

  broadcast(type, payload = {}) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('evt', { type, ...payload });
    }
  }

  // Alle synkroniseringer gaar gennem her, uanset om de kommer fra
  // watcheren, fra uret eller fra "Skan igen"-knappen. To skanninger maa
  // aldrig koere oven i hinanden: en fuld gennemgang af et stort
  // bibliotek paa et eksternt drev tager tid, og to ad gangen ville bare
  // traekke hinanden ned.
  runSync(reason = 'auto') {
    if (!this.catalog) return { skipped: true, reason };
    if (this.scanning) return { skipped: true, reason };
    this.scanning = true;
    const start = Date.now();
    let res;
    try {
      res = this.catalog.sync();
    } catch {
      // En enkelt mislykket skanning maa ikke vaelte noget; uret proever igen.
      res = { changed: 0, edited: 0, unavailable: false };
    } finally {
      this.scanning = false;
    }
    this.lastScanMs = Date.now() - start;
    this._reportDrive(Boolean(res.unavailable));
    return { ...res, skipped: false, reason, varighed: this.lastScanMs };
  }

  // Melder kun naar tilstanden skifter, saa statuslinjen ikke blinker
  // ved hver eneste skanning.
  _reportDrive(missing) {
    if (missing === this.driveMissing) return;
    this.driveMissing = missing;
    this.broadcast('drev', { missing, root: this.catalog?.root ?? null });
  }

  // Kaeder sig selv frem i stedet for at bruge et fast interval, saa et
  // langsomt drev automatisk faar laengere mellem skanningerne.
  _scheduleScan() {
    clearTimeout(this.scanTimer);
    const delay = Math.max(RESCAN_MIN_MS, (this.lastScanMs || 0) * RESCAN_DUTY);
    this.scanTimer = setTimeout(() => {
      this.runSync('ur');
      this._scheduleScan();
    }, delay);
    // Uret maa hverken holde appen vaagen eller forsinke en afslutning.
    this.scanTimer.unref?.();
  }

  _stopScanTimer() {
    clearTimeout(this.scanTimer);
    this.scanTimer = null;
  }

  async openLibrary(root) {
    await this.closeLibrary();
    const dataDir = join(root, '.billedflow');
    this.db = await openDatabase(join(dataDir, 'katalog.sqlite'));
    this.catalog = new Catalog(this.db, root);
    this.thumbs = new Thumbnailer({
      cacheDir: join(dataDir, 'cache'),
      rasterizeSvg: this.rasterizeSvg,
    });
    this.searchIndex = new SearchIndex(this.catalog, MODEL_ID);
    this.undoMgr = new UndoManager(this.catalog);
    this.indexer = new Indexer({
      catalog: this.catalog,
      thumbs: this.thumbs,
      ai: this.ai,
      searchIndex: this.searchIndex,
    });

    const sendChanged = debounce(() => this.broadcast('changed'), 150);
    this.catalog.on('changed', () => {
      sendChanged();
      if (this.indexer) this.indexer.kick();
    });
    this.catalog.on('files-edited', (fileIds) => {
      this.indexer.invalidateFiles(fileIds);
    });
    this.indexer.on('progress', (progress) => this.broadcast('index', { progress }));

    // Genberegner noegleord fra de gemte embeddings naar logik eller
    // feedback er aendret (ren matematik, ingen AI). Debounced, saa hurtige
    // rettelser i traek ikke koerer den mange gange.
    this._recompute = debounce(() => {
      try {
        this.indexer?.recomputeKeywords();
      } catch {
        // noegleord genberegnes ved naeste lejlighed
      }
    }, 400);

    this.driveMissing = false;
    this.lastScanMs = 0;
    this.runSync('aabning');
    try {
      this.indexer.recomputeKeywords();
    } catch {
      // noegleord genberegnes ved naeste lejlighed
    }
    // Watcheren beholdes: paa interne diske er den oejeblikkelig. Paa
    // eksterne drev tier den, og der er det uret nedenfor der leverer.
    this.watcher = watchLibrary(root, () => this.runSync('watcher'));
    this._scheduleScan();
    this.settings.rememberLibrary(root);
    this.broadcast('library', { root });
    this.indexer.kick();
    return { root };
  }

  // Hurtig, synkron lukning til quit: venter ikke paa watcheren.
  closeQuick() {
    this._stopScanTimer();
    try { this.indexer?.stop(); } catch { /* ligegyldigt ved quit */ }
    if (this.watcher) {
      this.watcher.close().catch(() => {});
      this.watcher = null;
    }
    try { this.db?.close(); } catch { /* ligegyldigt ved quit */ }
    this.db = null;
    this.catalog = null;
    this.thumbs = null;
    this.searchIndex = null;
    this.indexer = null;
  }

  async closeLibrary() {
    this._stopScanTimer();
    if (this.watcher) {
      await this.watcher.close().catch(() => {});
      this.watcher = null;
    }
    if (this.indexer) {
      this.indexer.stop();
      this.indexer = null;
    }
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // luk maa ikke vaelte appen
      }
      this.db = null;
    }
    this.catalog = null;
    this.thumbs = null;
    this.searchIndex = null;
    this.undoMgr = null;
  }

  requireCatalog() {
    if (!this.catalog) throw new Error('Intet bibliotek er åbent');
    return this.catalog;
  }

  // Fritekst-soegning: foerst filer hvis noegleord matcher teksten
  // (auto eller manuelle), dernaest semantiske match fra indekset.
  async runSearch(text) {
    const catalog = this.requireCatalog();
    const keywordIds = catalog.filesWithKeywordLike(text);
    let semantiske = [];
    let advarsel = null;
    if (this.ai.ready) {
      this.searchIndex.ensureLoaded();
      if (this.searchIndex.size()) {
        const qvec = normalize(await this.ai.embedText(text));
        semantiske = this.searchIndex.query(qvec).map((h) => h.fileId);
      }
    } else if (!keywordIds.length) {
      advarsel = 'Søgning er klar når AI-modellen er hentet';
    }
    const set = new Set(keywordIds);
    const fileIds = [...keywordIds, ...semantiske.filter((id) => !set.has(id))];
    if (!fileIds.length && advarsel) return { error: advarsel };
    return { fileIds };
  }

  registerIpc() {
    const handle = (channel, fn) => {
      ipcMain.handle(channel, async (_event, payload) => fn(payload ?? {}));
    };

    handle('lib:choose', async () => {
      const res = await dialog.showOpenDialog(this.win, {
        title: 'Vælg billedmappe',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths.length) return null;
      return this.openLibrary(res.filePaths[0]);
    });
    handle('lib:open', async ({ root }) => this.openLibrary(root));
    handle('lib:recent', () => this.settings.data.recentLibraries);
    handle('lib:current', () => (this.catalog ? { root: this.catalog.root } : null));
    // "Skan igen": naar drevet lige er tilsluttet igen, eller naar der er
    // lagt filer i mappen og man ikke gider vente paa uret.
    handle('lib:rescan', () => {
      this.requireCatalog();
      const res = this.runSync('manuel');
      if (!res.skipped) this.indexer?.kick();
      return res;
    });
    handle('lib:driveStatus', () => ({
      missing: this.driveMissing,
      root: this.catalog?.root ?? null,
    }));

    handle('img:list', async (filter) => {
      const catalog = this.requireCatalog();
      let searchInfo = null;
      const effective = { ...filter };
      if (filter.search && filter.search.trim()) {
        const result = await this.runSearch(filter.search.trim());
        if (result.error) {
          searchInfo = { error: result.error };
          effective.fileIds = [];
        } else {
          effective.fileIds = result.fileIds;
          effective.orderByFileIds = true;
          searchInfo = { matched: result.fileIds.length };
        }
      }
      const rows = catalog.listVersions(effective);
      return { rows, counts: catalog.counts(), searchInfo };
    });

    handle('img:imageVersions', ({ imageId }) =>
      this.requireCatalog().listVersionsForImage(imageId));
    handle('img:setRating', ({ versionIds, rating }) => {
      const catalog = this.requireCatalog();
      this.undoMgr.beforeRatings(versionIds);
      catalog.setRating(versionIds, rating);
    });
    handle('img:setFlag', ({ versionIds, flag, value }) => {
      const catalog = this.requireCatalog();
      this.undoMgr.beforeFlags(versionIds, flag);
      catalog.setFlag(versionIds, flag, value);
    });
    handle('img:virtualCopy', ({ versionId }) => {
      const nyId = this.requireCatalog().createVirtualCopy(versionId);
      this.undoMgr.afterVirtualCopy(nyId);
      return nyId;
    });
    handle('img:renameVersion', ({ versionId, name }) => {
      const catalog = this.requireCatalog();
      this.undoMgr.beforeRename(versionId);
      catalog.renameVersion(versionId, name);
    });
    handle('img:deleteVersion', async ({ versionId }) => {
      const fileAbs = this.requireCatalog().deleteVersion(versionId);
      if (fileAbs) await shell.trashItem(fileAbs).catch(() => {});
    });
    handle('img:reveal', ({ versionId }) => {
      const p = this.requireCatalog().filePathForVersion(versionId);
      if (p) shell.showItemInFolder(p);
    });

    handle('ser:list', () => this.requireCatalog().listSeries());
    handle('ser:create', ({ name }) => this.requireCatalog().createSeries(name));
    handle('ser:assign', ({ imageIds, seriesId }) => {
      const catalog = this.requireCatalog();
      this.undoMgr.beforeSeries(imageIds);
      catalog.assignSeries(imageIds, seriesId ?? null);
    });
    handle('ser:delete', ({ seriesId }) => this.requireCatalog().deleteSeries(seriesId));

    handle('fold:tree', () => this.requireCatalog().folderTree());
    handle('fold:create', ({ parentRel, name }) =>
      this.requireCatalog().createFolder(parentRel, name));
    handle('fold:move', ({ fileIds, targetRel }) => {
      const moves = this.requireCatalog().moveFiles(fileIds, targetRel);
      this.undoMgr.afterMoves(moves);
      return moves.length;
    });
    handle('fold:cleanup', () => {
      const moves = this.requireCatalog().moveDiscarded();
      this.undoMgr.afterMoves(moves);
      return moves.length;
    });

    handle('app:undo', () => (this.undoMgr ? this.undoMgr.undo() : null));
    handle('app:redo', () => (this.undoMgr ? this.undoMgr.redo() : null));

    handle('ed:list', () => detectEditors(this.settings.data.customEditors));
    handle('ed:open', async ({ versionId, appPath }) => {
      const catalog = this.requireCatalog();
      const v = catalog.getVersion(versionId);
      if (!v) throw new Error('Versionen findes ikke');
      const filePath = (!v.is_master && !v.file_id)
        ? catalog.materializeVersion(versionId)
        : catalog.filePathForVersion(versionId);
      if (!filePath) throw new Error('Filen findes ikke på disken');
      await openInApp(appPath || null, filePath);
      return { filePath };
    });
    handle('ed:pick', async () => {
      const res = await dialog.showOpenDialog(this.win, {
        title: 'Vælg app',
        defaultPath: '/Applications',
        properties: ['openFile'],
        filters: process.platform === 'darwin' ? [{ name: 'Apps', extensions: ['app'] }] : [],
      });
      if (res.canceled || !res.filePaths.length) return null;
      this.settings.addCustomEditor(res.filePaths[0]);
      return res.filePaths[0];
    });

    handle('kw:top', () => this.requireCatalog().topKeywords());
    handle('kw:forFile', ({ fileId }) => this.requireCatalog().keywordsForFile(fileId));
    handle('kw:add', ({ fileId, word }) => {
      this.requireCatalog().addKeyword(fileId, word);
      this._recompute?.();
    });
    handle('kw:remove', ({ fileId, word }) => {
      this.requireCatalog().removeKeyword(fileId, word);
      this._recompute?.();
    });
    handle('kw:removeFromFiles', ({ fileIds, word }) => {
      const n = this.requireCatalog().removeKeywordFromFiles(fileIds, word);
      this._recompute?.();
      return n;
    });
    handle('kw:removeAll', ({ word }) => {
      const n = this.requireCatalog().removeKeywordEverywhere(word);
      this._recompute?.();
      return n;
    });

    handle('search:status', () => ({
      ai: this.ai.status,
      index: this.indexer ? this.indexer.progress : null,
    }));
    handle('app:counts', () => this.requireCatalog().counts());
  }
}
