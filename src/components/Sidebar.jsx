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

export default function Sidebar({ tree, series, topKeywords, filter, setFilter, onMoveTo }) {
  return (
    <aside className="sidebar">
      <section>
        <h3>Mapper</h3>
        {tree && (
          <FolderNode node={tree} depth={0} filter={filter} setFilter={setFilter} onMoveTo={onMoveTo} />
        )}
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
            <button
              key={k.word}
              className={`chip ${filter.keyword === k.word ? 'aktiv' : ''}`}
              onClick={() => setFilter((f) => ({ ...f, keyword: f.keyword === k.word ? null : k.word }))}
            >
              {k.word} <span className="antal">{k.antal}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
