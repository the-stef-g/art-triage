import { useState } from 'react';

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
        onClick={() => setFilter((f) => ({ ...f, folder: node.rel || null }))}
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
  tree, series, topKeywords, filter, setFilter, onMoveTo, onRemoveKeywordEverywhere, antalKandidater,
}) {
  // Arbejdslisten skal kunne aabnes med et klik, uden at man foerst
  // skal stille paa filtre. Derfor ryddes de filtre der ellers ville
  // skaere kandidater fra, i stedet for bare at slaa et flag til.
  const visKandidater = () => setFilter((f) => ({
    ...f,
    kunKandidater: !f.kunKandidater,
    kunGodkendte: false,
    kunFaerdige: false,
    visKasserede: false,
    keyword: null,
    serieId: null,
  }));

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
            onClick={() => setFilter((f) => ({ ...f, serieId: f.serieId === s.id ? null : s.id }))}
          >
            <span>{s.name}</span>
            <span className="antal">{s.image_count}</span>
          </div>
        ))}
      </section>
      <section>
        <h3>Nøgleord</h3>
        {topKeywords.length === 0 && <p className="tom">Kommer når billederne er analyseret</p>}
        <div className="chips">
          {topKeywords.map((k) => (
            <span
              key={k.word}
              className={`chip kw-chip ${filter.keyword === k.word ? 'aktiv' : ''}`}
            >
              <button
                className="kw-vaelg"
                onClick={() => setFilter((f) => ({ ...f, keyword: f.keyword === k.word ? null : k.word }))}
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
