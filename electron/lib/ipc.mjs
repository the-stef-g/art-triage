// Session-laget: ejer det aabne bibliotek (database, katalog, thumbnails,
// watcher, indeksering) og registrerer alle IPC-handlers som UI'et kalder.
import { ipcMain, dialog, shell } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { cropMaster } from './crop.mjs';
import { lavMaster } from './master.mjs';
import { lavPrintfil } from './printfil.mjs';
import { openDatabase } from './db.mjs';
import { Catalog } from './catalog.mjs';
import { Thumbnailer } from './thumbs.mjs';
import { watchLibrary } from './watcher.mjs';
import { detectEditors, openInApp, statusNavne } from './editors.mjs';
import { EDITOR_SUFFIKS } from './util.mjs';
import { SearchIndex, normalize } from './searchIndex.mjs';
import { Indexer, MODEL_ID } from './indexer.mjs';
import {
  ClaudeKeywords, KeywordRunner, KEYWORD_MODELS, DEFAULT_KEYWORD_MODEL,
} from './keywords.mjs';
import { UndoManager } from './undo.mjs';
import { Works } from './works.mjs';
import { ClaudeWorkTexts, TEXT_IMAGE_SIZE } from './workTexts.mjs';
import { ShopClient, ShopSync, DEFAULT_SHOP_URL } from './shop.mjs';
import { debounce, dataDirFor, openFdCount } from './util.mjs';

// Mappe-overvaageren (fs.watch) faar sjaeldent fil-system-haendelser fra
// eksterne drev paa macOS, og Stefs billeder ligger netop eksternt. Den
// periodiske genskanning er derfor ikke et sikkerhedsnet men den baerende
// mekanisme: uden den dukker nye filer foerst op efter en genstart.
const RESCAN_MIN_MS = 90_000;
// Et langsomt drev maa ikke ende med at skanne i et vaek. Naeste skanning
// planlaegges tidligst naar der er gaaet ti gange saa lang tid som den
// forrige tog, saa skanningen hoejst fylder en tiendedel af tiden.
const RESCAN_DUTY = 10;

// Engangsoprydning pr. bibliotek: de automatiske noegleord var
// systematisk skaeve og er taget ud af drift, saa de gamle gaet skal ud
// af databasen. Manuelle ord roeres ikke. Noeglen staar i meta, saa
// oprydningen kun koerer en gang.
const AUTOKW_RYDDET = 'autokw_ryddet';

