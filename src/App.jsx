import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, onEvent, harBro, setThumbRetry, thumbUrl } from './api';
import Welcome from './components/Welcome';
import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import Grid from './components/Grid';
import Inspector from './components/Inspector';
import StatusBar, { MIN_KOLONNER, MAX_KOLONNER } from './components/StatusBar';
import Filmstrip from './components/Filmstrip';
import PrintList from './components/PrintList';
import { PreviewOverlay, NameModal } from './components/Overlay';
import { FASEFARVE } from './faser';

// Fasen huskes, saa appen aabner hvor man slap.
const gemtFase = () => {
  const n = Number(localStorage.getItem('fase'));
  return n >= 1 && n <= 6 ? n : 1;
};
const defaultFilter = {
  folder: null, search: '', visKasserede: false, kunKasserede: false,
  kunKandidater: false, serieId: null, keyword: null, sort: 'navn', fase: 1,
};
const startFilter = () => ({ ...defaultFilter, fase: gemtFase() });

export default function App() {
  const [library, setLibrary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [filter, setFilter] = useState(startFilter);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [faseTal, setFaseTal] = useState(null);
  const [editVaerker, setEditVaerker] = useState(null);
  const [searchInfo, setSearchInfo] = useState(null);
  const [tree, setTree] = useState(null);
  const [series, setSeries] = useState([]);
  const [editors, setEditors] = useState([]);
  const [statusNavne, setStatusNavne] = useState([]);
  const [topKeywords, setTopKeywords] = useState([]);
  const [aiStatus, setAiStatus] = useState(null);
  const [indexProgress, setIndexProgress] = useState(null);
  const [selected, setSelected] = useState([]); // version_id'er der er markeret
  // Det aktive billede inde i markeringen: det man staar paa, og det
  // inspektoeren viser. Foer var det bare sidste element i selected, og
  // saa skulle listen vendes for at flytte fokus, hvilket ikke kunne
  // baere at pilene skal kunne gaa rundt inde i en markering.
  const [active, setActive] = useState(null);
  // Sort er der, hvor billederne bedoemmes: der er den store visning
  // standard. Mellemrum og Escape skifter stadig til gitteret.
  const [showPreview, setShowPreview] = useState(() => gemtFase() === 1);
  const [modal, setModal] = useState(null);
  const [fejl, setFejl] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [drev, setDrev] = useState(null); // {missing, root} naar drevet skifter tilstand
  const [skanner, setSkanner] = useState(false);
  const [thumbStatus, setThumbStatus] = useState({ failed: 0 }); // forhaandsvisninger der fejlede
  const [thumbRev, setThumbRev] = useState(0);
  const [shop, setShop] = useState(null); // shop-noegler og om formatet er tjekket
  const [textStatus, setTextStatus] = useState(null); // vaerk-tekster: koerer, seneste pris
  // Taeller op hver gang tekster er skrevet, ogsaa i baggrunden, saa
  // vaerk-panelet henter dem.
  const [tekstRev, setTekstRev] = useState(0);
  const [kwStatus, setKwStatus] = useState(null); // cloud-noegleord: noegle, model, koe
  // Taeller op ved hver katalog-aendring. Inspektoeren henter noegleord om
  // paa den, saa ord der bliver skrevet mens man kigger paa billedet, ogsaa
  // dukker op med det samme.
  const [dataRev, setDataRev] = useState(0);
  // Antal billeder i bredden. Gemmes lokalt, saa den staar hvor man
  // efterlod den naeste gang appen aabnes.
  const [kolonner, setKolonner] = useState(() => {
    const gemt = Number(localStorage.getItem('kolonner'));
    return gemt >= MIN_KOLONNER && gemt <= MAX_KOLONNER ? gemt : 5;
  });

  const filterRef = useRef(filter);
  filterRef.current = filter;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const activeRef = useRef(active);
  activeRef.current = active;
  const columnsRef = useRef(4);
  const modalOpenRef = useRef(false);
  modalOpenRef.current = Boolean(modal);
  const showPreviewRef = useRef(false);
  showPreviewRef.current = showPreview;
  // Udgangspunktet for en omraade-markering. Den ligger her og ikke i
  // grid'et, saa Skift+klik og Skift+piletast regner fra det samme sted.
  const ankerRef = useRef(0);
  // Et billede der skal vaelges naar listen er hentet igen, fx efter et klik
  // i filmstrimlen paa et billede fra en anden mappe end den man star i.
  const ventendeValgRef = useRef(null);

  const visFejl = useCallback((err) => {
    setFejl(String(err?.message || err));
    setTimeout(() => setFejl(null), 6000);
  }, []);

  const refreshEn = useCallback(async () => {
    try {
      const res = await invoke('img:list', filterRef.current);
      // Husk det fokuserede indeks fra den gamle liste: forsvinder hele
      // markeringen (fx efter kassering), markeres billedet paa samme
      // plads i den nye liste, altsaa det naeste foto.
      const gamleRows = rowsRef.current;
      const gammeltIdx = gamleRows.findIndex((r) => r.version_id === activeRef.current);
      // I Print staar forstoerrelserne paa beskaeringens linje, ikke for sig.
      if (filterRef.current.fase === 4) res.rows = res.rows.filter((r) => !r.giga);
      setRows(res.rows);
      setCounts(res.counts);
      setFaseTal(res.faseTal || null);
      setEditVaerker(res.editVaerker || null);
      setSearchInfo(res.searchInfo);
      const valid = new Set(res.rows.map((r) => r.version_id));
      const beholdt = selectedRef.current.filter((id) => valid.has(id));
      let nyValg = beholdt;
      let nyAktiv = valid.has(activeRef.current) ? activeRef.current : null;
      if (!beholdt.length && gammeltIdx >= 0 && res.rows.length) {
        const idx = Math.min(gammeltIdx, res.rows.length - 1);
        nyValg = [res.rows[idx].version_id];
        nyAktiv = nyValg[0];
      } else if (!nyAktiv && beholdt.length) {
        // Det aktive billede forsvandt, men resten af markeringen staar.
        nyAktiv = beholdt[0];
      }
      const venter = ventendeValgRef.current;
      // Er billedet heller ikke i hele fase 1 (fx et kasseret billede, mens
      // de kasserede er skjult), opgives det, saa det ikke dukker op senere.
      if (venter && !valid.has(venter) && !filterRef.current.folder) ventendeValgRef.current = null;
      if (venter && valid.has(venter)) {
        ventendeValgRef.current = null;
        nyValg = [venter];
        nyAktiv = venter;
        ankerRef.current = res.rows.findIndex((r) => r.version_id === venter);
      }
      setSelected(nyValg);
      setActive(nyAktiv);
    } catch (err) {
      visFejl(err);
    }
  }, [visFejl]);

  // Meldinger kommer i byger: en rettelse, en genskanning og
  // noeglesordskoeren kan melde 'changed' i traek. Hver hentning er alle
  // billederne, saa en hentning der allerede koerer faar kun ét ekstra
  // gennemløb til sidst i stedet for ét pr. besked.
  const refreshKoerer = useRef(false);
  const refreshIgen = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshKoerer.current) {
      refreshIgen.current = true;
      return;
    }
    refreshKoerer.current = true;
    try {
      do {
        refreshIgen.current = false;
        await refreshEn();
      } while (refreshIgen.current);
    } finally {
      refreshKoerer.current = false;
    }
  }, [refreshEn]);

  // Hver del af sidepanelet hentes for sig. Med et samlet Promise.all
  // ville ét fejlende kald tage mappetraeet, serierne og noegleordene med
  // sig og efterlade panelet halvtomt uden at sige hvorfor.
  const refreshMeta = useCallback(async () => {
    const dele = [
      ['fold:tree', setTree],
      ['ser:list', setSeries],
      ['kw:top', setTopKeywords],
      ['kw:status', setKwStatus],
    ];
    const svar = await Promise.allSettled(dele.map(([kanal]) => invoke(kanal)));
    let foersteFejl = null;
    svar.forEach((r, i) => {
      if (r.status === 'fulfilled') dele[i][1](r.value);
      else if (!foersteFejl) foersteFejl = r.reason;
    });
    if (foersteFejl) visFejl(foersteFejl);
  }, [visFejl]);

  // Det der ikke aendrer sig af at kataloget aendrer sig: installerede
  // editors (laeser /Applications) og shop-noegler. Hentes kun naar et
  // bibliotek aabnes, ikke ved hver aendring.
  const refreshFast = useCallback(async () => {
    invoke('ed:list').then(setEditors).catch(() => {});
    invoke('ed:statusNames').then(setStatusNavne).catch(() => {});
    invoke('shop:status').then(setShop).catch(() => {});
    invoke('thumbs:status').then(setThumbStatus).catch(() => {});
  }, []);

  // Sidepanelets tal er tungere at regne end selve listen. Den foerste
  // besked henter med det samme, saa mappetallene staar rigtigt med det
  // samme; kommer der flere mens det koerer, faar de ét ekstra gennemloeb til
  // sidst i stedet for ét hver.
  const metaKoerer = useRef(false);
  const metaIgen = useRef(false);
  const refreshMetaSnart = useCallback(async () => {
    if (metaKoerer.current) {
      metaIgen.current = true;
      return;
    }
    metaKoerer.current = true;
    try {
      do {
        metaIgen.current = false;
        await refreshMeta();
      } while (metaIgen.current);
    } finally {
      metaKoerer.current = false;
    }
  }, [refreshMeta]);

  // Ved opstart: genaabn seneste bibliotek hvis muligt.
  useEffect(() => {
    if (!harBro) return;
    invoke('app:info').then(setAppInfo).catch(() => {});
    (async () => {
      const cur = await invoke('lib:current');
      const rec = await invoke('lib:recent');
      setRecent(rec || []);
      if (cur) setLibrary(cur);
      else if (rec && rec.length) {
        try {
          setLibrary(await invoke('lib:open', { root: rec[0] }));
        } catch {
          // mappen findes maaske ikke laengere; vis velkomstskaermen
        }
      }
    })();
  }, []);

  useEffect(() => onEvent((evt) => {
    if (evt.type === 'changed') {
      refresh();
      refreshMetaSnart();
      setDataRev((n) => n + 1);
    } else if (evt.type === 'thumbs') {
      setThumbStatus((s) => ({ ...s, failed: evt.failed }));
      if (evt.retry) {
        setThumbRetry(evt.retry);
        setThumbRev(evt.retry);
      }
    } else if (evt.type === 'genvej') {
      if (evt.cmd === 'hf-token') {
        // Hjaelp-menuen: indtast/ret Hugging Face-token.
        invoke('app:info').then((info) => {
          setAppInfo(info);
          setModal({
            title: 'Hugging Face token',
            value: info?.hfToken || '',
            placeholder: 'hf_...',
            onSubmit: (token) => invoke('app:setHfToken', { token }).catch(visFejl),
          });
        }).catch(visFejl);
        return;
      }
      if (evt.cmd === 'retry-previews') {
        invoke('thumbs:retry')
          .then((r) => visFejl(r.antal ? `Retrying ${r.antal} failed preview${r.antal === 1 ? '' : 's'}` : 'No failed previews to retry'))
          .catch(visFejl);
        return;
      }
      // Noeglerne vises aldrig igen efter de er gemt: de ligger i
      // indstillingerne, ikke i UI'et. Feltet starter derfor tomt, men
      // siger om der er en noegle, og OK paa et tomt felt beholder den.
      if (evt.cmd === 'woo-key' || evt.cmd === 'wp-key') {
        const woo = evt.cmd === 'woo-key';
        invoke('shop:status').then((st) => {
          const gemt = woo ? st.harWoo : st.harWp;
          setModal({
            title: woo ? 'WooCommerce key' : 'WordPress application password',
            value: '',
            placeholder: gemt
              ? 'Saved. Type a new one to replace it'
              : (woo ? 'ck_…  cs_…' : 'username:application password'),
            onSubmit: (key) => {
              if (!key.trim() && gemt) return undefined;
              return invoke(woo ? 'app:setWooKey' : 'app:setWpKey', { key })
                .then(() => invoke('shop:status').then(setShop))
                .catch(visFejl);
            },
          });
        }).catch(visFejl);
        return;
      }
      if (evt.cmd === 'claude-key') {
        invoke('kw:status').then((st) => {
          const gemt = Boolean(st?.harKey);
          setModal({
            title: 'Claude API key',
            value: '',
            placeholder: gemt ? 'Saved. Type a new one to replace it' : 'sk-ant-...',
            onSubmit: (key) => {
              if (!key.trim() && gemt) return undefined;
              return invoke('app:setClaudeKey', { key })
                .then(() => invoke('kw:status').then(setKwStatus))
                .catch(visFejl);
            },
          });
        }).catch(visFejl);
        return;
      }
      // Cmd+Z / Skift+Cmd+Z fra menuen: tekstfelter faar tekst-fortryd,
      // ellers fortrydes seneste katalog-handling.
      const el = document.activeElement;
      const iTekstfelt = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (iTekstfelt) {
        document.execCommand(evt.cmd === 'redo' ? 'redo' : 'undo');
      } else {
        invoke(evt.cmd === 'redo' ? 'app:redo' : 'app:undo').catch(() => {});
      }
    } else if (evt.type === 'index') {
      setIndexProgress(evt.progress);
      if (evt.progress?.phase === 'faerdig') refreshMeta();
    } else if (evt.type === 'ai') {
      setAiStatus(evt.status);
    } else if (evt.type === 'kw') {
      setKwStatus((s) => (s ? { ...s, progress: evt.progress, koerer: evt.progress.phase === 'koerer' } : s));
      if (evt.progress?.phase === 'fejl' && evt.progress.fejl) visFejl(evt.progress.fejl);
      if (evt.progress?.phase === 'faerdig') invoke('kw:status').then(setKwStatus).catch(() => {});
    } else if (evt.type === 'wt') {
      setTextStatus((s) => ({ koerer: evt.phase === 'koerer', cost: evt.cost ?? s?.cost ?? null }));
      if (evt.phase === 'faerdig') setTekstRev((n) => n + 1);
    } else if (evt.type === 'drev') {
      setDrev({ missing: evt.missing, root: evt.root });
    } else if (evt.type === 'shopStatus') {
      // Formattjekket koerer af sig selv; resultatet kommer her.
      const { type: _type, ...status } = evt;
      setShop(status);
    } else if (evt.type === 'besked') {
      setFejl(evt.tekst);
      setTimeout(() => setFejl(null), 6000);
    } else if (evt.type === 'library') {
      setLibrary({ root: evt.root });
    }
  }), [refresh, refreshMeta, refreshMetaSnart, visFejl]);

  // Et nyt bibliotek henter alt. Et nyt filter henter kun listen: sidepanelet
  // haenger ikke paa filteret.
  useEffect(() => {
    if (!library) return;
    refreshMeta();
    refreshFast();
    invoke('search:status').then((s) => {
      setAiStatus(s.ai);
      setIndexProgress(s.index);
    }).catch(() => {});
  }, [library, refreshMeta, refreshFast]);

  useEffect(() => {
    if (!library) return;
    refresh();
  }, [library, filter, refresh]);

  const focusedRow = rows.find((r) => r.version_id === active) || null;
  // Product og Shop har deres eget layout: vaerkerne smalt til venstre,
  // formularen bred i midten og shoppen til hoejre.
  const produktLayout = filter.fase === 5 || filter.fase === 6;
  const [shopNode, setShopNode] = useState(null);
  // Crop: vaerkerne smalt til venstre og beskaeringen i midten.
  const cropLayout = filter.fase === 3;
  const [cropNode, setCropNode] = useState(null);

  // Slaar det aktive billede op via refs, saa tastaturgenvejene
  // (registreret en gang) altid ser den aktuelle tilstand.
  const getFocused = () => rowsRef.current.find((r) => r.version_id === activeRef.current) || null;

  // ---------- Handlinger ----------

  const act = {
    chooseLibrary: async () => {
      try {
        const res = await invoke('lib:choose');
        if (res) {
          setLibrary(res);
          setFilter(startFilter());
          setSelected([]);
        }
      } catch (err) { visFejl(err); }
    },
    openLibrary: async (root) => {
      try {
        setLibrary(await invoke('lib:open', { root }));
        setFilter(startFilter());
        setSelected([]);
      } catch (err) { visFejl(err); }
    },
    // Bedoemmelse og arbejdstrin gaelder kun det aktive billede, ogsaa
    // naar der er flere markeret. De to er en vurdering af ét billede,
    // truffet mens man kigger paa det. Ramte de hele markeringen, kunne
    // man ikke gaa en markering igennem og bedoemme billederne hver for
    // sig, og et enkelt tastetryk kunne aendre tyve billeder man ikke
    // havde set paa. Serie, mappeflytning og noegleordsoprydning gaelder
    // stadig hele markeringen: de er netop bunkearbejde.
    setRating: (rating) => {
      const f = getFocused();
      if (f) invoke('img:setRating', { versionIds: [f.version_id], rating }).catch(visFejl);
    },
    // Status under Edits: navnet paa det program billedet er redigeret i.
    // Kun for godkendte billeder, og kun navne appen kender.
    setEditor: (editor) => {
      const f = getFocused();
      if (!f) return;
      // Gaelder alle markerede godkendte billeder, ellers det aktive.
      const valgte = new Set(selectedRef.current);
      const rows = valgte.size > 1
        ? rowsRef.current.filter((r) => valgte.has(r.version_id) && r.rating === 'godkendt')
        : (f.rating === 'godkendt' ? [f] : []);
      if (!rows.length) return;
      invoke('img:setEditor', { versionIds: rows.map((r) => r.version_id), editor }).catch(visFejl);
    },
    rotate: (delta) => {
      const f = getFocused();
      if (f) invoke('img:rotate', { fileIds: [f.file_id], delta }).catch(visFejl);
    },
    // Skift fase. Mappe, serie, noegleord og visning hoerer til den fase
    // man kom fra, saa de nulstilles; soegning og sortering bliver.
    setFase: (fase) => {
      localStorage.setItem('fase', String(fase));
      setShowPreview(fase === 1);
      setFilter((f) => (f.fase === fase ? f : {
        ...f, fase, folder: null, serieId: null, keyword: null,
        kunKandidater: false, kunKasserede: false, visKasserede: false,
      }));
    },
    // Fase 2: en kopi i vaerkets Edits med programmets endelse, aabnet i programmet.
    // Fase 4: alle de markerede beskaeringer til Gigapixel paa én gang.
    // -giga-filerne blandt dem er allerede forstoerrelser og sendes ikke.
    sendToEditor: async (program) => {
      const f = getFocused();
      if (!f) return;
      let ids = [f.version_id];
      if (program === 'Topaz Gigapixel' && selectedRef.current.length > 1) {
        const valgt = new Set(selectedRef.current);
        const krop = rowsRef.current.filter((r) => valgt.has(r.version_id) && !r.giga).map((r) => r.version_id);
        if (krop.length) ids = krop;
      }
      try {
        const res = await invoke('edit:send', { versionIds: ids, program });
        setFejl(res.antal > 1
          ? `Copied ${res.antal} crops to Edits and opened them in ${program}`
          : `Copied to ${res.rel} and opened in ${program}`);
        setTimeout(() => setFejl(null), 5000);
      } catch (err) { visFejl(err); }
    },
    // Det sidste i fase 2: den markerede fil bliver vaerkets master, og
    // vaerket gaar videre til fase 3.
    makeMaster: async () => {
      const f = getFocused();
      if (!f) return;
      try {
        const res = await invoke('edit:makeMaster', { versionId: f.version_id });
        setFejl(`Master saved as ${res.rel}${res.konverteret ? ' (converted to TIFF)' : ''}. The work is now in Crop.`);
        setTimeout(() => setFejl(null), 7000);
      } catch (err) { visFejl(err); }
    },
    // Fase 4: en printfil til Prodigi for hver markeret -giga-fil, ellers den aktive.
    makePrintFiles: async () => {
      const f = getFocused();
      if (!f) return;
      const valgte = selectedRef.current.length > 1 ? selectedRef.current : [f.version_id];
      setFejl(`Making ${valgte.length} print file${valgte.length === 1 ? '' : 's'} …`);
      try {
        const res = await invoke('print:make', { versionIds: valgte });
        const mb = res.reduce((sum, r) => sum + r.bytes, 0) / 1e6;
        // Det skal ikke kunne overses, hvis en printfil ikke er lavet af en
        // forstoerrelse.
        const ikke = res.filter((r) => !r.forstoerret);
        const advarsel = ikke.length
          ? ` Not larger than the crop, so not enlarged yet: ${ikke.map((r) => r.rel.split('/').pop()).join(', ')}.`
          : '';
        setFejl((res.length === 1
          ? `Print file saved as ${res[0].rel} (${res[0].bredde} × ${res[0].hoejde} px, ${mb.toFixed(1)} MB)`
          : `${res.length} print files saved in Print files (${mb.toFixed(1)} MB in all)`) + advarsel);
        setTimeout(() => setFejl(null), ikke.length ? 10000 : 7000);
      } catch (err) { visFejl(err); }
    },
    // Fase 2: kassér hele vaerket. Originalen gaar til Discarded, og
    // redigeringerne i papirkurven.
    discardWork: async () => {
      const f = getFocused();
      if (!f) return;
      const ok = window.confirm(
        'Discard this work?\n\n'
        + 'The original goes to the Discarded folder. The files in Edits go to the Trash.'
      );
      if (!ok) return;
      try {
        const res = await invoke('work:discard', { versionId: f.version_id });
        const n = res?.edits ?? 0;
        setFejl(n ? `Discarded. ${n} edit file${n === 1 ? '' : 's'} moved to the Trash.` : 'Discarded.');
        setTimeout(() => setFejl(null), 5000);
      } catch (err) { visFejl(err); }
    },
    editIn: async (appPath, versionId = getFocused()?.version_id) => {
      if (!versionId) return;
      try {
        await invoke('ed:open', { versionId, appPath });
      } catch (err) { visFejl(err); }
    },
    editInOther: async () => {
      try {
        const appPath = await invoke('ed:pick');
        const f = getFocused();
        if (appPath && f) {
          await invoke('ed:open', { versionId: f.version_id, appPath });
          setEditors(await invoke('ed:list'));
        }
      } catch (err) { visFejl(err); }
    },
    reveal: () => {
      const f = getFocused();
      if (f) invoke('img:reveal', { versionId: f.version_id }).catch(visFejl);
    },
    deleteVersion: (versionId) => {
      const ok = window.confirm('Delete the virtual copy? Any physical copy goes to the Trash.');
      if (ok) invoke('img:deleteVersion', { versionId }).catch(visFejl);
    },
    renameVersion: (versionId, currentName) => {
      setModal({
        title: 'Rename version',
        value: currentName,
        onSubmit: (name) => invoke('img:renameVersion', { versionId, name }).catch(visFejl),
      });
    },
    newFolder: () => {
      setModal({
        title: 'New folder',
        placeholder: 'Folder name',
        onSubmit: (name) =>
          invoke('fold:create', { parentRel: filterRef.current.folder || '', name }).catch(visFejl),
      });
    },
    moveTo: (fileIds, targetRel) => {
      invoke('fold:move', { fileIds, targetRel }).catch(visFejl);
    },
    rescan: async () => {
      setSkanner(true);
      try {
        const res = await invoke('lib:rescan');
        if (res?.unavailable) {
          setFejl('The drive is not connected. Your images are not gone, the catalogue is untouched.');
        } else if (res?.skipped) {
          setFejl('A scan is already running');
        } else {
          setFejl(res?.changed ? `Found ${res.changed} new or changed files` : 'No changes found');
        }
        setTimeout(() => setFejl(null), 5000);
      } catch (err) { visFejl(err); } finally { setSkanner(false); }
    },
    cleanup: async () => {
      try {
        const n = await invoke('fold:cleanup');
        setFejl(n ? `Moved ${n} discarded files to Discarded` : 'No files to move');
        setTimeout(() => setFejl(null), 4000);
      } catch (err) { visFejl(err); }
    },
    assignSeries: (seriesId) => {
      const imageIds = [...new Set(rowsRef.current
        .filter((r) => selectedRef.current.includes(r.version_id))
        .map((r) => r.image_id))];
      if (imageIds.length) invoke('ser:assign', { imageIds, seriesId }).catch(visFejl);
    },
    renameSeries: (serie) => {
      setModal({
        title: 'Rename series',
        value: serie.name,
        placeholder: 'Series name',
        onSubmit: (name) => invoke('ser:rename', { seriesId: serie.id, name })
          .then(() => refreshMeta())
          .catch(visFejl),
      });
    },
    deleteSeries: async (serie) => {
      const ok = window.confirm(
        `Delete the series "${serie.name}"?\n\n`
        + `The images stay where they are and are not touched. They only lose their link to the series.`
      );
      if (!ok) return;
      try {
        await invoke('ser:delete', { seriesId: serie.id });
        // Stod man i den slettede serie, ville grid'et ellers staa tomt.
        setFilter((f) => (f.serieId === serie.id ? { ...f, serieId: null } : f));
        refreshMeta();
      } catch (err) { visFejl(err); }
    },
    newSeries: () => {
      setModal({
        title: 'New series',
        placeholder: 'Series name',
        onSubmit: async (name) => {
          try {
            const id = await invoke('ser:create', { name });
            act.assignSeries(id);
          } catch (err) { visFejl(err); }
        },
      });
    },
    // Fjern et noegleord fra de markerede billeder. Det er vejen til at
    // rydde et forkert ord op i én omgang: klik ordet i sidepanelet,
    // marker de billeder det er forkert paa, og fjern det derfra. Ordet
    // bliver ikke udelukket; det maa gerne komme igen paa andre billeder.
    removeKeywordFromSelected: async (word) => {
      const fileIds = [...new Set(rowsRef.current
        .filter((r) => selectedRef.current.includes(r.version_id))
        .map((r) => r.file_id))];
      if (!fileIds.length) {
        setFejl(`Select the images «${word}» is wrong for first. Cmd+A selects them all.`);
        setTimeout(() => setFejl(null), 6000);
        return;
      }
      try {
        const antal = await invoke('kw:removeFromFiles', { fileIds, word });
        setFejl(`Removed «${word}» from ${antal} images`);
        setTimeout(() => setFejl(null), 4000);
      } catch (err) { visFejl(err); }
    },
    // ---- Cloud-noegleord ----
    kwRun: async () => {
      try {
        setKwStatus(await invoke('kw:run'));
      } catch (err) { visFejl(err); }
    },
    kwStop: async () => {
      try {
        setKwStatus(await invoke('kw:stop'));
      } catch (err) { visFejl(err); }
    },
    kwSetModel: async (model) => {
      try {
        setKwStatus(await invoke('kw:setModel', { model }));
      } catch (err) { visFejl(err); }
    },
    kwReanalyse: async () => {
      const ok = window.confirm(
        'Send every master to Claude again?\n\n'
        + 'This costs money once more. The words you typed yourself are not touched.'
      );
      if (!ok) return;
      try {
        const res = await invoke('kw:reanalyse');
        setKwStatus(res);
        setFejl(`${res.antal} images are queued again`);
        setTimeout(() => setFejl(null), 6000);
      } catch (err) { visFejl(err); }
    },
  };

  // ---------- Tastaturgenveje ----------

  useEffect(() => {
    const onKey = (e) => {
      if (modalOpenRef.current) return;
      const t = e.target;
      const iFelt = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      // Tabulator flytter fokus rundt mellem knapperne, og det staar i
      // vejen for et arbejde der foregaar med mus og bogstavgenveje.
      // Felter beholder tabulator, saa man kan gaa fra soegefeltet videre.
      if (e.key === 'Tab' && !iFelt) {
        e.preventDefault();
        return;
      }
      // Escape lukker forstoerrelsen naar den er aaben, og roerer ikke
      // markeringen. Er den lukket, er Escape vejen ud af multi-select.
      // Rammer den begge dele paa én gang, mister man markeringen hver
      // gang man lukker et stort billede.
      if (e.key === 'Escape' && showPreviewRef.current) {
        setShowPreview(false);
        return;
      }
      // Cmd+1 til Cmd+6 skifter fase, ogsaa inde i et tekstfelt. Feltet
      // forlades foerst, saa det der er skrevet, bliver gemt.
      if ((e.metaKey || e.ctrlKey) && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        if (iFelt) document.activeElement?.blur();
        act.setFase(Number(e.key));
        return;
      }
      if (iFelt) return;
      const rs = rowsRef.current;
      const sel = selectedRef.current;
      const idx = rs.findIndex((r) => r.version_id === activeRef.current);
      // Markering og aktivt billede er to ting, som i Lightroom. Pilene
      // flytter det aktive billede; de laver ikke om paa markeringen.
      //
      // Staar der flere markerede, gaar pilene rundt inde i markeringen.
      // Foer sprang de ud af den og efterlod ét billede markeret, saa en
      // markering ikke kunne gennemgaas billede for billede uden at gaa
      // i stykker. Er der kun ét eller ingen, gaar pilene gennem hele
      // grid'et og tager markeringen med.
      //
      // Med Skift udvides markeringen fra ankeret. Der stopper den ved
      // enderne: et ombrud dér ville pludselig markere hele biblioteket.
      const move = (delta, udvid = false) => {
        e.preventDefault();
        if (!rs.length) return;
        const fra = idx < 0 ? 0 : idx;

        if (udvid) {
          const next = Math.max(0, Math.min(rs.length - 1, fra + delta));
          const anker = Math.max(0, Math.min(rs.length - 1, ankerRef.current));
          setSelected(rs.slice(Math.min(anker, next), Math.max(anker, next) + 1)
            .map((r) => r.version_id));
          setActive(rs[next].version_id);
          return;
        }

        if (sel.length > 1) {
          // Inden for markeringen, i grid'ets raekkefoelge. Op og ned kan
          // ikke ramme en raekke praecist her, saa de flytter ét skridt i
          // den retning; alt andet ville springe uforudsigeligt rundt.
          const iValg = rs.filter((r) => sel.includes(r.version_id));
          const nuIdx = iValg.findIndex((r) => r.version_id === activeRef.current);
          const skridt = delta > 0 ? 1 : -1;
          const naeste = (((nuIdx < 0 ? 0 : nuIdx) + skridt) % iValg.length + iValg.length)
            % iValg.length;
          setActive(iValg[naeste].version_id);
          return;
        }

        const next = (((fra + delta) % rs.length) + rs.length) % rs.length;
        ankerRef.current = next;
        setSelected([rs[next].version_id]);
        setActive(rs[next].version_id);
      };
      const fase = filterRef.current.fase;
      // Bogstaverne foelger de engelske ord paa knapperne: A approve,
      // C candidate, X discard, U unrated. Bedoemmelsen hoerer til fase 1;
      // i fase 2 kasserer X hele vaerket, efter et spoergsmaal.
      switch (e.key.toLowerCase()) {
        case 'a':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setSelected(rs.map((r) => r.version_id));
            // Det aktive billede beholdes, saa man bliver staaende hvor
            // man var, nu bare med alt markeret omkring sig.
            if (idx < 0 && rs.length) {
              ankerRef.current = 0;
              setActive(rs[0].version_id);
            }
          } else if (fase === 1) {
            act.setRating('godkendt');
          }
          break;
        case 'c': if (fase === 1) act.setRating('kandidat'); break;
        case 'x':
          if (fase === 1) act.setRating('kasseret');
          else if (fase === 2) act.discardWork();
          break;
        case 'u': if (fase === 1) act.setRating('ubedomt'); break;
        // [ og ] er svaere at ramme paa et dansk tastatur, saa L og R gør det samme.
        case '[': case 'l': if (!e.metaKey && !e.ctrlKey) act.rotate(-90); break;
        case ']': case 'r': if (!e.metaKey && !e.ctrlKey) act.rotate(90); break;
        case ' ': e.preventDefault(); if (idx >= 0) setShowPreview((p) => !p); break;
        // Foerste Escape forlader multi-select og beholder det aktive
        // billede, saa pilene fortsaetter derfra. Anden Escape rydder.
        case 'escape':
          if (sel.length > 1 && activeRef.current) {
            setSelected([activeRef.current]);
            ankerRef.current = idx < 0 ? 0 : idx;
          } else {
            setSelected([]);
            setActive(null);
          }
          break;
        case 'arrowleft': move(-1, e.shiftKey); break;
        case 'arrowright': move(1, e.shiftKey); break;
        case 'arrowup': move(-columnsRef.current, e.shiftKey); break;
        case 'arrowdown': move(columnsRef.current, e.shiftKey); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!harBro) {
    return <div className="velkomst"><h1>Stef G Art</h1><p>This app must run inside Electron.</p></div>;
  }
  if (!library) {
    return <Welcome recent={recent} onChoose={act.chooseLibrary} onOpen={act.openLibrary} />;
  }

  return (
    <div className="app" style={{ '--accent': FASEFARVE[filter.fase] || undefined }}>
      <Toolbar
        filter={filter}
        setFilter={setFilter}
        searchInfo={searchInfo}
        faseTal={faseTal}
        onNewFolder={act.newFolder}
        onCleanup={act.cleanup}
        onChooseLibrary={act.chooseLibrary}
        onRescan={act.rescan}
        skanner={skanner}
        act={act}
        harValg={selected.length > 0}
      />
      <div className={produktLayout ? 'hoved produkt' : cropLayout ? 'hoved beskaer' : 'hoved'}>
        <Sidebar
          tree={tree}
          series={series}
          topKeywords={topKeywords}
          filter={filter}
          setFilter={setFilter}
          onMoveTo={(fileIds, rel) => act.moveTo(fileIds, rel)}
          onRemoveFromSelected={act.removeKeywordFromSelected}
          onRenameSeries={act.renameSeries}
          onDeleteSeries={act.deleteSeries}
          kwStatus={kwStatus}
          act={act}
          fase={filter.fase}
          editVaerker={editVaerker}
        />
        {/* Midterfeltet baerer baade grid'et og forstoerrelsen, saa den
            store visning holder sig inden for de to kolonner. */}
        <div className="midte">
          <div className="grid-felt">
          {filter.fase === 4 ? (
            <PrintList
              rows={rows}
              selected={selected}
              active={active}
              setSelected={setSelected}
              setActive={setActive}
              ankerRef={ankerRef}
              thumbRev={thumbRev}
              dataRev={dataRev}
            />
          ) : (
          <Grid
            rows={rows}
            selected={selected}
            active={active}
            setSelected={setSelected}
            setActive={setActive}
            focusIndex={rows.findIndex((r) => r.version_id === active)}
            harSoegning={Boolean((filter.search && filter.search.trim()) || filter.keyword)}
            onOpenPreview={() => setShowPreview(true)}
            onColumns={(c) => { columnsRef.current = c; }}
            ankerRef={ankerRef}
            columns={produktLayout || cropLayout ? 2 : kolonner}
            thumbRev={thumbRev}
          />
          )}
          {showPreview && focusedRow && (
            <PreviewOverlay
              row={focusedRow}
              onClose={() => setShowPreview(false)}
            />
          )}
          </div>
          {/* Fase 1: Import i den raekkefoelge billederne er skudt. Den staar
              under baade grid'et og den store visning. */}
          {filter.fase === 1 && focusedRow && (
            <Filmstrip
              row={focusedRow}
              rows={rows}
              visKasserede={filter.visKasserede}
              dataRev={dataRev}
              thumbRev={thumbRev}
              onSelect={(versionId, iGrid) => {
                if (!iGrid) {
                  // Billedet er ikke i den visning man star i: vis hele fase 1.
                  ventendeValgRef.current = versionId;
                  setFilter((f) => ({
                    ...f, folder: null, serieId: null, keyword: null, search: '', kunKandidater: false,
                  }));
                  return;
                }
                const i = rows.findIndex((r) => r.version_id === versionId);
                if (i >= 0) ankerRef.current = i;
                setSelected([versionId]);
                setActive(versionId);
              }}
            />
          )}
        </div>
        <Inspector
          row={focusedRow}
          fase={filter.fase}
          selectedCount={selected.length}
          activeKeyword={filter.keyword}
          editors={editors}
          statusNavne={statusNavne}
          series={series}
          act={act}
          dataRev={dataRev}
          tekstRev={tekstRev}
          hasKey={Boolean(kwStatus?.harKey)}
          shop={shop}
          onShop={(besked) => {
            visFejl(besked);
            invoke('shop:status').then(setShop).catch(() => {});
          }}
          onError={visFejl}
          storVisning={showPreview}
          shopNode={produktLayout ? shopNode : null}
          cropNode={cropLayout ? cropNode : null}
        />
        {cropLayout && <div className="crop-midte" ref={setCropNode} />}
        {/* Product og Shop: teksterne i midten, og her til hoejre billedet,
            tjeklisten og shopknapperne, som bruges til sidst. */}
        {produktLayout && (
          <aside className="inspector produkt-hoejre">
            {focusedRow && (
              <div className="stor-preview lille-preview">
                <img src={thumbUrl(focusedRow.file_id, focusedRow.mtime, 512, focusedRow.rotation)} alt="" />
              </div>
            )}
            <div ref={setShopNode} />
          </aside>
        )}
      </div>
      <StatusBar
        counts={counts}
        aiStatus={aiStatus}
        indexProgress={indexProgress}
        searchInfo={searchInfo}
        fejl={fejl}
        library={library}
        version={appInfo?.version}
        drevMangler={Boolean(drev?.missing)}
        kwStatus={kwStatus}
        textStatus={textStatus}
        thumbStatus={thumbStatus}
        onRetryPreviews={() => invoke('thumbs:retry').catch(visFejl)}
        kolonner={kolonner}
        setKolonner={(n) => {
          setKolonner(n);
          localStorage.setItem('kolonner', String(n));
        }}
      />
      {modal && (
        <NameModal
          title={modal.title}
          value={modal.value}
          placeholder={modal.placeholder}
          onSubmit={(v) => { modal.onSubmit(v); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
