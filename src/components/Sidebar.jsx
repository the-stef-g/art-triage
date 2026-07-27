import { useState } from 'react';

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

function FolderNode({ node, depth, filter, setFilter, onMoveTo }) {
  const [open, setOpen] = useState(depth < 1);
  const [dragOver, setDragOver] = useState(false);
  const aktiv = (filter.folder || '') === node.rel;

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/x-art-triage-files'));
      if (Array.isArray(data) && data.length) onMoveTo(data, node.rel);
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
        <span className="mappenavn">{depth === 0 ? 'All images' : node.name}</span>
        <Mappetal counts={node.counts} />
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
            title="Send the approved images that have not been analysed yet. Candidates and discarded images are never sent."
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

export default function Sidebar({
  tree, series, topKeywords, filter, setFilter, onMoveTo, onRemoveFromSelected,
  onRenameSeries, onDeleteSeries, kwStatus, act,
}) {
  const visSerie = (id) => setFilter((f) => ({ ...f, ...KUN_EN_VISNING, serieId: id }));
  const visNoegleord = (word) => setFilter((f) => ({ ...f, ...KUN_EN_VISNING, keyword: word }));

  return (
    <aside className="sidebar">
      <section>
        <h3>Folders</h3>
        {tree && (
          <FolderNode node={tree} depth={0} filter={filter} setFilter={setFilter} onMoveTo={onMoveTo} />
        )}
      </section>
      {/* Kandidatlisten stod her som sin egen sektion. Den er taget ud
          igen: Candidates-chippen i vaerktoejslinjen goer det samme, og
          to veje til den samme visning er én for meget. */}
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
      <section>
        <h3>Keywords</h3>
        <Noegleordskoe status={kwStatus} act={act} />
        {topKeywords.length === 0 && <p className="tom">Add your own words to an image in the right column</p>}
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
      </section>
    </aside>
  );
}