export class AppSession {
  constructor({ settings, ai, rasterizeSvg, log = () => {} }) {
    this.settings = settings;
    this.log = log;
    this.ai = ai;
    this.rasterizeSvg = rasterizeSvg;
    this.win = null;
    this.db = null;
    this.catalog = null;
    this.thumbs = null;
    this.watcher = null;
    this.searchIndex = null;
    this.indexer = null;
    this.kwRunner = null;
    this.kwService = null;
    this.textService = null;
    this.scanTimer = null;
    this.scanning = false;
    this.driveMissing = false;
    this.lastScanMs = 0;

    // Billedmodellen er klar foer tekstmodellen. Indekseringen skal ikke
    // vente paa soegningen, saa den startes her og ikke naar alt er klar.
    this.ai.on('image-ready', ({ modelId }) => {
      if (!this.indexer) return;
      // AI-vinduet melder hvilken model det faktisk fik indlaest;
      // katalog og soegeindeks skal foelge med.
      if (modelId) {
        this.searchIndex.setModel(modelId);
        this.indexer.setModel(modelId);
      }
      this.indexer.kick();
    });
    this.ai.on('status', (status) => {
      this.broadcast('ai', { status });
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
  async runSync(reason = 'auto') {
    if (!this.catalog) return { skipped: true, reason };
    if (this.scanning) return { skipped: true, reason };
    this.scanning = true;
    const start = Date.now();
    const katalog = this.catalog;
    let res;
    try {
      res = await katalog.syncAsync();
    } catch {
      // En enkelt mislykket skanning maa ikke vaelte noget; uret proever igen.
      res = { changed: 0, edited: 0, unavailable: false };
    } finally {
      this.scanning = false;
    }
    this.lastScanMs = Date.now() - start;
    this._reportDrive(Boolean(res.unavailable));
    // Vaerker med et nummer sidst i titlen samles i serier.
    if (!res.unavailable && katalog === this.catalog && this.works) {
      try {
        const antal = this.works.autoSerier();
        if (antal) this.log(`auto series: ${antal} work(s)`);
      } catch (err) {
        this.log(`auto series failed: ${String(err?.message || err).slice(0, 200)}`);
      }
    }
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
    this.scanTimer = setTimeout(async () => {
      await this.runSync('ur');
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
    const dataDir = dataDirFor(root);
    this.db = await openDatabase(join(dataDir, 'katalog.sqlite'));
    this.catalog = new Catalog(this.db, root);
    this.catalog.brugMappestruktur();
    this.thumbs = new Thumbnailer({
      cacheDir: join(dataDir, 'cache'),
      rasterizeSvg: this.rasterizeSvg,
      onInfo: (tekst) => this.log(`preview ${tekst}`),
      rotationFor: (id) => this.catalog?.getFile(id)?.rotation || 0,
      // Hvert trin der svigter staar i loggen, ogsaa naar et senere trin
      // redder forhaandsvisningen.
      onError: ({ stage, file, message }) => this.log(`preview ${stage} (${file}): ${message}`),
    });
    // Statuslinjen viser hvor mange forhaandsvisninger der fejlede.
    this.thumbs.onFailedChange = debounce((failed) => this.broadcast('thumbs', { failed }), 300);
    this.searchIndex = new SearchIndex(this.catalog, MODEL_ID);
    this.undoMgr = new UndoManager(this.catalog);
    this.works = new Works(this.catalog);
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
    // Naar et vaerk faar sin master, skrives teksterne af sig selv. Ikke ved
    // den foerste skanning efter aabning: dér ville hver master i biblioteket
    // ellers blive sendt til Claude paa én gang.
    this.autoTeksterKlar = false;
    this.catalog.on('ny-master', (imageId) => {
      if (this.autoTeksterKlar) this._nytVaerk(imageId);
    });

    this.driveMissing = false;
    this.lastScanMs = 0;
    await this.runSync('aabning');
    this.autoTeksterKlar = true;
    this.tjekShopFormatSnart();
    // Mastere uden noegleord faar dem nu; kun mastere, saa det er til at overse.
    if (this.settings.data.claudeKey && this.catalog.keywordQueueSize() > 0) {
      try {
        this._keywordRunner().start();
      } catch (err) {
        this.log(`auto keywords at opening failed: ${String(err?.message || err).slice(0, 200)}`);
      }
    }
    // Foerste aabning efter at de automatiske noegleord blev taget ud af
    // drift: fjern de gamle gaet, saa chips og soegning ikke bliver ved
    // med at vise dem. Stefs egne ord staar uroert.
    if (this.catalog.getMeta(AUTOKW_RYDDET) !== '1') {
      try {
        const antal = this.catalog.clearAutoKeywords();
        this.catalog.setMeta(AUTOKW_RYDDET, '1');
        if (antal) this.broadcast('besked', { tekst: `Removed ${antal} automatic keywords` });
      } catch {
        // proever igen ved naeste aabning; flaget er ikke sat
      }
    }
    // Watcheren beholdes: paa interne diske er den oejeblikkelig. Paa
    // eksterne drev tier den, og der er det uret nedenfor der leverer.
    this.watcher = watchLibrary(root, () => this.runSync('watcher'), {
      onError: (err) => this.log(`watcher: ${err?.message || err}`),
    });
    this.log(`library opened: ${this.catalog.db.engine}, open files: ${openFdCount()}`);
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
    try { this.kwRunner?.stop(); } catch { /* ligegyldigt ved quit */ }
    this.kwRunner = null;
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
    this.works = null;
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
    // Koeren peger paa det gamle katalog og skal ikke skrive videre i det
    // efter et biblioteksskift.
    if (this.kwRunner) {
      this.kwRunner.stop();
      this.kwRunner = null;
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
    this.works = null;
  }

  requireCatalog() {
    if (!this.catalog) throw new Error('No library is open');
    return this.catalog;
  }

  requireWorks() {
    this.requireCatalog();
    return this.works;
  }

  // ---------- Cloud-noegleord ----------

  keywordModel() {
    const valgt = this.settings.data.claudeModel;
    return KEYWORD_MODELS.some((m) => m.id === valgt) ? valgt : DEFAULT_KEYWORD_MODEL;
  }

  // Kaldes naar noeglen eller modellen skifter, saa naeste koersel bygger
  // en ny klient i stedet for at bruge den gamle noegle.
  resetKeywordService() {
    this.kwService = null;
    this.textService = null;
  }

  _keywordRunner() {
    const catalog = this.requireCatalog();
    const apiKey = this.settings.data.claudeKey;
    if (!apiKey) throw new Error('No Claude API key yet. Add it under Help.');
    if (!this.kwService || this.kwService.model !== this.keywordModel()) {
      this.kwService = new ClaudeKeywords({ apiKey, model: this.keywordModel() });
    }
    if (!this.kwRunner) {
      this.kwRunner = new KeywordRunner({ catalog, thumbs: this.thumbs, service: this.kwService });
      // Noegleordene skrives loebende, saa chips og soegning skal med.
      // Opdateringen daempes her i stedet for i kataloget, saa 1200
      // gemte ord ikke bliver til 1200 gennemtegninger af UI'et.
      const sendChanged = debounce(() => this.broadcast('changed'), 400);
      this.kwRunner.on('progress', (progress) => {
        this.broadcast('kw', { progress });
        if (progress.phase === 'koerer' || progress.phase === 'faerdig') sendChanged();
      });
    }
    this.kwRunner.service = this.kwService;
    return this.kwRunner;
  }

  // Tekster til vaerket. Foer noget sendes: vaerket skal vaere godkendt og
  // faerdigt, og har Stef rettet i en tekst, spoerges der foer den
  // overskrives. Svaret uden overwrite koster ingenting.
  // Et vaerk er lige blevet til (en ny fil i Master). Skabelonen saettes
  // efter formatet, og med en Claude-noegle skrives teksterne og
  // noegleordene, i baggrunden og én ad gangen.
  _nytVaerk(imageId) {
    this.autoBehandlet = this.autoBehandlet || new Set();
    if (this.autoBehandlet.has(imageId)) return;
    this.autoBehandlet.add(imageId);
    this.autoTekstKoe = (this.autoTekstKoe || Promise.resolve()).then(async () => {
      try {
        await this._skabelonEfterFormat(imageId);
      } catch (err) {
        this.log(`template from format failed: ${String(err?.message || err).slice(0, 200)}`);
      }
      if (!this.settings.data.claudeKey) return;
      try {
        this._keywordRunner().start();
      } catch (err) {
        this.log(`auto keywords failed: ${String(err?.message || err).slice(0, 200)}`);
      }
      try {
        const work = this.requireWorks().get(imageId);
        if (!work.eligible || work.description || work.shortText || work.altText) return;
        await this.writeWorkTexts({ imageId });
        this.log(`texts written for new work: ${work.effective.title}`);
        this.broadcast('besked', { tekst: `Texts written for ${work.effective.title}` });
        this.broadcast('changed');
      } catch (err) {
        this.log(`auto texts failed: ${String(err?.message || err).slice(0, 200)}`);
        this.broadcast('besked', { tekst: `The texts could not be written: ${String(err?.message || err).slice(0, 160)}` });
      }
    });
  }

  // Bredformat bliver til skabelonen spread, hoejformat og kvadratisk til
  // poster. Formatet er masterens, som den vises (EXIF-retning og egen
  // drejning med).
  async _skabelonEfterFormat(imageId) {
    const catalog = this.requireCatalog();
    const master = catalog.masterFil(imageId);
    if (!master) return;
    const sharp = (await import('sharp')).default;
    const meta = await sharp(catalog.abs(master.rel_path), { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height) return;
    let [b, h] = [meta.width, meta.height];
    if (meta.orientation >= 5) [b, h] = [h, b];
    if ((((master.rotation || 0) % 180) + 180) % 180 === 90) [b, h] = [h, b];
    this.requireWorks().save(imageId, { template: b > h ? 'spread' : 'poster' });
  }

  async writeWorkTexts({ imageId, overwrite = false }) {
    const works = this.requireWorks();
    const work = works.get(imageId);
    if (!work.eligible) throw new Error('Only approved, finished works can get texts');
    const apiKey = this.settings.data.claudeKey;
    if (!apiKey) throw new Error('No Claude API key yet. Add it under Help.');
    if (work.editedTexts.length && !overwrite) {
      return { needsConfirm: true, edited: work.editedTexts };
    }
    const file = works.imageFile(imageId);
    if (!file) throw new Error('The image file is not available right now');
    const preview = await this.thumbs.previewFor(
      file.id, file.mtime, this.catalog.abs(file.rel_path), TEXT_IMAGE_SIZE
    );
    if (!preview) {
      const grund = this.thumbs.lastError ? ` (${this.thumbs.lastError.slice(0, 160)})` : '';
      this.log(`write texts: no preview for ${file.rel_path}${grund}`);
      throw new Error(`A preview of the image could not be made${grund}. The details are in the log under Help > Show AI log.`);
    }
    const thumbPath = preview.path;
    if (!this.textService || this.textService.model !== this.keywordModel()) {
      this.textService = new ClaudeWorkTexts({ apiKey, model: this.keywordModel() });
    }
    this.broadcast('wt', { phase: 'koerer', cost: null });
    try {
      const res = await this.textService.write(thumbPath, work);
      let saved = works.saveGeneratedTexts(imageId, res.texts);
      // Sektionsfarven fra Claude, kun hvis Stef ikke selv har valgt en.
      if (res.texts.section_colour && !saved.sectionColour) {
        saved = works.save(imageId, { section_colour: res.texts.section_colour });
      }
      this.broadcast('wt', { phase: 'faerdig', cost: res.cost });
      return { work: saved, warnings: res.warnings, cost: res.cost };
    } catch (err) {
      this.broadcast('wt', { phase: 'fejl', cost: null });
      throw err;
    }
  }

  // ---------- Shop ----------

  shopStatus() {
    const d = this.settings.data;
    return {
      harWoo: Boolean(d.wooKey && d.wooSecret),
      harWp: Boolean(d.wpUser && d.wpPassword),
      url: d.shopUrl || DEFAULT_SHOP_URL,
      // Resultatet af seneste formattjek: true, false eller null (aldrig
      // tjekket). Kun et tjek der fandt en forskel spaerrer for afsendelse.
      formatOk: d.shopFormatOk ?? null,
      formatProblems: d.shopFormatProblems || [],
    };
  }

  _shop() {
    const works = this.requireWorks();
    const d = this.settings.data;
    return new ShopSync({
      catalog: this.catalog,
      works,
      client: new ShopClient({
        baseUrl: d.shopUrl || DEFAULT_SHOP_URL,
        wooKey: d.wooKey, wooSecret: d.wooSecret, wpUser: d.wpUser, wpPassword: d.wpPassword,
      }),
    });
  }

  // Et tjek der har fundet en forskel mellem shoppen og det format vi
  // skriver, spaerrer for afsendelse til det er rettet. Et tjek der ikke er
  // koert, eller som passede, spaerrer ikke.
  _requireFormat() {
    const d = this.settings.data;
    if (d.shopFormatOk === false) {
      throw new Error(`The shop's field format has changed: ${(d.shopFormatProblems || []).slice(0, 3).join('; ')}. Run Check shop format again once it is fixed.`);
    }
  }

  // Samme maade at melde fremdrift paa som tekster og noegleord.
  // Tjekker at ACPT-felterne paa produkt 20 stadig ser ud som dem appen
  // skriver, og husker resultatet. Koerer af sig selv naar biblioteket
  // aabnes og naar WooCommerce-noeglen gemmes. En forskel spaerrer for
  // afsendelse og meldes i bundlinjen; ellers hoerer Stef intet.
  async tjekShopFormat({ stille = false } = {}) {
    const res = await this._shopCall(async (shop) => {
      const { name, problems } = await shop.checkFormat();
      this.settings.data.shopFormatOk = problems.length === 0;
      this.settings.data.shopFormatProblems = problems;
      this.settings.save();
      return { name, problems };
    });
    this.broadcast('shopStatus', this.shopStatus());
    if (res.problems.length) {
      this.broadcast('besked', {
        tekst: `The shop's product format has changed, so Send to shop is locked: ${res.problems.slice(0, 2).join('; ')}`,
      });
    } else if (!stille) {
      this.broadcast('besked', { tekst: `The shop format matches (${res.name})` });
    }
    return res;
  }

  // I baggrunden og kun med en noegle. Kan shoppen ikke naas, roeres det
  // seneste resultat ikke: det er ikke en forskel i formatet.
  tjekShopFormatSnart() {
    if (!this.shopStatus().harWoo) return;
    this.tjekShopFormat({ stille: true }).catch((err) => {
      this.log(`shop format check skipped: ${String(err?.message || err).slice(0, 200)}`);
    });
  }

  async _shopCall(fn) {
    this.broadcast('shop', { phase: 'koerer' });
    try {
      const res = await fn(this._shop());
      this.broadcast('shop', { phase: 'faerdig' });
      return res;
    } catch (err) {
      this.broadcast('shop', { phase: 'fejl' });
      throw err;
    }
  }

  keywordStatus() {
    return {
      harKey: Boolean(this.settings.data.claudeKey),
      model: this.keywordModel(),
      modeller: KEYWORD_MODELS.map((m) => ({ id: m.id, navn: m.navn })),
      koe: this.catalog ? this.catalog.keywordQueueSize() : 0,
      koerer: Boolean(this.kwRunner?.running),
      progress: this.kwRunner?.progress ?? null,
    };
  }

  // Fritekst-soegning: foerst filer hvis noegleord matcher teksten
  // (auto eller manuelle), dernaest semantiske match fra indekset.
  async runSearch(text) {
    const catalog = this.requireCatalog();
    const keywordIds = catalog.filesWithKeywordLike(text);
    let semantiske = [];
    let advarsel = null;
    if (this.ai.textReady) {
      this.searchIndex.ensureLoaded();
      if (this.searchIndex.size()) {
        const qvec = normalize(await this.ai.embedText(text));
        semantiske = this.searchIndex.query(qvec).map((h) => h.fileId);
      }
    } else if (!keywordIds.length) {
      advarsel = 'Search is ready once the AI model has downloaded';
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
        title: 'Choose the Stef G Art folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths.length) return null;
      return this.openLibrary(res.filePaths[0]);
    });
    handle('lib:open', async ({ root }) => this.openLibrary(root));
    // Mapper der er omdoebt eller slettet vises ikke som seneste bibliotek.
    handle('lib:recent', () => (this.settings.data.recentLibraries || []).filter((r) => existsSync(r.root ?? r)));
    handle('lib:current', () => (this.catalog ? { root: this.catalog.root } : null));
    // "Skan igen": naar drevet lige er tilsluttet igen, eller naar der er
    // lagt filer i mappen og man ikke gider vente paa uret.
    handle('lib:rescan', async () => {
      this.requireCatalog();
      const res = await this.runSync('manuel');
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
      return {
        rows,
        counts: catalog.counts(),
        faseTal: catalog.faseTal(),
        editVaerker: Number(filter?.fase) === 2 ? catalog.editVaerker() : null,
        searchInfo,
      };
    });

    handle('img:imageVersions', ({ imageId }) =>
      this.requireCatalog().listVersionsForImage(imageId));
    handle('img:setRating', ({ versionIds, rating }) => {
      const catalog = this.requireCatalog();
      this.undoMgr.beforeRatings(versionIds);
      catalog.setRating(versionIds, rating);
    });
    // Status under Edits er navnet paa et af de programmer appen kender
    // (Luminar Neo, Topaz Photo AI ...). Appen opfinder aldrig et nyt.
    handle('img:setEditor', ({ versionIds, editor }) => {
      const catalog = this.requireCatalog();
      if (editor != null) {
        const kendte = statusNavne(this.settings.data.customEditors);
        if (!kendte.includes(editor)) throw new Error(`Unknown editor: ${editor}`);
      }
      this.undoMgr.beforeStage(versionIds);
      catalog.setEditor(versionIds, editor ?? null);
    });
    handle('img:setStage', ({ versionIds, stage }) => {
      const catalog = this.requireCatalog();
      this.undoMgr.beforeStage(versionIds);
      catalog.setStage(versionIds, stage ?? null);
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
    // Manuel drejning naar automatikken tager fejl. delta er 90, -90 eller 0.
    handle('img:rotate', ({ fileIds, delta }) => {
      const catalog = this.requireCatalog();
      if (![90, -90, 180, 0].includes(delta)) throw new Error('Unknown rotation');
      const ids = Array.isArray(fileIds) ? fileIds : [];
      for (const fileId of ids) {
        catalog.rotateFile(fileId, delta);
        this.thumbs?.forgetFile(fileId);
      }
      this.log(`rotate: ${ids.length} file(s) by ${delta} degrees`);
      return { antal: ids.length };
    });
    // Filmstrip: de andre skud i samme mappe, i den raekkefoelge de er taget.
    handle('img:filmstrip', ({ fileId, visKasserede }) =>
      this.requireCatalog().filmstrip(fileId, { visKasserede: Boolean(visKasserede) }));

    // Fase 2: en kopi til et program. Kopien faar programmets endelse
    // (-neo, -tp, -ps) og ligger i vaerkets Edits, saa resultatet ogsaa
    // gemmes dér, og statussen kan ses af navnet.
    handle('edit:send', async ({ versionId, program }) => {
      const catalog = this.requireCatalog();
      const suffiks = EDITOR_SUFFIKS[program];
      if (!suffiks) throw new Error(`Unknown program: ${program}`);
      const app = detectEditors(this.settings.data.customEditors).find((e) => e.label === program);
      if (!app) throw new Error(`${program} was not found in Applications`);
      const dest = catalog.kopiTilEdits(versionId, suffiks);
      this.log(`edit: copy for ${program} -> ${dest.slice(catalog.root.length + 1)}`);
      await this.runSync('kopi til editor');
      await openInApp(app.appPath, dest);
      return { rel: dest.slice(catalog.root.length + 1) };
    });

    // Fase 2, sidste skridt: den faerdige redigering bliver master.
    handle('edit:makeMaster', async ({ versionId }) => {
      const catalog = this.requireCatalog();
      const res = await lavMaster(catalog.masterMaal(versionId));
      this.log(`master: ${res.path.slice(catalog.root.length + 1)}${res.konverteret ? ' (converted to TIFF)' : ''}`);
      await this.runSync('master');
      return { rel: res.path.slice(catalog.root.length + 1), konverteret: res.konverteret };
    });

    // Fase 5: printfiler til Prodigi, én pr. markeret fil i Master.
    handle('print:make', async ({ versionIds }) => {
      const catalog = this.requireCatalog();
      const ids = Array.isArray(versionIds) ? versionIds : [];
      const lavet = [];
      for (const id of ids) {
        const res = await lavPrintfil(catalog.printMaal(id));
        lavet.push({
          rel: res.path.slice(catalog.root.length + 1),
          bytes: res.bytes,
          format: res.token.replace('-', ':'),
          afvigelse: res.afvigelse,
        });
      }
      this.log(`print: ${lavet.length} print file(s)`);
      this.broadcast('changed');
      return lavet;
    });

    // Fase 2: kassér et vaerk. Originalen gaar til Discarded, og redigeringerne
    // og den tomme arbejdsmappe gaar i papirkurven.
    handle('work:discard', async ({ versionId }) => {
      const catalog = this.requireCatalog();
      const { filer, arbejdsmappe } = catalog.kasserVaerk(versionId);
      if (existsSync(arbejdsmappe)) await shell.trashItem(arbejdsmappe);
      else for (const f of filer) await shell.trashItem(f).catch(() => {});
      this.log(`discard work: ${filer.length} edit file(s) to the Trash`);
      await this.runSync('kassering');
      return { edits: filer.length };
    });

    // Beskaeringen paa en fil i Master. Den staar i filnavnet, saa filen
    // omdoebes, og etiketten foelger med.
    handle('img:setCrop', ({ versionId, crop }) => {
      const rel = this.requireCatalog().setBeskaering(versionId, crop ?? null);
      this.log(`crop label: ${rel}`);
      return { rel };
    });
    // Beskaering. Kun et faerdigt vaerk kan beskaeres, altsaa en fil i Master,
    // og resultatet er en ny fil i Master.
    handle('crop:save', async ({ versionId, rect, ratio }) => {
      const catalog = this.requireCatalog();
      const v = catalog.getVersion(versionId);
      const f = v ? catalog.getFile(v.effective_file_id) : null;
      if (!f || !f.present) throw new Error('The file is not available right now');
      if (!/^Approved\/[^/]+\/Master\//.test(f.rel_path)) {
        throw new Error('Only finished works can be cropped: the file must be in the Master folder');
      }
      if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) {
        throw new Error('The crop is empty');
      }
      const res = await cropMaster({
        kilde: catalog.abs(f.rel_path), rect, rotation: f.rotation || 0, ratio,
      });
      this.log(`crop: ${f.rel_path} -> ${res.path.slice(catalog.root.length + 1)}${res.bit8 ? ' (8 bit)' : ''}`);
      // Den nye fil bliver en version af vaerket med det samme.
      await this.runSync('beskaering');
      return { rel: res.path.slice(catalog.root.length + 1), bit8: res.bit8 };
    });
    // Aabner en af arbejdsmappens undermapper i Finder.
    handle('img:openWorkFolder', async ({ versionId, del = null }) => {
      const abs = this.requireCatalog().workFolder(versionId, del);
      if (!abs) throw new Error('This image has no work folder. Only Approved images do.');
      await shell.openPath(abs);
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
    handle('ser:setShop', ({ seriesId, patch }) => this.requireCatalog().setSeriesShop(seriesId, patch));
    handle('ser:rename', ({ seriesId, name }) => this.requireCatalog().renameSeries(seriesId, name));
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
      const catalog = this.requireCatalog();
      const moves = catalog.moveDiscarded();
      this.undoMgr.afterMoves(moves);
      // Tomme mapper i Import slettes ogsaa.
      const tomme = catalog.ryddTommeMapper();
      if (tomme) this.log(`clean up: removed ${tomme} empty folder(s) in ${catalog.importMappe}`);
      return moves.length;
    });

    handle('app:undo', () => (this.undoMgr ? this.undoMgr.undo() : null));
    handle('app:redo', () => (this.undoMgr ? this.undoMgr.redo() : null));

    handle('ed:list', () => detectEditors(this.settings.data.customEditors));
    handle('ed:statusNames', () => statusNavne(this.settings.data.customEditors));
    handle('ed:open', async ({ versionId, appPath }) => {
      const catalog = this.requireCatalog();
      const v = catalog.getVersion(versionId);
      if (!v) throw new Error('That version does not exist');
      const filePath = (!v.is_master && !v.file_id)
        ? catalog.materializeVersion(versionId)
        : catalog.filePathForVersion(versionId);
      if (!filePath) throw new Error('The file does not exist on disk');
      await openInApp(appPath || null, filePath);
      // Husk hvilket program billedet blev aabnet i, saa en fil der dukker op
      // i Edits faar det som status. Aabnet i standardprogrammet: intet navn.
      if (appPath) {
        const editor = detectEditors(this.settings.data.customEditors).find((e) => e.appPath === appPath);
        if (editor) catalog.noteEditor(versionId, editor.label);
      }
      return { filePath };
    });
    handle('ed:pick', async () => {
      const res = await dialog.showOpenDialog(this.win, {
        title: 'Choose app',
        defaultPath: '/Applications',
        properties: ['openFile'],
        filters: process.platform === 'darwin' ? [{ name: 'Apps', extensions: ['app'] }] : [],
      });
      if (res.canceled || !res.filePaths.length) return null;
      this.settings.addCustomEditor(res.filePaths[0]);
      return res.filePaths[0];
    });

    // Cloud-noegleord. Kun godkendte billeder kommer med; udvaelgelsen
    // sker i catalog.filesNeedingKeywords, saa der ikke findes en vej
    // udenom herfra.
    handle('kw:status', () => this.keywordStatus());
    handle('kw:run', () => {
      this._keywordRunner().start();
      return this.keywordStatus();
    });
    handle('kw:stop', () => {
      this.kwRunner?.stop();
      return this.keywordStatus();
    });
    handle('kw:setModel', ({ model }) => {
      if (!KEYWORD_MODELS.some((m) => m.id === model)) throw new Error(`Unknown model: ${model}`);
      this.settings.data.claudeModel = model;
      this.settings.save();
      this.resetKeywordService();
      return this.keywordStatus();
    });
    // Kør alt godkendt igennem igen, fx efter et modelskift. De gamle ord
    // bliver staaende til de bliver overskrevet.
    handle('kw:reanalyse', () => {
      const antal = this.requireCatalog().clearKeywordRuns();
      return { antal, ...this.keywordStatus() };
    });

    handle('kw:top', () => this.requireCatalog().topKeywords());
    handle('kw:forFile', ({ fileId }) => this.requireCatalog().keywordsForFile(fileId));
    // Ingen genberegning laengere: appen gaetter ikke selv noegleord, saa
    // det der staar, er det Stef selv har skrevet ind.
    handle('kw:add', ({ fileId, word }) => this.requireCatalog().addKeyword(fileId, word));
    handle('kw:remove', ({ fileId, word }) => this.requireCatalog().removeKeyword(fileId, word));
    handle('kw:removeFromFiles', ({ fileIds, word }) =>
      this.requireCatalog().removeKeywordFromFiles(fileIds, word));

    // Vaerket: tekster og shop-felter pr. billede (docs/plan-shop.md).
    handle('work:get', ({ imageId }) => this.requireWorks().get(imageId));
    handle('work:save', ({ imageId, patch }) => this.requireWorks().save(imageId, patch));
    handle('work:pickVideo', async () => {
      const res = await dialog.showOpenDialog(this.win, {
        title: 'Choose video',
        properties: ['openFile'],
        filters: [{ name: 'Video', extensions: ['mp4', 'm4v', 'mov', 'webm'] }],
      });
      return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
    });
    handle('shop:status', () => this.shopStatus());
    handle('shop:send', ({ imageId }) => {
      this._requireFormat();
      return this._shopCall((shop) => shop.send(imageId));
    });
    handle('shop:publish', ({ imageId }) => this._shopCall((shop) => shop.publish(imageId)));
    // Tjekker at ACPT-felterne paa produkt 20 stadig ser ud som dem vi
    // skriver, og husker resultatet.
    handle('shop:checkFormat', () => this.tjekShopFormat());
    handle('work:writeTexts', (payload) => this.writeWorkTexts(payload));
    // Et vaerk der aabnes i Product uden tekster (fx en master fra foer
    // teksterne blev skrevet af sig selv) faar det samme som et nyt vaerk.
    // Kun med en Claude-noegle, saa skabelonen ikke saettes om ved hvert kig.
    handle('work:auto', ({ imageId }) => {
      if (!this.settings.data.claudeKey) return { started: false };
      const work = this.requireWorks().get(imageId);
      if (!work.eligible || work.description || work.shortText || work.altText) return { started: false };
      this._nytVaerk(imageId);
      return { started: true };
    });
    handle('work:setCrop', ({ imageId, versionId, format }) =>
      this.requireWorks().setCrop(imageId, versionId, format ?? null));

    // Forhaandsvisninger der ikke kunne laves, og en knap der proever dem igen.
    handle('thumbs:status', () => ({ failed: this.thumbs ? this.thumbs.failed.size : 0 }));
    handle('thumbs:retry', () => {
      if (!this.thumbs) return { antal: 0 };
      const antal = this.thumbs.retryFailed();
      this.log(`retry failed previews: ${antal}`);
      // Et nyt tal i adressen faar fliserne til at spoerge igen.
      this.broadcast('thumbs', { failed: 0, retry: Date.now() });
      return { antal };
    });

    handle('search:status', () => ({
      ai: this.ai.status,
      index: this.indexer ? this.indexer.progress : null,
    }));
    handle('app:counts', () => this.requireCatalog().counts());
  }
}
