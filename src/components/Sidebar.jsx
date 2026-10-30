import { useEffect, useState } from 'react';
import { invoke, onEvent } from '../api';

// Sidepanelet er navigation: en visning ad gangen. Uden det her skulle
// man klikke sig ud af fx kandidatlisten, foer man kunne gaa til en
// serie, og det foeltes som at sidde fast. Et klik hvor som helst i
// panelet fører nu direkte derhen.
const KUN_EN_VISNING = {
  folder: null,
  serieId: null,
  keyword: null,
  kunKandidater: false,
};

// Tallene ved en mappe, i trafiklysets farver: grøn godkendt, gul
// kandidat, rød kasseret, graa ubedømt. Nuller udelades, saa raekken ikke
// fyldes med tal der ikke siger noget. Undermapper er talt med, saa
// tallene svarer til det man faar at se, naar man klikker paa mappen.
const TAL = [
  ['godkendt', 'tal-godkendt', 'approved'],
  ['kandidat', 'tal-kandidat', 'candidates'],
  ['kasseret', 'tal-kasseret', 'discarded'],
  ['ubedomt', 'tal-ubedomt', 'unrated'],
];

function Mappetal({ counts }) {
  if (!counts) return null;
  const viste = TAL.filter(([key]) => counts[key] > 0);
  if (!viste.length) return null;
  // Farverne holder tallene fra hinanden, saa et mellemrum er nok. En
  // lodret streg imellem fyldte mere end den forklarede.
  return (
    <span className="mappetal">
      {viste.map(([key, klasse, navn]) => (
        <span key={key} className={klasse} title={`${counts[key]} ${navn}`}>{counts[key]}</span>
      ))}
    </span>
  );
}

