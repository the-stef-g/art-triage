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

function FolderNode({ node, depth, filter, setFilter, onMoveTo }) {
  const [open, setOpen] = useState(depth < 1);
  const [dragOver, setDragOver] = useState(false);
  const aktiv = (filter.folder || '') === node.rel;

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/x-billedflow-files'));
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
        <span className="mappenavn">{depth === 0 ? 'Alle billeder' : node.name}</span>
        {node.count > 0 && <span className="antal">{node.count}</span>}
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

export default function Sidebar({
  tree, series, topKeywords, filter, setFilter, onMoveTo, onRemoveKeywordEverywhere,
  antalKandidater, onRenameSeries, onDeleteSeries,
}) {
  // Arbejdslisten skal kunne aabnes med et klik. Ud over de andre
  // visninger ryddes ogsaa de filtre i vaerktoejslinjen der ellers ville
  // skaere kandidater fra, saa listen viser det den lover.
  const visKandidater = () => setFilter((f) => ({
    ...f,
    ...KUN_EN_VISNING,
    kunKandidater: true,
    kunGodkendte: false,
    kunFaerdige: false,
    visKasserede: false,
  }));

  const visSerie = (id) => setFilter((f) => ({ ...f, ...KUN_EN_VISNING, serieId: id }));
  const visNoegleord = (word) => setFilter((f) => ({ ...f, ...KUN_EN_VISNING, keyword: word }));

  return (
    <aside className="sidebar">
      <section>
        <h3>Mapper</h3>
        {tree && (
          <FolderNode node={tree} depth={0} filter={filter} setFilter={setFilter} onMoveTo={onMoveTo} />
        )}
      </section>
      <section>
        <h3>Kandidater</h3>
        <div
          className={`kandidatliste ${filter.kunKandidater ? 'aktiv' : ''}`}
          onClick={visKandidater}
          title="Billeder der venter på en tur i editoren, før de kan afgøres"
        >
          <span>Venter på redigering</span>
          <span className="antal">{antalKandidater || 0}</span>
        </div>
      </section>
      <section>
        <h3>Serier</h3>
        {series.length === 0 && <p className="tom">Ingen serier endnu</p>}
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
                title="Omdøb serien"
                onClick={(e) => { e.stopPropagation(); onRenameSeries(s); }}
              >
                ✎
              </button>
              <button
                className="lille"
                title="Slet serien. Billederne bliver liggende."
                onClick={(e) => { e.stopPropagation(); onDeleteSeries(s); }}
              >
                🗑
              </button>
            </span>
          </div>
        ))}
      </section>
      <section>
        <h3>Nøgleord</h3>
        {topKeywords.length === 0 && <p className="tom">Skriv dine egne ord på et billede i højre kolonne</p>}
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
                title="Fjern nøgleordet fra alle billeder"
                onClick={() => onRemoveKeywordEverywhere(k.word)}
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
