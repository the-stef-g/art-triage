import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, onEvent, harBro } from './api';
import Welcome from './components/Welcome';
import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import Grid from './components/Grid';
import Inspector from './components/Inspector';
import StatusBar from './components/StatusBar';
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
  const [selected, setSelected] = useState([]); // version_id'er i klik-raekkefoelge
  const [showPreview, setShowPreview] = useState(false);
  const [modal, setModal] = useState(null);
  const [fejl, setFejl] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [drev, setDrev] = useState(null); // {missing, root} naar drevet skifter tilstand
  const [skanner, setSkanner] = useState(false);

  const filterRef = useRef(filter);
  filterRef.current = filter;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const columnsRef = useRef(4);
  const modalOpenRef = useRef(false);
  modalOpenRef.current = Boolean(modal);

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
      const gammelSel = selectedRef.current;
      const gammeltIdx = gamleRows.findIndex(
        (r) => r.version_id === gammelSel[gammelSel.length - 1]
      );
      setRows(res.rows);
      setCounts(res.counts);
      setSearchInfo(res.searchInfo);
      setSelected((sel) => {
        const valid = new Set(res.rows.map((r) => r.version_id));
        const beholdt = sel.filter((id) => valid.has(id));
        if (beholdt.length || gammeltIdx < 0 || !res.rows.length) return beholdt;
        const idx = Math.min(gammeltIdx, res.rows.length - 1);
        return [res.rows[idx].version_id];
      });
    } catch (err) {
      visFejl(err);
    }
  }, [visFejl]);

  const refreshMeta = useCallback(async () => {
    try {
      const [t, s, kw, ed] = await Promise.all([
        invoke('fold:tree'),
        invoke('ser:list'),
        invoke('kw:top'),
        invoke('ed:list'),
      ]);
      setTree(t);
      setSeries(s);
      setTopKeywords(kw);
      setEditors(ed);
    } catch (err) {
      visFejl(err);
    }
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
    } else if (evt.type === 'drev') {
      setDrev({ missing: evt.missing, root: evt.root });
    } else if (evt.type === 'besked') {
      setFejl(evt.tekst);
      setTimeout(() => setFejl(null), 6000);
    } else if (evt.type === 'library') {
      setLibrary({ root: evt.root });
    }
  }), [refresh, refreshMeta]);

  useEffect(() => {
    if (!library) return;
    refresh();
    refreshMeta();
    invoke('search:status').then((s) => {
      setAiStatus(s.ai);
      setIndexProgress(s.index);
    }).catch(() => {});
  }, [library, filter, refresh, refreshMeta]);

  const focusedRow = rows.find((r) => r.version_id === selected[selected.length - 1]) || null;

  // Slaar det fokuserede billede op via refs, saa tastaturgenvejene
  // (registreret en gang) altid ser den aktuelle markering.
  const getFocused = () => {
    const sel = selectedRef.current;
    return rowsRef.current.find((r) => r.version_id === sel[sel.length - 1]) || null;
  };

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
    setRating: (rating) => {
      const ids = selectedRef.current;
      if (ids.length) invoke('img:setRating', { versionIds: ids, rating }).catch(visFejl);
    },
    toggleFlag: (flag) => {
      const ids = selectedRef.current;
      if (!ids.length) return;
      const rs = rowsRef.current.filter((r) => ids.includes(r.version_id));
      const key = flag === 'edited' ? 'edited' : 'finished';
      const allSet = rs.every((r) => r[key]);
      invoke('img:setFlag', { versionIds: ids, flag, value: !allSet }).catch(visFejl);
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
    removeKeywordEverywhere: async (word) => {
      const ok = window.confirm(
        `Remove the keyword "${word}" from ALL images?\n\n`
        + `This also removes words you typed yourself, it cannot be undone, `
        + `and the app will never suggest "${word}" again.`
      );
      if (!ok) return;
      try {
        await invoke('kw:removeAll', { word });
        if (filterRef.current.keyword === word) setFilter((f) => ({ ...f, keyword: null }));
      } catch (err) { visFejl(err); }
    },
    // Fjern et nøgleord fra de aktuelt markerede billeder (fx dem der
    // ikke hører til under det søgeord man kigger på).
    removeKeywordFromSelected: (word) => {
      const fileIds = [...new Set(rowsRef.current
        .filter((r) => selectedRef.current.includes(r.version_id))
        .map((r) => r.file_id))];
      if (fileIds.length) invoke('kw:removeFromFiles', { fileIds, word }).catch(visFejl);
    },
  };

  // ---------- Tastaturgenveje ----------

  useEffect(() => {
    const onKey = (e) => {
      if (modalOpenRef.current) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const rs = rowsRef.current;
      const sel = selectedRef.current;
      const idx = rs.findIndex((r) => r.version_id === sel[sel.length - 1]);
      const move = (delta) => {
        e.preventDefault();
        if (!rs.length) return;
        const next = idx < 0 ? 0 : Math.max(0, Math.min(rs.length - 1, idx + delta));
        setSelected([rs[next].version_id]);
      };
      switch (e.key.toLowerCase()) {
        case 'g': act.setRating('godkendt'); break;
        case 'k': act.setRating('kandidat'); break;
        case 'x': act.setRating('kasseret'); break;
        case 'u': act.setRating('ubedomt'); break;
        case 'f': act.toggleFlag('finished'); break;
        case 'r': act.toggleFlag('edited'); break;
        case 'v': act.virtualCopy(); break;
        case ' ': e.preventDefault(); if (idx >= 0) setShowPreview((p) => !p); break;
        case 'escape': setShowPreview(false); setSelected([]); break;
        case 'arrowleft': move(-1); break;
        case 'arrowright': move(1); break;
        case 'arrowup': move(-columnsRef.current); break;
        case 'arrowdown': move(columnsRef.current); break;
        case 'a':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setSelected(rs.map((r) => r.version_id));
          }
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!harBro) {
    return <div className="velkomst"><h1>art-triage</h1><p>This app must run inside Electron.</p></div>;
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
      />
      <div className="hoved">
        <Sidebar
          tree={tree}
          series={series}
          topKeywords={topKeywords}
          filter={filter}
          setFilter={setFilter}
          onMoveTo={(fileIds, rel) => act.moveTo(fileIds, rel)}
          onRemoveKeywordEverywhere={act.removeKeywordEverywhere}
          antalKandidater={counts?.byRating?.kandidat}
          onRenameSeries={act.renameSeries}
          onDeleteSeries={act.deleteSeries}
        />
        <Grid
          rows={rows}
          selected={selected}
          setSelected={setSelected}
          focusIndex={rows.findIndex((r) => r.version_id === selected[selected.length - 1])}
          harSoegning={Boolean((filter.search && filter.search.trim()) || filter.keyword)}
          onOpenPreview={() => setShowPreview(true)}
          onColumns={(c) => { columnsRef.current = c; }}
        />
        <Inspector
          row={focusedRow}
          selectedCount={selected.length}
          activeKeyword={filter.keyword}
          editors={editors}
          series={series}
          act={act}
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
      />
      {showPreview && focusedRow && (
        <PreviewOverlay
          row={focusedRow}
          onClose={() => setShowPreview(false)}
        />
      )}
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