function FolderNode({ node, depth, filter, setFilter, onMoveTo, rodNavn = 'All images', udenTal = false }) {
  const [open, setOpen] = useState(depth < 1);
  const [dragOver, setDragOver] = useState(false);
  const aktiv = (filter.folder || '') === node.rel || (depth === 0 && !filter.folder);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/x-art-triage-files'));
      if (onMoveTo && Array.isArray(data) && data.length) onMoveTo(data, node.rel);
    } catch {
      // ikke vores drag-data
    }
  };

  return (
    <div className="mappe-gren">
      <div
        className={`mappe ${aktiv ? 'aktiv' : ''} ${dragOver ? 'dragover' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => setFilter((f) => ({ ...f, ...KUN_EN_VISNING, folder: node.rel || null }))}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {node.children.length > 0 && (
          <button
            className="pil"
            onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
        <span className="mappenavn">{depth === 0 ? rodNavn : node.name}</span>
        {!(udenTal && depth === 0) && <Mappetal counts={node.counts} />}
      </div>
      {open && node.children.map((child) => (
        <FolderNode
          key={child.rel}
          node={child}
          depth={depth + 1}
          filter={filter}
          setFilter={setFilter}
          onMoveTo={onMoveTo}
        />
      ))}
    </div>
  );
}

// Kontrolpanelet for cloud-noegleordene. Det staar oven over ordene, saa
// det er tydeligt hvor de kommer fra, og hvad en koersel koster.
function Noegleordskoe({ status, act }) {
  if (!status) return null;
  const { harKey, koe, koerer, model, modeller, progress } = status;

  if (!harKey) {
    return (
      <p className="kw-koe tom">
        Keywords come from Claude. Add your API key under Help to switch it on.
      </p>
    );
  }

  return (
    <div className="kw-koe">
      <div className="kw-raekke">
        <select
          value={model}
          onChange={(e) => act.kwSetModel(e.target.value)}
          disabled={koerer}
          title="Haiku is the cheapest. Opus writes the most precise keywords and costs about five times as much."
        >
          {modeller.map((m) => <option key={m.id} value={m.id}>{m.navn}</option>)}
        </select>
        {koerer ? (
          <button className="lille" onClick={act.kwStop}>Stop</button>
        ) : (
          <button
            className="lille"
            onClick={act.kwRun}
            disabled={koe === 0}
            title="Send the masters that have not been analysed yet. Only files in a work's Master folder get keywords; a new master is sent by itself."
          >
            {koe > 0 ? `Analyse ${koe}` : 'Nothing waiting'}
          </button>
        )}
      </div>
      {koerer && progress && (
        <p className="kw-fremdrift">
          {progress.done}/{progress.total} · ${progress.cost.toFixed(2)}
        </p>
      )}
      {!koerer && progress?.phase === 'stoppet' && (
        <p className="kw-fremdrift">Stopped after {progress.done} images · ${progress.cost.toFixed(2)}</p>
      )}
      {!koerer && progress?.phase === 'faerdig' && progress.done > 0 && (
        <p className="kw-fremdrift">Done: {progress.done} images · ${progress.cost.toFixed(2)}</p>
      )}
      {!koerer && koe === 0 && (
        <button className="lille kw-igen" onClick={act.kwReanalyse}>Analyse everything again</button>
      )}
    </div>
  );
}

const FASE_TEKST = {
  2: ['Edit', 'Approved works without a master. Send a copy to an editor, and make the master as the last step.'],
  3: ['Crop', 'The masters and their crops. Each crop is its own file in Master.'],
  4: ['Print', 'The crops and their enlargements. Each enlargement becomes a print file for Prodigi: a PNG in sRGB at full size, in the work\'s Print files folder.'],
};

export default function Sidebar({
  tree, series, topKeywords, filter, setFilter, onMoveTo, onRemoveFromSelected,
  onRenameSeries, onDeleteSeries, kwStatus, act, fase = 1, editVaerker = null,
}) {
  const visSerie = (id) => setFilter((f) => ({ ...f, ...KUN_EN_VISNING, serieId: id }));
  const visNoegleord = (word) => setFilter((f) => ({ ...f, ...KUN_EN_VISNING, keyword: word }));

  // Hver fase viser det den bruger: mapperne til sorteringen, serier og
  // noegleord til produktet. Fase 2, 4 og 5 arbejdes i inspektoeren.
  // Fase 2: vaerkernes mapper i Approved, kun dem der endnu ikke har en
  // master. Et klik viser kun det vaerks filer. Der flyttes ikke filer her:
  // mapperne i et vaerk er appens struktur.
  if (fase === 2) {
    const approved = tree?.children?.find((c) => c.rel === 'Approved');
    const navne = new Set(editVaerker || []);
    const rod = approved
      ? { ...approved, children: approved.children.filter((c) => navne.has(c.name)) }
      : null;
    return (
      <aside className="sidebar">
        <section>
          <h3>Folders</h3>
          {rod && rod.children.length > 0 ? (
            <FolderNode node={rod} depth={0} filter={filter} setFilter={setFilter} onMoveTo={null} rodNavn="All works" udenTal />
          ) : (
            <p className="tom">{FASE_TEKST[2][1]}</p>
          )}
        </section>
      </aside>
    );
  }

  if (fase !== 1 && fase !== 5 && fase !== 6) {
    return (
      <aside className="sidebar">
        <section>
          <h3>{FASE_TEKST[fase]?.[0]}</h3>
          <p className="tom">{FASE_TEKST[fase]?.[1]}</p>
        </section>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      {fase === 1 && (
      <section>
        <h3>Folders</h3>
        {tree && (
          <FolderNode node={tree} depth={0} filter={filter} setFilter={setFilter} onMoveTo={onMoveTo} />
        )}
      </section>
      )}
      {/* Kandidatlisten stod her som sin egen sektion. Den er taget ud
          igen: Candidates-chippen i vaerktoejslinjen goer det samme, og
          to veje til den samme visning er én for meget. */}
      {(fase === 5 || fase === 6) && (
      <>
      <PrisSektion />
      <section>
        <h3>Series</h3>
        {series.length === 0 && <p className="tom">No series yet</p>}
        {series.map((s) => (
          <div
            key={s.id}
            className={`serie ${filter.serieId === s.id ? 'aktiv' : ''}`}
            onClick={() => visSerie(s.id)}
          >
            <span className="serienavn">{s.name}</span>
            <span className="antal">{s.image_count}</span>
            <span className="serieknapper">
              <button
                className="lille"
                title="Rename series"
                onClick={(e) => { e.stopPropagation(); onRenameSeries(s); }}
              >
                ✎
              </button>
              <button
                className="lille"
                title="Delete the series. The images stay where they are."
                onClick={(e) => { e.stopPropagation(); onDeleteSeries(s); }}
              >
                🗑
              </button>
            </span>
          </div>
        ))}
      </section>
      {/* I Product rettes et vaerks soegeord i hoejre kolonne; her staar
          kun koeren, saa ordene ikke staar to steder. I Shop kan man
          stadig klikke paa et ord og se alle vaerkerne med det. */}
      <section>
        <h3>{fase === 5 ? 'Automatic keywords' : 'Keywords'}</h3>
        <Noegleordskoe status={kwStatus} act={act} />
        {fase === 6 && topKeywords.length === 0 && <p className="tom">No keywords yet</p>}
        {fase === 6 && (
        <div className="chips">
          {topKeywords.map((k) => (
            <span
              key={k.word}
              className={`chip kw-chip ${filter.keyword === k.word ? 'aktiv' : ''}`}
            >
              <button
                className="kw-vaelg"
                onClick={() => visNoegleord(k.word)}
              >
                {k.word} <span className="antal">{k.antal}</span>
              </button>
              <button
                className="chip-fjern"
                title="Remove the keyword from the selected images. Click the keyword first to see them, then select the ones it is wrong for."
                onClick={() => onRemoveFromSelected(k.word)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        )}
      </section>
      </>
      )}
    </aside>
  );
}

// Prislisten for print, og knappen der laegger den ud paa alle
// printprodukter i shoppen: varianter og priser, ikke tekster og billeder.
function PrisSektion() {
  const [liste, setListe] = useState(null);
  const [status, setStatus] = useState(null);
  useEffect(() => { invoke('print:prisliste').then(setListe).catch(() => {}); }, []);
  useEffect(() => onEvent((evt) => {
    if (evt.type === 'shopFremdrift') setStatus((s) => (s?.igang ? { igang: true, tekst: evt.tekst } : s));
  }), []);
  const opdater = async () => {
    setStatus({ igang: true, tekst: 'Starting' });
    try {
      const res = await invoke('shop:updateAllPrints');
      setStatus({ igang: false, ok: true, tekst: `Updated ${res.antal} print product${res.antal === 1 ? '' : 's'} to price list ${res.version}` });
    } catch (err) {
      setStatus({ igang: false, ok: false, tekst: `Not updated: ${String(err?.message || err).replace(/^Error: /, '')}` });
    }
  };
  return (
    <section>
      <h3>Prices</h3>
      <p className="tom">
        Price list {liste?.version ?? '…'}{liste?.dato ? ` (${liste.dato})` : ''}. Update all prints puts its
        prices and variants on every print product in the shop. Texts and pictures are left alone.
      </p>
      <div className="knapraekke">
        <button disabled={status?.igang} onClick={opdater}>Update all prints</button>
      </div>
      {status && (
        <p className={`shop-fremdrift ${status.igang ? 'igang' : status.ok ? 'ok' : 'fejl'}`} role="status">
          {status.igang ? `${status.tekst} …` : `${status.ok ? '✓' : '✕'} ${status.tekst}`}
        </p>
      )}
    </section>
  );
}
