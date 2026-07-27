import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, onEvent, harBro } from './api';
import Welcome from './components/Welcome';
import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import Grid from './components/Grid';
import Inspector from './components/Inspector';
import StatusBar, { MIN_KOLONNER, MAX_KOLONNER } from './components/StatusBar';
import { PreviewOverlay, NameModal } from './components/Overlay';

const defaultFilter = {
  folder: null, search: '', visKasserede: false, kunKasserede: false,
  kunGodkendte: false, kunKandidater: false, kunRedigerede: false, kunFaerdige: false,
  serieId: null, keyword: null, sort: 'navn',
};

export default function App() {
  const [library, setLibrary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [filter, setFilter] = useState(defaultFilter);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [searchInfo, setSearchInfo] = useState(null);
  const [tree, setTree] = useState(null);
  const [series, setSeries] = useState([]);
  const [editors, setEditors] = useState([]);
  const [topKeywords, setTopKeywords] = useState([]);
  const [aiStatus, setAiStatus] = useState(null);
  const [indexProgress, setIndexProgress] = useState(null);
  const [selected, setSelected] = useState([]); // version_id'er der er markeret
  // Det aktive billede inde i markeringen: det man staar paa, og det
  // inspektoeren viser. Foer var det bare sidste element i selected, og
  // saa skulle listen vendes for at flytte fokus, hvilket ikke kunne
  // baere at pilene skal kunne gaa rundt inde i en markering.
  const [active, setActive] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [modal, setModal] = useState(null);
  const [fejl, setFejl] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [drev, setDrev] = useState(null); // {missing, root} naar drevet skifter tilstand
  const [skanner, setSkanner] = useState(false);
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

  const visFejl = useCallback((err) => {
    setFejl(String(err?.message || err));
    setTimeout(() => setFejl(null), 6000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await invoke('img:list', filterRef.current);
      // Husk det fokuserede indeks fra den gamle liste: forsvinder hele
      // markeringen (fx efter kassering), markeres billedet paa samme
      // plads i den nye liste, altsaa det naeste foto.
      const gamleRows = rowsRef.current;
      const gammeltIdx = gamleRows.findIndex((r) => r.version_id === activeRef.current);
      setRows(res.rows);
      setCounts(res.counts);
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
      setSelected(nyValg);
      setActive(nyAktiv);
    } catch (err) {
      visFejl(err);
    }
  }, [visFejl]);

  // Hver del af sidepanelet hentes for sig. Med et samlet Promise.all
  // ville ét fejlende kald tage mappetraeet, serierne og noegleordene med
  // sig og efterlade panelet halvtomt uden at sige hvorfor.
  const refreshMeta = useCallback(async () => {
    const dele = [
      ['fold:tree', setTree],
      ['ser:list', setSeries],
      ['kw:top', setTopKeywords],
      ['ed:list', setEditors],
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
      refreshMeta();
      setDataRev((n) => n + 1);
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
      if (evt.cmd === 'claude-key') {
        // Noeglen vises aldrig igen efter den er gemt: den ligger i
        // indstillingerne, ikke i UI'et. Feltet starter derfor tomt, og
        // en tom indtastning fjerner den, der staar.
        setModal({
          title: 'Claude API key',
          value: '',
          placeholder: 'sk-ant-...',
          onSubmit: (key) => invoke('app:setClaudeKey', { key })
            .then(() => invoke('kw:status').then(setKwStatus))
            .catch(visFejl),
        });
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
    } else if (evt.type === 'drev') {
      setDrev({ missing: evt.missing, root: evt.root });
    } else if (evt.type === 'besked') {
      setFejl(evt.tekst);
      setTimeout(() => setFejl(null), 6000);
    } else if (evt.type === 'library') {
      setLibrary({ root: evt.root });
    }
  }), [refresh, refreshMeta, visFejl]);

  useEffect(() => {
    if (!library) return;
    refresh();
    refreshMeta();
    invoke('search:status').then((s) => {
      setAiStatus(s.ai);
      setIndexProgress(s.index);
    }).catch(() => {});
  }, [library, filter, refresh, refreshMeta]);

  const focusedRow = rows.find((r) => r.version_id === active) || null;

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
          setFilter(defaultFilter);
          setSelected([]);
        }
      } catch (err) { visFejl(err); }
    },
    openLibrary: async (root) => {
      try {
        setLibrary(await invoke('lib:open', { root }));
        setFilter(defaultFilter);
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
    // Arbejdstrin: enten under redigering eller faerdig, aldrig begge.
    // Saettes trinnet paa noget der allerede staar der, ryddes det, saa
    // genvejene stadig virker som til og fra.
    setStage: (stage) => {
      const f = getFocused();
      if (!f) return;
      const key = stage === 'edited' ? 'edited' : 'finished';
      const harDet = stage !== null && Boolean(f[key]);
      invoke('img:setStage', { versionIds: [f.version_id], stage: harDet ? null : stage })
        .catch(visFejl);
    },
    virtualCopy: () => {
      const f = getFocused();
      if (f) invoke('img:virtualCopy', { versionId: f.version_id }).catch(visFejl);
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
        setFejl(n ? `Flyttede ${n} kasserede filer til _kasseret` : 'Ingen filer at flytte');
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
        'Send every approved image to Claude again?\n\n'
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
      // Bogstaverne foelger de engelske ord paa knapperne: A approve,
      // C candidate, X discard, U unrated, E editing, F finished,
      // V virtual copy. Foer stod de til de danske ord, saa man trykkede
      // G for Approved og K for Candidate.
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
          } else {
            act.setRating('godkendt');
          }
          break;
        case 'c': act.setRating('kandidat'); break;
        case 'x': act.setRating('kasseret'); break;
        case 'u': act.setRating('ubedomt'); break;
        case 'e': act.setStage('edited'); break;
        case 'f': act.setStage('finished'); break;
        case 'v': act.virtualCopy(); break;
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
    return <div className="velkomst"><h1>Art Triage</h1><p>This app must run inside Electron.</p></div>;
  }
  if (!library) {
    return <Welcome recent={recent} onChoose={act.chooseLibrary} onOpen={act.openLibrary} />;
  }

  return (
    <div className="app">
      <Toolbar
        filter={filter}
        setFilter={setFilter}
        searchInfo={searchInfo}
        onNewFolder={act.newFolder}
        onCleanup={act.cleanup}
        onChooseLibrary={act.chooseLibrary}
        onRescan={act.rescan}
        skanner={skanner}
        act={act}
        harValg={selected.length > 0}
      />
      <div className="hoved">
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
        />
        {/* Midterfeltet baerer baade grid'et og forstoerrelsen, saa den
            store visning holder sig inden for de to kolonner. */}
        <div className="midte">
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
            columns={kolonner}
          />
          {showPreview && focusedRow && (
            <PreviewOverlay
              row={focusedRow}
              onClose={() => setShowPreview(false)}
            />
          )}
        </div>
        <Inspector
          row={focusedRow}
          selectedCount={selected.length}
          activeKeyword={filter.keyword}
          editors={editors}
          series={series}
          act={act}
          dataRev={dataRev}
        />
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
